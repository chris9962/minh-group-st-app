#!/usr/bin/env bash
# Dựng lại và thay container `mgst-photo-check`, worker xác thực ảnh chứng minh
# bằng OCR. Chạy trên máy chủ, sau `deploy.sh` khi có sửa ở
# `scripts/photo-check-worker.ts`, `scripts/ocr-server.py` hoặc `src/server/ocr`:
#
#   cd /opt/mgst-app && ./deploy/worker-photo.sh
#
# Image RIÊNG `mgst-photo-check` (tầng `photo-check`, từ 2026-09-19), không còn
# dùng chung `mgst-api-worker`: OCR là Python + torch + paddle, worker PVI
# không cần. Lần dựng đầu tải khoảng 1,5 GB gói và model, mất 5 đến 10 phút;
# các lần sau Docker cache tầng đó, chỉ dựng lại phần mã nguồn.
#
# Không đụng `mgst-api-worker`: sửa OCR không có lý do gì dừng tạo đơn PVI.
#
# Lùi về bản Tesseract cũ: `docker run ... --entrypoint bun mgst-api-worker:latest
# scripts/photo-check-worker.ts` với cờ `--cpus 4 --memory 1g`, image đó còn
# trên máy chủ tới lượt dựng `api-worker` kế tiếp.
source "$(dirname "${BASH_SOURCE[0]}")/worker-lib.sh"

echo "== Dựng image mgst-photo-check:new =="
echo "HEAD: $(git log --oneline -1)"
docker build --target photo-check -t mgst-photo-check:new .

echo "== Thử image =="
# Tiến trình OCR phải nạp được model và trả `ready`, không thì worker ghi
# `failed` cho mọi lượt mà container vẫn Up. Thử bằng chính script worker gọi.
READY="$(echo '' | docker run --rm -i --entrypoint /app/.venv/bin/python mgst-photo-check:new scripts/ocr-server.py 2>/dev/null | head -1)"
[ "$READY" = '{"ready": true}' ] || { echo "KHÔNG ĐẠT: OCR không sẵn sàng, in ra: $READY" >&2; exit 1; }
echo "  ocr-server: ready"

echo "== Thay mgst-photo-check =="
# `--cpus 4`: torch và paddle mỗi bên 2 luồng (`OCR_THREADS`), một ảnh một lúc.
# `--memory 4g`: torch + paddle + hai model nằm trong RAM, đo local 2026-09-19
# khoảng 2 GB; vượt thì Docker chỉ dừng container này, không đụng app và
# Postgres.
dung_container mgst-photo-check
docker run -d --name mgst-photo-check --restart unless-stopped \
  --cpus 4 --memory 4g \
  "${CHUNG[@]}" \
  mgst-photo-check:new >/dev/null

sleep 5
docker tag mgst-photo-check:new mgst-photo-check:latest
echo
docker ps --filter "name=mgst-photo-check" --format '  {{.Names}}\t{{.Status}}'
echo
echo "XONG. mgst-photo-check đang chạy $(git log --oneline -1). Xem log: docker logs -f mgst-photo-check"
