#!/usr/bin/env bash
# Bật chế độ bảo trì. Tham số là số phút dự kiến, mặc định 15.
#
#   ./deploy/bat-bao-tri.sh        # 15 phút
#   ./deploy/bat-bao-tri.sh 30     # 30 phút
#
# Không cần `nginx -t` lẫn `systemctl reload nginx`: Nginx kiểm sự tồn tại của
# file `on` ở từng request, xem `deploy/nginx/app.conf`.
set -euo pipefail

THU_MUC="$(cd "$(dirname "${BASH_SOURCE[0]}")/maintenance" && pwd)"
SO_PHUT="${1:-15}"

if ! [[ "$SO_PHUT" =~ ^[0-9]+$ ]] || [ "$SO_PHUT" -lt 1 ]; then
  echo "Số phút phải là số nguyên dương. Nhận được: $SO_PHUT" >&2
  exit 1
fi

# GNU date trên Ubuntu dùng `-d`, BSD date trên macOS dùng `-v`. Máy chủ là
# Ubuntu; nhánh BSD để chạy thử được trên máy lập trình.
if date -u -d "+1 minute" >/dev/null 2>&1; then
  MOC="$(date -u -d "+${SO_PHUT} minutes" +%Y-%m-%dT%H:%M:%SZ)"
else
  MOC="$(date -u -v "+${SO_PHUT}M" +%Y-%m-%dT%H:%M:%SZ)"
fi

# Ghi mốc giờ TRƯỚC khi tạo file đánh dấu. Ngược lại thì có một khoảnh khắc
# trang bảo trì đã hiện mà chưa đọc được mốc giờ, và người dùng thấy trang không
# có đếm ngược.
printf '%s\n' "$MOC" > "$THU_MUC/until.txt"
touch "$THU_MUC/on"

echo "Đã bật bảo trì. Dự kiến xong lúc $MOC (giờ UTC), tức $SO_PHUT phút nữa."
echo "Tắt bằng: $(dirname "${BASH_SOURCE[0]}")/tat-bao-tri.sh"
