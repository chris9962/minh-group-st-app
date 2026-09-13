#!/usr/bin/env bash
# Tải model tiếng Việt bản CHÍNH XÁC của Tesseract về `.tessdata/`.
#
# Bản đi kèm Homebrew nặng 531 KB và đọc ảnh chụp lại màn hình kém hơn hẳn bản
# `tessdata_best` nặng 12,4 MB. `src/server/ocr/image.ts` tự dùng `.tessdata`
# khi thư mục này có mặt, không cần đặt thêm trường môi trường nào.
#
# Chạy một lần trên máy local. Trên máy chủ, Dockerfile tự tải lúc dựng image.
set -euo pipefail

dir="$(cd "$(dirname "$0")/.." && pwd)/.tessdata"
mkdir -p "$dir"
out="$dir/vie.traineddata"

if [ -f "$out" ]; then
  echo "Đã có $out"
  exit 0
fi

echo "Tải vie.traineddata, 12,4 MB..."
curl -fsSL --max-time 300 \
  "https://github.com/tesseract-ocr/tessdata_best/raw/main/vie.traineddata" -o "$out"
echo "Xong: $out"
