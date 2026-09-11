#!/usr/bin/env bash
# Phần dùng chung của `worker-api.sh` và `worker-photo.sh`. KHÔNG chạy trực
# tiếp, hai script kia `source` vào.
#
# Hai worker dùng chung MỘT image `mgst-api-worker` (tầng `api-worker` của
# Dockerfile), khác entrypoint. Cờ `docker run` để một chỗ: lượt 2026-09-08 và
# 2026-09-10 gõ tay theo ghi chú, mỗi lượt thiếu một cờ (`--add-host`,
# `DATABASE_URL`, `--log-opt`), container Up mà không nối database hay log đầy
# đĩa, chỉ hiện ra sau vài giờ.
set -euo pipefail

GOC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$GOC"

DB_URL=postgres://mgst:mgst@host.docker.internal:5433/mgst

# `--add-host` cộng `DATABASE_URL` là đường tới database: `localhost:5433`
# trong `.env.local` chỉ đúng từ host, trong container bridge là chính nó.
CHUNG=(
  --add-host host.docker.internal:host-gateway
  --log-opt max-size=10m --log-opt max-file=3
  --env-file "$GOC/.env.local"
  -e DATABASE_URL="$DB_URL"
)

dung_image() {
  echo "== Dựng image mgst-api-worker:new =="
  echo "HEAD: $(git log --oneline -1)"
  # Docker cache theo tầng: không đổi gì thì bước này vài giây.
  docker build --target api-worker -t mgst-api-worker:new .
}

# `stop` trước `rm`: worker nhận SIGTERM thì kết thúc sau vòng đang chạy, không
# bỏ dở việc giữa chừng. Chờ tối đa 60 giây.
dung_container() {
  docker stop -t 60 "$1" >/dev/null 2>&1 || true
  docker rm "$1" >/dev/null 2>&1 || true
}

xong() {
  sleep 5
  docker tag mgst-api-worker:new mgst-api-worker:latest
  echo
  docker ps --filter "name=$1" --format '  {{.Names}}\t{{.Status}}'
  echo
  echo "XONG. $1 đang chạy $(git log --oneline -1). Xem log: docker logs -f $1"
}
