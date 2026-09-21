"""
Tiến trình đọc chữ trên ảnh, chạy lâu dài, nói chuyện bằng JSON mỗi dòng.

`src/server/ocr/reader.ts` mở tiến trình này một lần rồi giữ suốt: nạp model
mất khoảng 4 giây, gọi lại mỗi ảnh thì mỗi ảnh tốn thêm chừng đó.

    stdin   {"path": "/tmp/anh.png"}
    stdout  {"lines": ["Mở Tài Khoản Thành Công!", "1000 5616 831", ...], "ms": 2300}
            {"error": "..."}
    dòng đầu khi sẵn sàng: {"ready": true}

PaddleOCR chỉ DÒ VÙNG chữ (model `PP-OCRv5_mobile_det`), VietOCR đọc từng vùng
(`vgg_transformer`). Chốt 2026-09-19 sau khi so với Tesseract: một lượt, không
tiền xử lý, đọc đủ bốn giá trị ở các ca Tesseract 36 cấu hình không đọc được.

Mọi log của thư viện đi ra stderr; stdout chỉ có JSON.

Biến môi trường:
    OCR_DET_MODEL   tên model dò vùng, mặc định PP-OCRv5_mobile_det
    OCR_CONFIG      đường dẫn YAML cấu hình VietOCR lưu sẵn; thiếu thì tải từ vocr.vn
    OCR_WEIGHTS     đường dẫn `vgg_transformer.pth` tải sẵn; thiếu thì tải về
    OCR_THREADS     số luồng torch và paddle, mặc định 2

Tải sẵn model lúc dựng image:  python scripts/ocr-server.py --tai-model /app/.models
"""
import json
import os
import re
import sys
import time

# Thư viện in tiến trình tải model ra stdout; dồn hết sang stderr để stdout sạch.
OUT = sys.stdout
sys.stdout = sys.stderr

import cv2  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402

# vietocr 0.3.12 còn gọi Image.ANTIALIAS, Pillow >= 10 đã bỏ tên này.
if not hasattr(Image, "ANTIALIAS"):
    Image.ANTIALIAS = Image.LANCZOS

THREADS = int(os.environ.get("OCR_THREADS", "2"))
torch.set_num_threads(THREADS)

from paddleocr import TextDetection  # noqa: E402
from vietocr.tool.config import Cfg  # noqa: E402
from vietocr.tool.predictor import Predictor  # noqa: E402

PAD = 4


DET_MODEL = os.environ.get("OCR_DET_MODEL", "PP-OCRv5_mobile_det")


def load():
    # `enable_mkldnn=False`: paddlepaddle 3.3.1 trên x86 lỗi
    # "ConvertPirAttribute2RuntimeAttribute not support" ở tầng oneDNN khi dò vùng
    # (thử trong image linux/amd64 2026-09-19). Dò vùng chỉ 0,4 s, tắt không đáng kể.
    det = TextDetection(model_name=DET_MODEL, device="cpu", cpu_threads=THREADS, enable_mkldnn=False)
    # `load_config_from_name` tải YAML từ vocr.vn MỖI lần gọi; trong Docker dùng bản
    # đã lưu lúc build để container chạy không cần mạng.
    config = os.environ.get("OCR_CONFIG")
    cfg = Cfg.load_config_from_file(config) if config else Cfg.load_config_from_name("vgg_transformer")
    # Trọng số CNN đã nằm trong checkpoint; `pretrained` chỉ kéo thêm 548 MB vgg19_bn lúc chạy.
    cfg["cnn"]["pretrained"] = False
    cfg["predictor"]["beamsearch"] = False
    cfg["device"] = "cpu"
    weights = os.environ.get("OCR_WEIGHTS")
    if weights:
        cfg["weights"] = weights
    rec = Predictor(cfg)
    return det, rec


def crop(img, poly):
    xs = [int(p[0]) for p in poly]
    ys = [int(p[1]) for p in poly]
    x0, x1 = max(min(xs) - PAD, 0), min(max(xs) + PAD, img.shape[1])
    y0, y1 = max(min(ys) - PAD, 0), min(max(ys) + PAD, img.shape[0])
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    return Image.fromarray(cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2RGB))


def read(det, rec, path):
    img = cv2.imread(path)
    if img is None:
        raise ValueError(f"Không mở được ảnh {path}")
    h, w = img.shape[:2]
    if w <= h:
        return read_upright(det, rec, img)
    # Ảnh ngang là điện thoại nằm nghiêng trong ảnh chụp; app chỉ có bố cục dọc.
    # Bộ phân loại hướng của Paddle đoán sai 1/2 ảnh thử (2026-09-19), nên đọc cả
    # ba hướng và giữ hướng ra nhiều từ nhất. Chỉ tốn thêm ở ảnh ngang.
    best = []
    for rot in (None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE):
        lines = read_upright(det, rec, img if rot is None else cv2.rotate(img, rot))
        if word_letters(lines) > word_letters(best):
            best = lines
    return best


WORD = re.compile(r"[A-Za-zÀ-ỹ]{3,}")


def word_letters(lines):
    return sum(len(m) for line in lines for m in WORD.findall(line))


def read_upright(det, rec, img):
    polys = []
    for res in det.predict(img):
        polys.extend(res["dt_polys"])
    # Thứ tự đọc: trên xuống, trái sang. Cùng hàng khi tâm lệch dưới nửa chiều cao vùng.
    boxes = []
    for poly in polys:
        ys = [p[1] for p in poly]
        xs = [p[0] for p in poly]
        boxes.append((min(ys), max(ys), min(xs), poly))
    boxes.sort(key=lambda b: (b[0], b[2]))
    crops = [crop(img, b[3]) for b in boxes]
    crops = [c for c in crops if c is not None]
    if not crops:
        return []
    return [t.strip() for t in rec.predict_batch(crops) if t and t.strip()]


def fetch_models(target):
    """Tải model dò vùng, YAML và trọng số VietOCR vào `target`, chạy một lần lúc build."""
    os.makedirs(target, exist_ok=True)
    TextDetection(model_name=DET_MODEL, device="cpu", enable_mkldnn=False)
    cfg = Cfg.load_config_from_name("vgg_transformer")
    cfg["cnn"]["pretrained"] = False
    cfg["device"] = "cpu"
    cfg.save(os.path.join(target, "vgg_transformer.yml"))
    from vietocr.tool.utils import download_weights

    path = download_weights(cfg["weights"])
    os.replace(path, os.path.join(target, "vgg_transformer.pth"))
    print("đã tải model vào", target, file=sys.stderr)


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--tai-model":
        fetch_models(sys.argv[2])
        return
    det, rec = load()
    OUT.write(json.dumps({"ready": True}) + "\n")
    OUT.flush()
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        t = time.time()
        try:
            req = json.loads(raw)
            lines = read(det, rec, req["path"])
            reply = {"lines": lines, "ms": int((time.time() - t) * 1000)}
        except Exception as e:  # noqa: BLE001
            reply = {"error": f"{type(e).__name__}: {e}"}
        OUT.write(json.dumps(reply, ensure_ascii=False) + "\n")
        OUT.flush()


if __name__ == "__main__":
    main()
