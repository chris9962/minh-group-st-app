# Image chạy mgst-app. Ba tầng: cài gói → dựng → chạy.
#
# Tầng cuối mang `.next/standalone` cộng `public/` và `.next/static`. Thiếu
# `.next/static` thì mọi JS và CSS trả 404, trang ra màn hình trắng.
#
# ⚠️ Image KHÔNG chứa migration. Chạy `bun run db:migrate` từ repo trên máy chủ
# TRƯỚC khi dựng lại container. Tài liệu deploy chỉ có ở máy của chủ dự án
# (`docs/` nằm trong .gitignore), không có trên VM.

FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
# Bảo hiểm kép cho postinstall của `playwright`: `trustedDependencies` trong
# package.json đã khoanh lifecycle script về đúng `unrs-resolver`, biến này chặn
# thêm ở tầng playwright. Không chặn thì Chromium về theo, thêm hơn 150MB cho một
# thứ tầng cuối không mang.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN bun install --frozen-lockfile

FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Giá trị GIẢ, chỉ sống trong tầng dựng và không đi vào image cuối.
#
# `next build` nạp module máy chủ ở bước "Collecting page data", và
# `src/server/db/client.ts` ném lỗi ngay lúc nạp nếu thiếu `DATABASE_URL`. Không
# có dòng này thì build dừng ở `/api/audit-log`. Chuỗi này không kết nối tới đâu —
# bản dựng không truy vấn database.
ENV DATABASE_URL=postgres://build:build@127.0.0.1:5432/build
# ⚠️ Bản dựng GỌI RA INTERNET. `src/app/layout.tsx` nạp font qua
# `next/font/google`, nên `next build` tải Figtree từ fonts.gstatic.com mỗi lần.
# Egress bị chặn hay Google Fonts chậm là cả bản dựng dừng. Hết hẳn thì phải tải
# `.woff2` về `src/fonts/` rồi chuyển sang `next/font/local` — chưa làm.
#
# KHÔNG dùng `RUN --mount=type=cache`. Máy chủ FPT không có buildx nên
# `docker build` rơi về builder cổ điển, và builder đó từ chối cú pháp `--mount`.
RUN bun run build

FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Mặc định của Next là `localhost`, chỉ nghe trong container. Nginx ở máy chủ gọi
# vào qua cổng ánh xạ nên phải nghe mọi giao diện mạng.
ENV HOSTNAME=0.0.0.0

# Không chạy bằng root: lỗi thoát container thành lỗi chiếm quyền root trên máy chủ.
RUN addgroup -S mgst && adduser -S -G mgst mgst

# Mã nguồn thuộc ROOT, tiến trình app chạy bằng `mgst` nên không ghi đè được
# `server.js` lẫn các chunk trong `.next/server`. Lỗ ghi file bất kỳ trong app khi
# đó chỉ sống tới lần dựng lại container, không cấy được thứ gì ở lại.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# `sharp` là module NATIVE, và `.next/standalone` chép thiếu một nửa của nó:
# nó mang `@img/sharp-linuxmusl-x64` nhưng bỏ `@img/sharp-libvips-linuxmusl-x64`
# — chính là gói chứa `libvips-cpp.so`. Thiếu file đó thì mọi route nạp
# `server/storage.ts` chết với `ERR_DLOPEN_FAILED`, kể cả route không đụng ảnh:
# danh sách khách hàng trả lỗi vì cùng nạp module đó. Chép trọn `@img` sang là
# đủ; `apk add vips` KHÔNG thay được vì bản dựng sẵn đòi đúng số hiệu phiên bản.
COPY --from=builder /app/node_modules/@img ./node_modules/@img

# Hai thư mục app PHẢI ghi được, mở riêng đúng hai cái:
#   .next/cache  — Next lưu ảnh đã tối ưu của `next/image`
#   .uploads     — ngả ghi đĩa khi thiếu biến S3_*, xem src/server/storage.ts
# Không mở `.uploads` thì `mkdir` ném EACCES và người dùng chỉ thấy câu "Không lưu
# được ảnh", không dấu vết nào chỉ về nguyên nhân thật là thiếu cấu hình S3.
RUN mkdir -p .next/cache .uploads && chown -R mgst:mgst .next/cache .uploads

USER mgst
EXPOSE 3000

# `--restart` của Docker chỉ khởi động lại khi tiến trình THOÁT. Pool `pg` cạn kết
# nối hay event loop kẹt thì tiến trình còn sống, `docker ps` báo Up, còn Nginx trả
# 502 cho mọi người dùng. Healthcheck bắt đúng ca đó.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/login > /dev/null || exit 1

CMD ["bun", "server.js"]

# ── Worker PVI ────────────────────────────────────────────────────────────────
#
# Tầng RIÊNG, không dựng chung với app: `docker build --target worker`.
#
# Nền là image Playwright chứ không phải `oven/bun:alpine` như app. Bot cần
# Chromium thật cộng Xvfb, và Playwright không hỗ trợ Alpine — thư viện hệ thống
# của Chromium dựng theo glibc, còn Alpine dùng musl.
#
# ⚠️ Image này KHÔNG chứa `.env.local`. Máy chủ truyền lúc chạy bằng `--env-file`.
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS worker
WORKDIR /app

# `pdftoppm` của poppler và `cwebp` của libwebp đổi giấy chứng nhận PDF sang
# WebP (src/server/pvi-certificate.ts). `tesseract` cộng ba gói python đọc
# captcha màn đăng nhập (pvi-qlcd-playwright/capcha-resolver/solve.py). Thiếu
# chúng thì worker chạy tới lúc hết phiên là dừng, và không tải được giấy chứng
# nhận nào.
#
# `--break-system-packages`: Ubuntu 24.04 đánh dấu python hệ thống là "externally
# managed", pip từ chối cài nếu không nói rõ. Trong container không có môi trường
# python nào khác để tranh chấp.
RUN apt-get update && apt-get install -y --no-install-recommends \
      poppler-utils webp tesseract-ocr python3-pil python3-numpy python3-pip \
  && pip3 install --break-system-packages --no-cache-dir pytesseract \
  && rm -rf /var/lib/apt/lists/*

# Image Playwright có node và npm, không có bun. Worker viết bằng TypeScript nên
# cần bun để chạy thẳng, khỏi bước biên dịch riêng.
RUN npm install -g bun@1

COPY package.json bun.lock ./
# Chromium đã nằm sẵn trong image ở `/ms-playwright`; tải thêm là thừa 150MB.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN bun install --frozen-lockfile

# Chỉ hai thư mục worker cần. Không `COPY . .`: `.next`, `e2e`, `public`,
# `scripts` không tham gia, và mỗi file thừa là một lần mất cache tầng này.
#
# `src` vẫn phải có: worker ghi `insurance_orders` qua schema Drizzle và đẩy ảnh
# qua `src/server/storage.ts`, hai thứ dùng chung với app.
COPY tsconfig.json ./
COPY src ./src
COPY pvi-qlcd-playwright ./pvi-qlcd-playwright

# Phiên đăng nhập PVI phải sống qua các lần dựng lại container, nếu không mỗi lần
# khởi động là một lần giải captcha. Máy chủ mount thư mục thật vào đây.
ENV PVI_STATE=/app/session/storageState.json

# `lib/ngay.js` dựng mốc hiệu lực bằng `getHours()`, tức giờ CỤC BỘ của tiến
# trình. Container mặc định chạy UTC nên nó điền 14:25 trong khi đồng hồ PVI là
# 21:25 — mốc nằm ở quá khứ 7 tiếng, PVI từ chối form và đơn không được tạo.
# Đo 2026-08-28 với đơn DH-2608-011.
ENV TZ=Asia/Ho_Chi_Minh
RUN mkdir -p /app/session /app/pvi-qlcd-playwright/anh /app/pvi-qlcd-playwright/captcha \
      /app/pvi-qlcd-playwright/vet \
  && chmod +x /app/pvi-qlcd-playwright/docker-entrypoint.sh \
  && chown -R pwuser:pwuser /app/session /app/pvi-qlcd-playwright

USER pwuser

# Trang PVI có lớp chống bot, chạy headless dễ bị chặn — nên Chromium chạy CÓ
# giao diện trên màn hình ảo. Script dựng Xvfb rồi `exec bun`; lý do không dùng
# `xvfb-run` viết trong chính script đó.
#
# ENTRYPOINT chứ không CMD: cờ truyền vào `docker run` đi thẳng tới worker, nên
# chạy thử được bằng `docker run mgst-worker:latest --thu --mot-vong`.
ENTRYPOINT ["/app/pvi-qlcd-playwright/docker-entrypoint.sh"]

# ── Worker đường API đối tác PVI ────────────────────────────────────────────
#
# Nền là `oven/bun:1-alpine` như app, KHÔNG phải image Playwright: đường API chỉ
# gửi lệnh POST, không mở trình duyệt. Bỏ Chromium là image nhỏ hơn image bot
# khoảng mười lần.
#
# Không có Xvfb nên cũng không cần entrypoint script — bun chạy thẳng ở PID 1,
# `docker stop` gửi SIGTERM tới đúng nó.
#
# ⚠️ Image này KHÔNG chứa `.env.local`. Máy chủ truyền lúc chạy bằng `--env-file`.
FROM oven/bun:1-alpine AS api-worker
WORKDIR /app

# `pdftoppm` của poppler và `cwebp` của libwebp đổi giấy chứng nhận PDF sang WebP
# (src/server/pvi-api/certificate.ts). Thiếu chúng thì worker tạo được đơn nhưng
# không lưu được giấy chứng nhận nào, và đơn nằm mãi ở `awaiting-certificate`.
#
# `tzdata` để `ENV TZ` dưới đây có tác dụng. Alpine KHÔNG mang sẵn bảng múi giờ,
# nên thiếu gói này thì container chạy UTC dù đã đặt biến, và mốc hiệu lực lệch
# 7 tiếng về quá khứ. Đo trên máy chủ 2026-09-10: container in 16:19 UTC trong
# khi máy chủ 23:19 +07. Image bot không dính vì nền Ubuntu có sẵn tzdata.
#
# `ttf-liberation` và `font-noto` để `pdftoppm` VẼ ĐƯỢC CHỮ. Giấy chứng nhận PVI
# KHÔNG nhúng font cho phần dữ liệu: `pdffonts` cho `ArialMT`, `Arial-BoldMT`,
# `TimesNewRomanPSMT` ở cột `emb = no`. Font không nhúng thì máy vẽ phải tự có.
# Alpine trắng trơn, `fc-list` đếm 0, nên poppler bỏ trắng đúng những ô dữ liệu:
# số hợp đồng, biển số, số tiền, thời hạn đều mất, còn khung mẫu vẫn hiện vì
# khung có nhúng font. Đo trên máy chủ 2026-09-10 với đơn DH-2609-12561, poppler
# in khoảng 200 dòng `Couldn't find a font for 'TimesNewRomanPSMT'`.
#
# `ttf-liberation` KHỚP SỐ ĐO của Arial và Times New Roman nên chữ nằm đúng chỗ,
# không lệch dòng. `font-noto` phủ dấu tiếng Việt. Image bot không dính vì nền
# Ubuntu mang sẵn 50 font.
#
# Kiểm ảnh chứng minh tài khoản ngân hàng KHÔNG ở đây: worker đó là tầng
# `photo-check` bên dưới, mang Python OCR.
RUN apk add --no-cache poppler-utils libwebp-tools tzdata ttf-liberation font-noto

COPY package.json bun.lock ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN bun install --frozen-lockfile

# Ba thứ worker cần: schema Drizzle, module PVI, và kho ảnh — tất cả nằm trong
# `src`. Cộng worker PVI ở `scripts`.
COPY tsconfig.json ./
COPY src ./src
COPY scripts/pvi-api-worker.ts ./scripts/

# `period.ts` dựng mốc hiệu lực bằng giờ CỤC BỘ của tiến trình. Container mặc
# định chạy UTC nên nó gửi mốc lệch 7 tiếng về quá khứ, và PVI từ chối đơn với
# `-505` hoặc `-401`. Cùng lý do với worker bot.
ENV TZ=Asia/Ho_Chi_Minh

USER bun

# ENTRYPOINT chứ không CMD: cờ truyền vào `docker run` đi thẳng tới worker, nên
# chạy thử một vòng được bằng `docker run mgst-api-worker:latest --mot-vong`.
ENTRYPOINT ["bun", "scripts/pvi-api-worker.ts"]

# ── Worker bot Zalo ─────────────────────────────────────────────────────────
#
# Tầng RIÊNG: `docker build --target zalo-worker`, container `mgst-zalo-worker`,
# dựng bằng `deploy/worker-zalo.sh`. Worker giữ phiên Zalo của tài khoản cá
# nhân qua zca-js, không mở trình duyệt, nên nền alpine như `api-worker`.
#
# Đặt TRƯỚC tầng `photo-check` để tầng cuối của file không đổi: `docker build`
# thiếu `--target` dựng tầng cuối cùng.
#
# Phiên đăng nhập (cookie, IMEI, user agent) nằm ở `/app/session`, script deploy
# gắn volume `mgst-zalo-session` vào đó. Thiếu volume thì mỗi lần dựng lại
# container phải quét QR lại.
#
# ⚠️ Image này KHÔNG chứa `.env.local`. Máy chủ truyền lúc chạy bằng `--env-file`.
FROM oven/bun:1-alpine AS zalo-worker
WORKDIR /app

# `tzdata` để `ENV TZ` có tác dụng, cùng lý do với tầng `api-worker`. Giờ in
# trong log của worker phải khớp giờ đội vận hành đọc.
RUN apk add --no-cache tzdata

COPY package.json bun.lock ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY scripts/zalo-bot-worker.ts ./scripts/

ENV TZ=Asia/Ho_Chi_Minh
ENV ZALO_SESSION_FILE=/app/session/credentials.json

# Volume mới nhận chủ sở hữu của thư mục trong image. Thư mục thuộc `root` thì
# worker chạy bằng `bun` không ghi được file phiên.
RUN mkdir -p /app/session && chown bun:bun /app/session
USER bun

ENTRYPOINT ["bun", "scripts/zalo-bot-worker.ts"]

# ── Worker kiểm ảnh chứng minh tài khoản ngân hàng ──────────────────────────
#
# Tầng RIÊNG: `docker build --target photo-check`, container `mgst-photo-check`,
# dựng bằng `deploy/worker-photo.sh`. Tách khỏi worker PVI để OCR hỏng không
# kéo theo tạo đơn bảo hiểm, và vì tầng này nặng: Python + torch + paddle
# khoảng 1,5 GB, worker PVI không cần.
#
# Nền `oven/bun:1-debian` chứ không phải alpine: torch và paddlepaddle chỉ có
# bánh xe glibc. `bun install` chạy lại trong tầng này vì `sharp` có phần
# native, bản dựng cho musl ở tầng `api-worker` không chạy trên glibc.
#
# OCR là PaddleOCR dò vùng + VietOCR đọc chữ (`scripts/ocr-server.py`), chốt
# 2026-09-19 thay Tesseract. Model tải LÚC DỰNG vào `/app/.models` để container
# chạy không cần mạng; VietOCR mặc định tải cả YAML cấu hình lẫn trọng số từ
# vocr.vn mỗi lần khởi động.
#
# ⚠️ Image này KHÔNG chứa `.env.local`. Máy chủ truyền lúc chạy bằng `--env-file`.
FROM oven/bun:1-debian AS photo-check
WORKDIR /app

# `libgl1`, `libglib2.0-0`: opencv trong paddleocr cần. `libgomp1`: paddle cần.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv libgl1 libglib2.0-0 libgomp1 tzdata \
  && rm -rf /var/lib/apt/lists/*

# torch lấy từ kho CPU của PyTorch: bản trên PyPI kèm CUDA nặng thêm 700 MB
# mà máy chủ không có GPU. `setuptools<70` vì `gdown` (vietocr kéo theo) còn
# import `pkg_resources`.
RUN python3 -m venv /app/.venv \
  && /app/.venv/bin/pip install --no-cache-dir "setuptools<70" \
  && /app/.venv/bin/pip install --no-cache-dir torch==2.14.0 torchvision==0.29.0 \
       --index-url https://download.pytorch.org/whl/cpu \
  && /app/.venv/bin/pip install --no-cache-dir paddlepaddle==3.3.1 paddleocr==3.7.0 vietocr==0.3.12
ENV OCR_PYTHON=/app/.venv/bin/python

ENV PADDLE_PDX_CACHE_HOME=/app/.models/paddlex \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
COPY scripts/ocr-server.py ./scripts/
RUN /app/.venv/bin/python scripts/ocr-server.py --tai-model /app/.models
ENV OCR_CONFIG=/app/.models/vgg_transformer.yml \
    OCR_WEIGHTS=/app/.models/vgg_transformer.pth \
    OCR_SEQ2SEQ_CONFIG=/app/.models/vgg_seq2seq.yml \
    OCR_SEQ2SEQ_WEIGHTS=/app/.models/vgg_seq2seq.pth

# Hai luồng cho torch và paddle: container giới hạn 4 lõi, một ảnh một lúc.
ENV OCR_THREADS=2 OMP_NUM_THREADS=2

COPY package.json bun.lock ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY scripts/photo-check-worker.ts scripts/ocr-try.ts ./scripts/

ENV TZ=Asia/Ho_Chi_Minh

RUN chown -R bun:bun /app/.models
USER bun

ENTRYPOINT ["bun", "scripts/photo-check-worker.ts"]
