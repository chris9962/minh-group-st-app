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
