#!/usr/bin/env bash
# Dựng lại và thay container `mgst-zalo-worker`, worker bot Zalo chạy bằng tài
# khoản Zalo cá nhân. Chạy trên máy chủ, sau `deploy.sh` khi có sửa ở
# `scripts/zalo-bot-worker.ts` hoặc `src/server`:
#
#   cd /opt/mgst-app && ./deploy/worker-zalo.sh
#
# `deploy.sh` đã chạy migration, trong đó có 0103 và 0104 của bot Zalo. Script
# này chỉ thử lại bằng `--check` rồi mới thay container.
#
# Phiên đăng nhập Zalo nằm trong volume `mgst-zalo-session`, không mất khi thay
# container. Lần chạy ĐẦU chưa có phiên: mở màn Bot Zalo trên app rồi quét mã QR
# bằng app Zalo của tài khoản dùng làm bot.
#
# ⚠️ Mỗi tài khoản Zalo chỉ giữ một kết nối nhận tin. Không chạy `zalo:worker` ở
# máy khác bằng cùng tài khoản trong lúc container này chạy: hai nơi sẽ ngắt
# kết nối của nhau.
#
# Không đụng `mgst-api-worker` và `mgst-photo-check`.
source "$(dirname "${BASH_SOURCE[0]}")/worker-lib.sh"

echo "== Dựng image mgst-zalo-worker:new =="
echo "HEAD: $(git log --oneline -1)"
docker build --target zalo-worker -t mgst-zalo-worker:new .

echo "== Thử image =="
# `--check` đọc các bảng Zalo qua đúng đường database container sẽ dùng, rồi
# thoát. Không đăng nhập Zalo, nên không ngắt phiên của container đang chạy.
docker run --rm "${CHUNG[@]}" mgst-zalo-worker:new --check

echo "== Thay mgst-zalo-worker =="
# `dung_container` gửi SIGTERM trước: worker cũ đóng kết nối Zalo và ghi trạng
# thái dừng, container mới mở kết nối sau đó.
dung_container mgst-zalo-worker
docker run -d --name mgst-zalo-worker --restart unless-stopped \
  -v mgst-zalo-session:/app/session \
  "${CHUNG[@]}" \
  mgst-zalo-worker:new >/dev/null

sleep 5
docker tag mgst-zalo-worker:new mgst-zalo-worker:latest
echo
docker ps --filter "name=mgst-zalo-worker" --format '  {{.Names}}\t{{.Status}}'
echo
echo "XONG. mgst-zalo-worker đang chạy $(git log --oneline -1). Xem log: docker logs -f mgst-zalo-worker"
