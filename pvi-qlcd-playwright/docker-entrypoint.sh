#!/bin/sh
# Khởi động worker PVI trong container: dựng màn hình ảo rồi giao quyền cho bun.
#
# KHÔNG dùng `xvfb-run`. Đo 2026-08-28 trên VM FPT: chạy ở vị trí PID 1 thì
# `xvfb-run` dựng xong Xvfb rồi dừng, không bao giờ gọi tới lệnh phía sau.
# Container báo `Up`, không in log, không làm gì. Cùng lệnh đó qua `docker exec`
# lại chạy bình thường, nên không phải lỗi thiếu gói.
#
# `exec` ở dòng cuối làm bun thành PID 1, nhờ đó `docker stop` gửi SIGTERM thẳng
# tới worker và nó dừng gọn sau vòng đang chạy.
set -e

# `docker restart` giữ lại tầng ghi cũ, nên lock của lần chạy trước còn đó và
# Xvfb từ chối dựng lại trên cùng số màn hình.
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
export DISPLAY=:99

# Đợi socket thay vì `sleep` một số cố định: máy chậm thì 3 giây không đủ, máy
# nhanh thì 3 giây là phí.
i=0
while [ ! -e /tmp/.X11-unix/X99 ]; do
  i=$((i + 1))
  if [ "$i" -gt 40 ]; then
    echo "Xvfb không dựng xong sau 20 giây:" >&2
    cat /tmp/xvfb.log >&2
    exit 1
  fi
  sleep 0.5
done

exec bun pvi-qlcd-playwright/worker.ts "$@"
