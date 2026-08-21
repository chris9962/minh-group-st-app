#!/usr/bin/env bash
# Tắt chế độ bảo trì. Xoá file đánh dấu là request quay lại app ngay request kế tiếp.
set -euo pipefail

THU_MUC="$(cd "$(dirname "${BASH_SOURCE[0]}")/maintenance" && pwd)"

if [ ! -f "$THU_MUC/on" ]; then
  echo "Không ở chế độ bảo trì, không có gì để tắt."
  exit 0
fi

rm -f "$THU_MUC/on" "$THU_MUC/until.txt"
echo "Đã tắt bảo trì."
