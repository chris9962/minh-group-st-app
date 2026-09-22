#!/usr/bin/env bash
# Phần dùng chung của `worker-api.sh` và `worker-photo.sh`. KHÔNG chạy trực
# tiếp, hai script kia `source` vào.
#
# Hai worker hai image (`mgst-api-worker` tầng `api-worker`, `mgst-photo-check`
# tầng `photo-check`) nhưng chung cờ `docker run`, để một chỗ: lượt 2026-09-08 và
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

# Một biến trong `.env.local`, hoặc giá trị mặc định khi file không có dòng đó.
# Dùng cho cờ của `docker run` như `--cpus`: cờ nằm ngoài container nên
# `--env-file` không tới được, phải đọc ở tầng shell.
#
# `grep` chứ không `source`: file đó có dòng chứa dấu `$` và dấu cách trong
# khoá S3, nạp thẳng vào shell là nó diễn giải sai.
doc_env() {
  local dong
  dong="$(grep -E "^${1}=" "$GOC/.env.local" 2>/dev/null | tail -1)" || true
  dong="${dong#*=}"
  dong="${dong%\"}"; dong="${dong#\"}"
  dong="${dong%\'}"; dong="${dong#\'}"
  echo "${dong:-$2}"
}

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
