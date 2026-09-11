#!/usr/bin/env bash
# Dựng lại image worker và thay HAI container worker. Chạy trên máy chủ, sau
# `deploy.sh` (script đó KHÔNG đụng worker nào):
#
#   cd /opt/mgst-app && ./deploy/workers.sh
#
# Hai container dùng chung một image `mgst-api-worker`, khác entrypoint:
#
#   mgst-api-worker    tạo đơn PVI qua API đối tác   scripts/pvi-api-worker.ts
#   mgst-photo-check   xác thực ảnh bằng OCR          scripts/photo-check-worker.ts
#
# Vì sao là script: lượt 2026-09-08 và 2026-09-10 gõ tay `docker run` theo ghi
# chú, mỗi lượt lại thiếu một cờ (`--add-host`, `DATABASE_URL`, `--log-opt`).
# Container chạy được nhưng không nối database hay log đầy đĩa, mà chỉ hiện ra
# sau vài giờ. Script chạy y hệt mỗi lần.
#
# Không bật bảo trì: worker không phục vụ request nào. Nhân viên vẫn dùng app
# suốt lúc dựng; đơn PVI và lượt xác thực chỉ đợi thêm vài phút.
set -euo pipefail

GOC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$GOC"

DB_URL=postgres://mgst:mgst@host.docker.internal:5433/mgst

# Cờ chung cho mọi container worker. `--add-host` cộng `DATABASE_URL` là đường
# tới database: `localhost:5433` trong `.env.local` chỉ đúng từ host.
CHUNG=(
  --add-host host.docker.internal:host-gateway
  --log-opt max-size=10m --log-opt max-file=3
  --env-file "$GOC/.env.local"
  -e DATABASE_URL="$DB_URL"
)

echo "== 1/4 Dựng image mgst-api-worker:new =="
echo "HEAD: $(git log --oneline -1)"
docker build --target api-worker -t mgst-api-worker:new .

echo "== 2/4 Thử image =="
# `--check` chỉ kiểm cấu hình và chữ ký PVI rồi thoát. KHÔNG dùng `--mot-vong`:
# cờ đó TẠO ĐƠN THẬT trên PVI nếu hàng chờ có đơn (đã trả giá 2026-09-10).
docker run --rm "${CHUNG[@]}" mgst-api-worker:new --check
# Tesseract và gói tiếng Việt phải có trong image, không thì worker xác thực
# ghi `failed` cho mọi lượt mà container vẫn Up.
docker run --rm --entrypoint tesseract mgst-api-worker:new --list-langs | grep -qx vie
echo "  tesseract: có gói vie"

echo "== 3/4 Thay mgst-api-worker =="
# `stop` trước `rm`: worker nhận SIGTERM thì kết thúc sau vòng đang chạy, không
# bỏ dở một đơn giữa lúc gọi PVI. Chờ tối đa 60 giây.
docker stop -t 60 mgst-api-worker >/dev/null 2>&1 || true
docker rm mgst-api-worker >/dev/null 2>&1 || true
docker run -d --name mgst-api-worker --restart unless-stopped \
  "${CHUNG[@]}" \
  mgst-api-worker:new >/dev/null

echo "== 4/4 Thay mgst-photo-check =="
# `--cpus 4`: worker mở tới 12 tiến trình Tesseract cùng lúc (4 tài khoản × 3
# lượt đọc), không giới hạn thì chiếm hết 8 lõi trong lúc quét bù và app chậm
# theo. `--memory 1g`: đo 2026-09-12 cả worker dưới 600 MB; vượt thì Docker chỉ
# dừng container này, không đụng app và Postgres.
docker stop -t 60 mgst-photo-check >/dev/null 2>&1 || true
docker rm mgst-photo-check >/dev/null 2>&1 || true
docker run -d --name mgst-photo-check --restart unless-stopped \
  --cpus 4 --memory 1g \
  "${CHUNG[@]}" \
  --entrypoint bun mgst-api-worker:new scripts/photo-check-worker.ts >/dev/null

sleep 5
docker tag mgst-api-worker:new mgst-api-worker:latest
echo
docker ps --filter name=mgst-api-worker --filter name=mgst-photo-check --format '  {{.Names}}\t{{.Status}}'
echo
echo "WORKER XONG. Đang chạy $(git log --oneline -1)."
echo "Xem log: docker logs -f mgst-photo-check"
