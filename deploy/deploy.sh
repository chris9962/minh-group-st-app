#!/usr/bin/env bash
# Deploy một bản mới lên máy chủ. Chạy trên máy chủ:
#
#   cd /opt/mgst-app && git pull && ./deploy/deploy.sh
#
# Hai pha. PHA 1 không bảo trì: lấy code, cài gói, dựng image, thử image, sao
# lưu database — không bước nào đụng container đang chạy, nhân viên vẫn dùng
# bình thường suốt 6 phút build. PHA 2 bật bảo trì đúng lúc đổi container,
# khoảng 20 giây; kiểm không đạt thì tự lùi về bản cũ rồi mới tắt bảo trì.
#
# Vì sao là script chứ không phải danh sách lệnh trong docs: 2026-09-05 gõ tay
# theo trí nhớ sai bốn lượt liền — thiếu `--target runner`, thiếu `--add-host`,
# rồi `%{code}` thay vì `%{http_code}` trong curl. Mỗi lỗi là một lần dựng lại
# container trên production. Script chạy y hệt mỗi lần, không có chỗ gõ sai.
set -euo pipefail

GOC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$GOC"

CONG_THU=3001
TEN_THU=mgst-app-thu
DB_URL=postgres://mgst:mgst@host.docker.internal:5433/mgst
MAU_LOI='ECONNREFUSED\|ERR_DLOPEN\|Failed query\|Cannot find\|Failed to load'

ma_http() { curl -s -o /dev/null -w '%{http_code}' -X "$1" "http://127.0.0.1:$2$3"; }

# ── PHA 1 — không bảo trì ────────────────────────────────────────────────────

echo "== 1/7 Lấy code =="
git fetch origin main
git reset --hard origin/main
echo "HEAD: $(git log --oneline -1)"

echo "== 2/7 Cài gói =="
bun install --frozen-lockfile

echo "== 3/7 Dựng image mgst-app:new =="
# `--target runner` là BẮT BUỘC: tầng cuối của Dockerfile là `worker`, bỏ cờ này
# thì container app khởi động bằng bot PVI chứ không phải `bun server.js`.
# Tag `:new`, KHÔNG ghi đè `:latest` — còn `:latest` thì lùi lại được.
docker build --target runner -t mgst-app:new .

echo "== 4/7 Thử image =="
# Module native như `sharp` có thể thiếu thư viện trong image dù `bun install`
# trên host chạy được — 2026-09-05 thiếu `libvips-cpp.so`, mọi route dùng
# `server/storage.ts` chết, và chỉ hiện ra SAU khi đã đổi container thật.
docker run --rm -w /app mgst-app:new bun -e 'require("sharp"); console.log("  sharp: nạp được")'

# Chạy image ở cổng phụ, gọi vài route. Chúng nạp `server/storage.ts` ngay lúc
# import, nên module thiếu thì trả 500 trước cả bước kiểm đăng nhập; nạp được
# thì trả 401. `/login` trả 200 CHƯA nói được gì — trang đó không đọc database.
docker rm -f "$TEN_THU" >/dev/null 2>&1 || true
docker run -d --name "$TEN_THU" \
  --add-host host.docker.internal:host-gateway \
  -p "127.0.0.1:${CONG_THU}:3000" \
  --env-file "$GOC/.env.local" \
  -e DATABASE_URL="$DB_URL" \
  -e PVI_WORKER_BAT=0 \
  mgst-app:new >/dev/null
sleep 8

thu_route() {
  local mong="$1" pt="$2" duong="$3" ma
  ma="$(ma_http "$pt" "$CONG_THU" "$duong")"
  if [ "$ma" != "$mong" ]; then
    echo "KHÔNG ĐẠT: $pt $duong trả $ma, mong $mong" >&2
    docker logs "$TEN_THU" 2>&1 | tail -20 >&2
    docker rm -f "$TEN_THU" >/dev/null
    exit 1
  fi
  echo "  $pt $duong → $ma"
}
thu_route 200 GET  /login
thu_route 401 GET  /api/customers
thu_route 401 POST /api/uploads
thu_route 401 GET  /api/settings/banks

LOI="$(docker logs "$TEN_THU" 2>&1 | grep -c "$MAU_LOI" || true)"
docker rm -f "$TEN_THU" >/dev/null
if [ "$LOI" != "0" ]; then
  echo "KHÔNG ĐẠT: log container thử có $LOI dòng lỗi" >&2
  exit 1
fi
echo "  log: sạch"

echo "== 5/7 Sao lưu database =="
# Console FPT chưa có backup job nào, và migration xoá cột thì không lùi lại
# được. Sao lưu TRƯỚC khi bước 6 chạy migrate.
TEP="/root/mgst-truoc-deploy-$(date +%F-%H%M).dump"
docker exec mgst-db pg_dump -U mgst -d mgst -Fc > "$TEP"
echo "  $TEP ($(du -h "$TEP" | cut -f1))"

# ── PHA 2 — bảo trì, khoảng 20 giây ─────────────────────────────────────────

echo "== 6/7 Bật bảo trì, migrate, đổi container =="
./deploy/maintenance-on.sh 2

# Luôn chạy: drizzle chỉ áp migration còn thiếu, không có thì không làm gì.
# Chạy luôn thì không còn ca "quên migrate" — bản trước bắt người deploy tự
# nhớ, và code mới đọc cột chưa có là 500 ở mọi màn chạm cột đó.
bun run db:migrate

# GIỮ ĐÚNG MỘT bản lùi. Xoá bản lùi của lượt trước rồi mới đổi tên bản đang
# chạy, tên mang ngày giờ để biết nó là bản nào (chốt 2026-09-01).
docker rm "$(docker ps -aq --filter 'name=^mgst-app-cu')" >/dev/null 2>&1 || true
BAN_CU="mgst-app-cu-$(date +%Y%m%d-%H%M)"
docker stop mgst-app >/dev/null
docker rename mgst-app "$BAN_CU"

# Đủ CẢ NĂM tham số. `--add-host` cộng `-e DATABASE_URL` là đường tới database:
# `localhost:5433` trong `.env.local` chỉ đúng từ host, trong container bridge
# thì `localhost` là chính container. Bỏ hai dòng đó là `ECONNREFUSED` ở mọi
# truy vấn, mà `/login` VẪN trả 200.
docker run -d --name mgst-app --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  -p 127.0.0.1:3000:3000 \
  --log-opt max-size=10m --log-opt max-file=3 \
  --env-file "$GOC/.env.local" \
  -e DATABASE_URL="$DB_URL" \
  mgst-app:new >/dev/null
sleep 8

echo "== 7/7 Kiểm bản mới =="
MA_LOGIN="$(ma_http GET 3000 /login)"
MA_API="$(ma_http GET 3000 /api/customers)"
LOI="$(docker logs mgst-app 2>&1 | grep -c "$MAU_LOI" || true)"
echo "  /login → $MA_LOGIN, /api/customers → $MA_API, lỗi trong log: $LOI"

if [ "$MA_LOGIN" = "200" ] && [ "$MA_API" = "401" ] && [ "$LOI" = "0" ]; then
  docker tag mgst-app:new mgst-app:latest
  ./deploy/maintenance-off.sh
  echo
  echo "DEPLOY XONG. Đang chạy $(git log --oneline -1). Bản lùi: $BAN_CU."
  echo "Chắc bản mới ổn rồi thì dọn: docker rm $BAN_CU && docker image prune -f"
  exit 0
fi

echo "KHÔNG ĐẠT — lùi về $BAN_CU" >&2
docker logs mgst-app 2>&1 | tail -20 >&2
docker rm -f mgst-app >/dev/null
docker rename "$BAN_CU" mgst-app
docker start mgst-app >/dev/null
sleep 8
echo "  bản cũ: /login → $(ma_http GET 3000 /login)"
./deploy/maintenance-off.sh
# Lượt này có migrate thì database đã đổi mà code thì lùi. Bản cũ đọc schema
# mới thường vẫn chạy (thêm cột) nhưng KHÔNG chắc (xoá cột). Người deploy phải
# tự quyết có `pg_restore` từ $TEP không — script không tự làm, vì restore là
# mất mọi dữ liệu nhân viên nhập trong lúc bản mới chạy.
echo "ĐÃ LÙI. Nếu lượt này có migration, xem lại mục 8b trong docs/deploy-fpt-cloud.md. Bản dump: $TEP" >&2
exit 1
