#!/usr/bin/env bash
# Đẩy ảnh còn nằm trên đĩa lên FPT Object Storage. Chạy MỘT LẦN lúc chuyển kho.
#
#   ./deploy/upload-existing-images.sh --dry-run   # chỉ liệt kê, không gửi gì
#   ./deploy/upload-existing-images.sh
#
# Thư mục nguồn mặc định là `public/uploads` — chỗ bản cũ ghi ảnh. Đường dẫn
# tương đối trong thư mục đó CHÍNH LÀ khoá trên kho, nên
# `public/uploads/bank-accounts/2026-08-20/abc.jpg` lên thành
# `bank-accounts/2026-08-20/abc.jpg`. Đó cũng là giá trị migration 0031 để lại
# trong database.
#
# Dùng `curl --aws-sigv4` chứ không dùng SDK: máy chủ không cài Node, và bun có
# lỗi phân giải module với @aws-sdk khi chạy script rời.
set -euo pipefail

GOC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NGUON="${NGUON:-$GOC/public/uploads}"
CHAY_THU=0
[ "${1:-}" = "--dry-run" ] && CHAY_THU=1

# shellcheck disable=SC1090
set -a; . "$GOC/.env.local"; set +a

for bien in S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  if [ -z "${!bien:-}" ]; then
    echo "Thiếu $bien trong .env.local" >&2
    exit 1
  fi
done

if [ ! -d "$NGUON" ]; then
  echo "Không có thư mục $NGUON, không có gì để đẩy."
  exit 0
fi

kieu_theo_duoi() {
  case "${1##*.}" in
    jpg|jpeg) echo "image/jpeg" ;;
    png)      echo "image/png" ;;
    webp)     echo "image/webp" ;;
    heic)     echo "image/heic" ;;
    *)        echo "application/octet-stream" ;;
  esac
}

SIGV4="aws:amz:${S3_REGION}:s3"
DA_DAY=0; DA_CO=0; HONG=0

while IFS= read -r duong; do
  khoa="${duong#"$NGUON"/}"
  url="${S3_ENDPOINT}/${S3_BUCKET}/${khoa}"

  # Có rồi thì bỏ qua. Chạy lại script lần hai không đẩy lại từ đầu, và không
  # ghi đè ảnh mà người dùng đã tải lên sau đó.
  ma="$(curl -s -o /dev/null -w "%{http_code}" -I --aws-sigv4 "$SIGV4" \
        --user "${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}" "$url" || true)"
  if [ "$ma" = "200" ]; then
    DA_CO=$((DA_CO + 1))
    continue
  fi

  if [ "$CHAY_THU" = "1" ]; then
    echo "[chạy thử] sẽ đẩy: $khoa"
    DA_DAY=$((DA_DAY + 1))
    continue
  fi

  ma="$(curl -s -o /dev/null -w "%{http_code}" -X PUT -T "$duong" \
        -H "Content-Type: $(kieu_theo_duoi "$duong")" \
        --aws-sigv4 "$SIGV4" \
        --user "${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}" "$url" || true)"

  if [ "$ma" = "200" ] || [ "$ma" = "201" ]; then
    DA_DAY=$((DA_DAY + 1))
    echo "đã đẩy: $khoa"
  else
    HONG=$((HONG + 1))
    echo "HỎNG ($ma): $khoa" >&2
  fi
done < <(find "$NGUON" -type f)

echo
echo "Đã đẩy: $DA_DAY · Đã có sẵn: $DA_CO · Hỏng: $HONG"
[ "$HONG" -gt 0 ] && exit 1
exit 0
