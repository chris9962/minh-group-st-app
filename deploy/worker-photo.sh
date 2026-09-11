#!/usr/bin/env bash
# Dựng lại và thay container `mgst-photo-check`, worker xác thực ảnh chứng minh
# bằng OCR. Chạy trên máy chủ, sau `deploy.sh` khi có sửa ở
# `scripts/photo-check-worker.ts` hoặc `src/server/ocr`:
#
#   cd /opt/mgst-app && ./deploy/worker-photo.sh
#
# Không đụng `mgst-api-worker`: sửa OCR không có lý do gì dừng tạo đơn PVI.
source "$(dirname "${BASH_SOURCE[0]}")/worker-lib.sh"

dung_image

echo "== Thử image =="
# Tesseract và gói tiếng Việt phải có trong image, không thì worker ghi `failed`
# cho mọi lượt mà container vẫn Up.
docker run --rm --entrypoint tesseract mgst-api-worker:new --list-langs | grep -qx vie
echo "  tesseract: có gói vie"

echo "== Thay mgst-photo-check =="
# `--cpus 4`: worker mở tới 12 tiến trình Tesseract cùng lúc (4 tài khoản × 3
# lượt đọc), không giới hạn thì chiếm hết 8 lõi trong lúc quét bù và app chậm
# theo. `--memory 1g`: đo 2026-09-12 cả worker dưới 600 MB; vượt thì Docker chỉ
# dừng container này, không đụng app và Postgres.
dung_container mgst-photo-check
docker run -d --name mgst-photo-check --restart unless-stopped \
  --cpus 4 --memory 1g \
  "${CHUNG[@]}" \
  --entrypoint bun mgst-api-worker:new scripts/photo-check-worker.ts >/dev/null

xong mgst-photo-check
