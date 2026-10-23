"""Đọc captcha đăng nhập của PVI Connect (baohiem.pvi.com.vn).

Dùng: python3 solve-captcha.py <đường-dẫn-ảnh>
In ra 6 ký tự chữ thường và số, hoặc chuỗi rỗng nếu không đọc được.

Captcha có chữ đen trên nền sáng, kèm 1 đường kẻ đen mảnh cắt ngang. Khác captcha 4 chữ số
màu xanh của qlcd.pvi.com.vn mà pvi-qlcd-playwright/capcha-resolver đọc.

Đo 2026-10-23 trên 6 ảnh mẫu: đúng 3/6. Job thử lại với captcha mới khi đọc sai.

Cần: tesseract-ocr, pillow, numpy, pytesseract.
"""

import sys
from collections import Counter

import numpy as np
import pytesseract
from PIL import Image, ImageFilter

WHITELIST = "abcdefghijklmnopqrstuvwxyz0123456789"
CODE_LENGTH = 6

# Mỗi cấu hình một phiếu; lấy kết quả nhiều phiếu nhất.
CONFIGS = [(threshold, kernel, psm) for threshold in (90, 120) for kernel in (3, 5) for psm in (7, 8)]


def prepare(img: Image.Image, threshold: int, kernel: int) -> Image.Image:
    gray = np.asarray(img.convert("L")).astype(int)
    mask = Image.fromarray(np.where(gray < threshold, 0, 255).astype(np.uint8))
    # Đường kẻ mảnh hơn nét chữ: MaxFilter làm nền trắng lấn xoá đường kẻ, MinFilter trả lại độ dày chữ.
    return mask.filter(ImageFilter.MaxFilter(kernel)).filter(ImageFilter.MinFilter(kernel))


def solve(path: str) -> str:
    img = Image.open(path)
    votes = Counter()
    for threshold, kernel, psm in CONFIGS:
        text = pytesseract.image_to_string(
            prepare(img, threshold, kernel),
            config=f"--psm {psm} -c tessedit_char_whitelist={WHITELIST}",
        )
        text = "".join(text.split())
        if len(text) == CODE_LENGTH:
            votes[text] += 1
    return votes.most_common(1)[0][0] if votes else ""


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("Thiếu đường dẫn ảnh.")
    print(solve(sys.argv[1]))
