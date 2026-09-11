#!/usr/bin/env bash
# Dựng lại và thay container `mgst-api-worker`, worker tạo đơn PVI qua API đối
# tác. Chạy trên máy chủ, sau `deploy.sh` khi có sửa ở `scripts/pvi-api-worker.ts`
# hoặc `src/server`:
#
#   cd /opt/mgst-app && ./deploy/worker-api.sh
#
# Không đụng `mgst-photo-check`. Không bật bảo trì: worker không phục vụ request
# nào, đơn PVI chỉ đợi thêm vài phút.
source "$(dirname "${BASH_SOURCE[0]}")/worker-lib.sh"

dung_image

echo "== Thử image =="
# `--check` chỉ kiểm cấu hình và chữ ký PVI rồi thoát. KHÔNG dùng `--mot-vong`:
# cờ đó TẠO ĐƠN THẬT trên PVI nếu hàng chờ có đơn (đã trả giá 2026-09-10).
docker run --rm "${CHUNG[@]}" mgst-api-worker:new --check

echo "== Thay mgst-api-worker =="
dung_container mgst-api-worker
docker run -d --name mgst-api-worker --restart unless-stopped \
  "${CHUNG[@]}" \
  mgst-api-worker:new >/dev/null

xong mgst-api-worker
