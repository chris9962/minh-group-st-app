#!/usr/bin/env bash
# Dựng hoặc cập nhật bản demo. Chạy trên máy chủ, trong clone RIÊNG của demo:
#
#   cd /opt/mgst-demo && git pull && ./deploy/deploy-demo.sh
#
# Lần đầu và các lần sau cùng một lệnh: thiếu mạng hay container database thì
# script tạo, có rồi thì dùng lại. Việc làm tay một lần (clone, `.env.local`,
# Nginx, HTTPS) xem docs/plan-deploy-demo-2026-09-29.md.
#
# Không đụng production: không đọc `/opt/mgst-app`, không dùng tag
# `mgst-app:latest`/`:new`, không reload Nginx.
set -euo pipefail

GOC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$GOC"

APP=mgst-demo-app
DB=mgst-demo-db
MANG=mgst-demo-net
VOLUME=mgst-demo-pgdata
IMAGE=mgst-app:demo
CONG_APP=3100
CONG_DB=5434
MAU_LOI='ECONNREFUSED\|ERR_DLOPEN\|Failed query\|Cannot find\|Failed to load'

ma_http() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${CONG_APP}$1"; }

echo "== 1/6 Kiểm env =="
# `bun run db:*` đọc `.env.local` của thư mục đang đứng. Chạy nhầm script này
# trong `/opt/mgst-app` là migrate và seed thẳng vào database production.
[ -f .env.local ] || { echo "Thiếu $GOC/.env.local, chép từ .env.demo.example" >&2; exit 1; }
grep -q '^DEMO_MODE=1$' .env.local || { echo "DỪNG: .env.local không có DEMO_MODE=1" >&2; exit 1; }
DB_URL_HOST="$(sed -n 's#^DATABASE_URL=##p' .env.local)"
case "$DB_URL_HOST" in
  *@localhost:${CONG_DB}/mgst_demo) ;;
  *) echo "DỪNG: DATABASE_URL phải trỏ localhost:${CONG_DB}/mgst_demo" >&2; exit 1 ;;
esac
DB_PASS="$(printf '%s' "$DB_URL_HOST" | sed -n 's#^postgres://mgst_demo:\(.*\)@localhost.*#\1#p')"
[ -n "$DB_PASS" ] && [ "$DB_PASS" != "<mật khẩu>" ] || { echo "DỪNG: chưa điền mật khẩu database demo" >&2; exit 1; }
# Trong mạng Docker, app gọi database bằng tên container. Cổng 5434 chỉ mở ở
# 127.0.0.1 của máy chủ nên `host.docker.internal` như production không tới được.
DB_URL_APP="${DB_URL_HOST/@localhost:${CONG_DB}\//@${DB}:5432/}"
echo "  env: đạt"

echo "== 2/6 Lấy code, cài gói =="
git fetch origin main
git reset --hard origin/main
echo "  HEAD: $(git log --oneline -1)"
bun install --frozen-lockfile

echo "== 3/6 Database demo =="
docker network inspect "$MANG" >/dev/null 2>&1 || docker network create "$MANG" >/dev/null
if ! docker container inspect "$DB" >/dev/null 2>&1; then
  # `--memory-swap` bằng `--memory` để container không dùng swap. Vượt trần thì
  # Docker dừng đúng container này, Postgres production không bị kéo theo.
  docker run -d --name "$DB" --restart unless-stopped \
    --network "$MANG" \
    --memory 1g --memory-swap 1g --cpus 1 --shm-size 256m \
    --log-opt max-size=10m --log-opt max-file=3 \
    -e POSTGRES_DB=mgst_demo -e POSTGRES_USER=mgst_demo -e POSTGRES_PASSWORD="$DB_PASS" \
    -p "127.0.0.1:${CONG_DB}:5432" \
    -v "$VOLUME":/var/lib/postgresql/data \
    postgres:16-alpine -c statement_timeout=30s >/dev/null
  echo "  đã tạo $DB"
fi
docker start "$DB" >/dev/null
for _ in $(seq 30); do
  docker exec "$DB" pg_isready -U mgst_demo -d mgst_demo >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$DB" pg_isready -U mgst_demo -d mgst_demo >/dev/null || { echo "KHÔNG ĐẠT: $DB không nhận kết nối" >&2; exit 1; }

# Seed idempotent: bảng đã có dữ liệu thì bỏ qua, nên chạy mỗi lần không sao.
bun run db:migrate
bun run db:seed

echo "== 4/6 Dựng image $IMAGE =="
# Giữ image đang chạy làm bản lùi trước khi build đè tag.
docker image inspect "$IMAGE" >/dev/null 2>&1 && docker tag "$IMAGE" mgst-app:demo-cu
# Build chiếm CPU khoảng 6 phút. Kẹp 4 nhân để production còn 4 nhân. Máy chủ
# chưa có buildx nên đây là builder cổ điển, builder đó nhận hai tham số này.
docker build --target runner --cpuset-cpus 0-3 --memory 4g -t "$IMAGE" .

chay_app() {
  docker rm -f "$APP" >/dev/null 2>&1 || true
  docker run -d --name "$APP" --restart unless-stopped \
    --network "$MANG" \
    --memory 1g --memory-swap 1g --cpus 1 \
    -p "127.0.0.1:${CONG_APP}:3000" \
    --log-opt max-size=10m --log-opt max-file=3 \
    --env-file "$GOC/.env.local" \
    -e DATABASE_URL="$DB_URL_APP" \
    "$1" >/dev/null
  sleep 8
}

echo "== 5/6 Đổi container app =="
chay_app "$IMAGE"

echo "== 6/6 Kiểm =="
MA_LOGIN="$(ma_http /login)"
MA_API="$(ma_http /api/customers)"
LOI="$(docker logs "$APP" 2>&1 | grep -c "$MAU_LOI" || true)"
echo "  /login → $MA_LOGIN, /api/customers → $MA_API, lỗi trong log: $LOI"

if [ "$MA_LOGIN" = "200" ] && [ "$MA_API" = "401" ] && [ "$LOI" = "0" ]; then
  echo
  echo "DEMO XONG. Đang chạy $(git log --oneline -1)."
  docker stats --no-stream --format '  {{.Name}}: {{.MemUsage}}, CPU {{.CPUPerc}}' "$APP" "$DB"
  exit 0
fi

echo "KHÔNG ĐẠT" >&2
docker logs "$APP" 2>&1 | tail -20 >&2
if docker image inspect mgst-app:demo-cu >/dev/null 2>&1; then
  echo "Lùi về mgst-app:demo-cu" >&2
  chay_app mgst-app:demo-cu
  echo "  bản cũ: /login → $(ma_http /login)" >&2
fi
exit 1
