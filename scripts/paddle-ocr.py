"""Đọc ảnh ngân hàng bằng PaddleOCR tại máy worker; stdin/stdout là JSON.

Chỉ gọi khi Tesseract không đọc đủ. Không ghi ảnh ra đĩa, không gửi ảnh ra mạng.
Model Paddle đã cài và cache sẵn trước khi bật fallback.
"""

import base64
import json
import sys

import cv2
import numpy as np
from paddleocr import PaddleOCR


def main() -> None:
    encoded = json.load(sys.stdin)
    if not isinstance(encoded, list) or not 1 <= len(encoded) <= 8:
        raise ValueError("Số ảnh PaddleOCR phải từ 1 đến 8")

    ocr = PaddleOCR(
        lang="vi",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    texts = []
    for item in encoded:
        image = cv2.imdecode(np.frombuffer(base64.b64decode(item), dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Ảnh đưa vào PaddleOCR không đọc được")
        result = next(iter(ocr.predict(image)))
        texts.append(result.json["res"]["rec_texts"])
    print("MGST_PADDLE_JSON:" + json.dumps(texts, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
