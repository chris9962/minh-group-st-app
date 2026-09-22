#!/usr/bin/env bash
# Dựng lại và thay container `mgst-photo-check`, worker xác thực ảnh chứng minh
# bằng OCR. Chạy trên máy chủ, sau `deploy.sh` khi có sửa ở
# `scripts/photo-check-worker.ts`, `scripts/ocr-server.py` hoặc `src/server/ocr`:
#
#   cd /opt/mgst-app && ./deploy/worker-photo.sh
#
# Chạy nhanh hay chậm ĐỌC TỪ `.env.local`, không sửa file này (chốt
# 2026-09-22). Ba biến đi CÙNG NHAU, đổi một cái phải xem hai cái kia:
#
#   OCR_PROCESSES=3          số tiến trình Python, mỗi tiến trình đọc một ảnh
#   PHOTO_CHECK_CPUS=6       trần CPU của container
#   PHOTO_CHECK_MEMORY=6g    trần RAM của container
#
# Cỡ đo trên máy chủ 2026-09-22: mỗi tiến trình ăn khoảng 2 nhân và 0,9 GB, một
# tài khoản mất 15,5 giây với một tiến trình. Máy 8 nhân, chừa 2 nhân cho app
# và Postgres, nên 3 tiến trình là mức cao nhất nên đặt. Đặt `OCR_PROCESSES`
# cao hơn trần CPU thì các tiến trình giành nhau và chậm hơn chứ không nhanh
# hơn. Không đặt gì thì giữ nguyên mức cũ: 1 tiến trình, 4 nhân, 4 GB.
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
# `--cpus` và `--memory` là cờ của `docker run` nên container không tự đọc được
# từ `--env-file`; phải lấy ở tầng shell. `OCR_PROCESSES` thì đi thẳng xuống
# container qua `--env-file` trong `CHUNG`, không cần đọc ở đây.
#
# Trần RAM tính theo số tiến trình: vượt thì Docker chỉ dừng container này,
# không đụng app và Postgres, nhưng hàng chờ nằm im cho tới lượt khởi động sau.
SO_CPU="$(doc_env PHOTO_CHECK_CPUS 4)"
RAM="$(doc_env PHOTO_CHECK_MEMORY 4g)"
echo "  $(doc_env OCR_PROCESSES 1) tiến trình OCR, trần $SO_CPU nhân và $RAM"
dung_container mgst-photo-check
docker run -d --name mgst-photo-check --restart unless-stopped \
  --cpus "$SO_CPU" --memory "$RAM" \
  "${CHUNG[@]}" \
  mgst-photo-check:new >/dev/null

sleep 5
docker tag mgst-photo-check:new mgst-photo-check:latest
echo
docker ps --filter "name=mgst-photo-check" --format '  {{.Names}}\t{{.Status}}'
echo
echo "XONG. mgst-photo-check đang chạy $(git log --oneline -1). Xem log: docker logs -f mgst-photo-check"
