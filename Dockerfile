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
  && chown -R pwuser:pwuser /app/session /app/pvi-qlcd-playwright

USER pwuser

# Trang PVI có lớp chống bot, chạy headless dễ bị chặn — nên Chromium chạy CÓ
# giao diện trên màn hình ảo của Xvfb. Bỏ `xvfb-run` là mọi lượt mở trang hỏng.
CMD ["xvfb-run", "-a", "bun", "pvi-qlcd-playwright/worker.ts"]
