"""Đọc captcha 4 chữ số của qlcd.pvi.com.vn.

Dùng: python3 solve.py <đường-dẫn-ảnh>
In ra 4 chữ số, hoặc chuỗi rỗng nếu không đọc được.

Cần: tesseract-ocr, pillow, numpy.
"""

import sys
from collections import Counter

import numpy as np
import pytesseract
from PIL import Image

WHITELIST = "0123456789"

# Bốn cấu hình cùng đạt 11/11 trên bộ ảnh ở example/. Chạy cả bốn rồi lấy kết
# quả nhiều phiếu nhất — một cấu hình lệch trên ảnh lạ thì ba cấu hình kia giữ.
CONFIGS = [(60, 2, 8), (60, 2, 13), (60, 5, 8), (60, 5, 13)]


def to_mask(img: Image.Image, threshold: int) -> Image.Image:
    """Chữ và sọc viền đều xanh, nền trắng — hiệu B−R bền hơn ngưỡng xám."""
    a = np.asarray(img.convert("RGB")).astype(int)
    return Image.fromarray(
        np.where(a[:, :, 2] - a[:, :, 0] > threshold, 0, 255).astype(np.uint8), mode="L"
    )


def drop_bars(mask: Image.Image, fill_ratio: float = 0.6) -> Image.Image:
    """Sọc viền phủ gần trọn một chiều, chữ số thì không."""
    a = np.asarray(mask).copy()
    dark = a < 128
    a[:, dark.sum(axis=0) / a.shape[0] > fill_ratio] = 255
    a[dark.sum(axis=1) / a.shape[1] > fill_ratio, :] = 255
    return Image.fromarray(a, mode="L")


def crop_to_content(mask: Image.Image, pad: int = 12) -> Image.Image:
    a = np.asarray(mask)
    rows = np.where((a < 128).any(axis=1))[0]
    cols = np.where((a < 128).any(axis=0))[0]
    if rows.size == 0 or cols.size == 0:
        return mask
    glyphs = mask.crop((cols[0], rows[0], cols[-1] + 1, rows[-1] + 1))
    out = Image.new("L", (glyphs.width + pad * 2, glyphs.height + pad * 2), 255)
    out.paste(glyphs, (pad, pad))
    return out


def prepare(img: Image.Image, threshold: int, factor: int) -> Image.Image:
    mask = crop_to_content(drop_bars(to_mask(img, threshold)))
    big = mask.resize((mask.width * factor, mask.height * factor), Image.LANCZOS)
    # LANCZOS làm mép nhoè thành xám và Tesseract đọc nhầm 8 thành 9.
    return big.point(lambda v: 0 if v < 160 else 255)


def solve(path: str) -> str:
    img = Image.open(path)
    votes = Counter()
    for threshold, factor, psm in CONFIGS:
        text = pytesseract.image_to_string(
            prepare(img, threshold, factor),
            config=f"--psm {psm} -c tessedit_char_whitelist={WHITELIST}",
        ).strip().replace("\n", "")
        if len(text) == 4:
            votes[text] += 1
    return votes.most_common(1)[0][0] if votes else ""


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("Thiếu đường dẫn ảnh.")
    print(solve(sys.argv[1]))
