#!/usr/bin/env bash
# Gọi API đối tác PVI bằng curl — CHỈ ĐỌC, không tạo đơn nào.
#
# Gọi mục 14 `GetPolicyNumber`. Chữ ký của mục này là MD5(Key + RequestId),
# ngắn nhất trong 15 công thức nên dựng bằng shell được.
#
#   bash scripts/pvi-curl.sh          gọi thật
#   bash scripts/pvi-curl.sh --print  chỉ in lệnh curl, không gọi
#
# ⚠️ Lệnh in ra mang CpId và Sign. Đừng dán vào chỗ nhiều người đọc được.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env.local; set +a

BASE="${PVI_API_BASE_URL:-http://piastest.pvi.com.vn}"
CPID="${PVI_API_CPID:-${PVI_CPID:-}}"
KEY="${PVI_API_KEY:-${PVI_KEY:-}}"
REQ="${1:-MGST-SMOKE-KHONG-TON-TAI}"
[ "$REQ" = "--print" ] && REQ="MGST-SMOKE-KHONG-TON-TAI"

[ -n "$CPID" ] || { echo "Thiếu PVI_CPID trong .env.local" >&2; exit 1; }
[ -n "$KEY" ]  || { echo "Thiếu PVI_KEY trong .env.local" >&2; exit 1; }

SIGN=$(printf '%s' "${KEY}${REQ}" | openssl md5 -r | cut -d' ' -f1)
URL="${BASE}/API_CP/ManagerApplication/GetPolicyNumber"
BODY=$(printf '{"RequestId":"%s","CpId":"%s","Sign":"%s"}' "$REQ" "$CPID" "$SIGN")

echo "curl -sS --max-time 30 -X POST '$URL' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '$BODY'"

[ "${1:-}" = "--print" ] && exit 0

echo
echo "--- phản hồi ---"
curl -sS -i --max-time 30 -X POST "$URL" -H 'Content-Type: application/json' -d "$BODY" || true
