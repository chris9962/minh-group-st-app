"""
Tiến trình đọc chữ trên ảnh, chạy lâu dài, nói chuyện bằng JSON mỗi dòng.

`src/server/ocr/reader.ts` mở tiến trình này một lần rồi giữ suốt: nạp model
mất khoảng 4 giây, gọi lại mỗi ảnh thì mỗi ảnh tốn thêm chừng đó.

    stdin   {"path": "/tmp/anh.png", "model": "seq2seq"}     `model` thiếu = "transformer"
    stdout  {"lines": ["Mở Tài Khoản Thành Công!", "1000 5616 831", ...], "ms": 2300}
            {"error": "..."}
    dòng đầu khi sẵn sàng: {"ready": true}

PaddleOCR chỉ DÒ VÙNG chữ (model `PP-OCRv5_mobile_det`), VietOCR đọc từng vùng
(`vgg_transformer`). Chốt 2026-09-19 sau khi so với Tesseract: một lượt, không
tiền xử lý, đọc đủ bốn giá trị ở các ca Tesseract 36 cấu hình không đọc được.

MSBb đọc bằng `vgg_seq2seq` (chốt 2026-09-25), xem `ocrModelOf` ở
`src/server/ocr/facts.ts`. Model này chỉ nạp ở lượt đầu có yêu cầu nó.

Mọi log của thư viện đi ra stderr; stdout chỉ có JSON.

Biến môi trường:
    OCR_DET_MODEL          tên model dò vùng, mặc định PP-OCRv5_mobile_det
    OCR_CONFIG             đường dẫn YAML cấu hình `vgg_transformer` lưu sẵn; thiếu thì tải từ vocr.vn
    OCR_WEIGHTS            đường dẫn `vgg_transformer.pth` tải sẵn; thiếu thì tải về
    OCR_SEQ2SEQ_CONFIG     như OCR_CONFIG, cho `vgg_seq2seq`
    OCR_SEQ2SEQ_WEIGHTS    như OCR_WEIGHTS, cho `vgg_seq2seq`
    OCR_THREADS            số luồng torch và paddle, mặc định 2

Tải sẵn model lúc dựng image:  python scripts/ocr-server.py --tai-model /app/.models
"""
import json
import os
import re
import sys
import time
import unicodedata

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

# Khoá trong yêu cầu → (tên model VietOCR, biến YAML, biến trọng số, lề cắt vùng px).
# `vgg_seq2seq` cắt sát 0 px: trên 32 ô mã giới thiệu MSBb đọc đúng 25, lề 4 px chỉ 22.
REC_MODELS = {
    "transformer": ("vgg_transformer", "OCR_CONFIG", "OCR_WEIGHTS", 4),
    "seq2seq": ("vgg_seq2seq", "OCR_SEQ2SEQ_CONFIG", "OCR_SEQ2SEQ_WEIGHTS", 0),
}


DET_MODEL = os.environ.get("OCR_DET_MODEL", "PP-OCRv5_mobile_det")


def load_det():
    # `enable_mkldnn=False`: paddlepaddle 3.3.1 trên x86 lỗi
    # "ConvertPirAttribute2RuntimeAttribute not support" ở tầng oneDNN khi dò vùng
    # (thử trong image linux/amd64 2026-09-19). Dò vùng chỉ 0,4 s, tắt không đáng kể.
    return TextDetection(model_name=DET_MODEL, device="cpu", cpu_threads=THREADS, enable_mkldnn=False)


def load_rec(key):
    name, config_env, weights_env, pad = REC_MODELS[key]
    # `load_config_from_name` tải YAML từ vocr.vn MỖI lần gọi; trong Docker dùng bản
    # đã lưu lúc build để container chạy không cần mạng.
    config = os.environ.get(config_env)
    cfg = Cfg.load_config_from_file(config) if config else Cfg.load_config_from_name(name)
    # Trọng số CNN đã nằm trong checkpoint; `pretrained` chỉ kéo thêm 548 MB vgg19_bn lúc chạy.
    cfg["cnn"]["pretrained"] = False
    cfg["predictor"]["beamsearch"] = False
    cfg["device"] = "cpu"
    weights = os.environ.get(weights_env)
    if weights:
        cfg["weights"] = weights
    return Predictor(cfg), pad


def crop(img, poly, pad):
    xs = [int(p[0]) for p in poly]
    ys = [int(p[1]) for p in poly]
    x0, x1 = max(min(xs) - pad, 0), min(max(xs) + pad, img.shape[1])
    y0, y1 = max(min(ys) - pad, 0), min(max(ys) + pad, img.shape[0])
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    return Image.fromarray(cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2RGB))


def read(det, rec, path):
    img = cv2.imread(path)
    if img is None:
        raise ValueError(f"Không mở được ảnh {path}")
    h, w = img.shape[:2]
    if w <= h:
        return read_portrait(det, rec, img)
    # Ảnh ngang là điện thoại nằm nghiêng hay lộn ngược trong ảnh chụp; app chỉ
    # có bố cục dọc. Bộ phân loại hướng của Paddle đoán sai 1/2 ảnh thử
    # (2026-09-19), nên đọc cả bốn hướng và giữ hướng nhiều từ có nghĩa nhất,
    # hoà thì nhiều chữ nhất. Chỉ tốn thêm ở ảnh ngang.
    best = []
    for rot in (None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE, cv2.ROTATE_180):
        lines = read_upright(det, rec, img if rot is None else cv2.rotate(img, rot))
        if (vocab_hits(lines), word_letters(lines)) > (vocab_hits(best), word_letters(best)):
            best = lines
    return best


WORD = re.compile(r"[A-Za-zÀ-ỹ]{3,}")


def word_letters(lines):
    return sum(len(m) for line in lines for m in WORD.findall(line))


# Từ hay gặp trên màn app ngân hàng, không dấu. Ảnh chụp điện thoại khách bị
# lộn ngược 180° vẫn ra "từ" (`uop eoy ugoi`), nên `word_letters` không phân
# biệt được; đếm từ có nghĩa thì phân biệt được.
VOCAB = frozenset(
    "tai khoan thanh cong chuyen tien giao dich ngan hang noi dung thoi gian so ten khach dang ky "
    "ma phi ngay nguoi nhan hinh thuc chi tiet thong tin mo nhap mat khau lich su tong du bien dong "
    "truy van hoan tat xac chu gioi thieu tinh pho nhanh tra soat chia se luu mau xong hom nay "
    "trang thai luong cua ban den tu don vi loai hop dong dieu kien".split()
)


def strip_accents(text):
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn").replace("đ", "d").replace("Đ", "D")


def vocab_hits(lines):
    return sum(1 for line in lines for w in re.findall(r"[A-Za-zÀ-ỹ]+", line) if strip_accents(w).lower() in VOCAB)


def read_portrait(det, rec, img):
    """Ảnh dọc đọc một lượt; đọc ra gần như không có từ nào có nghĩa thì thử
    lộn 180° (ảnh chụp lại điện thoại khách cầm ngược, 5/85 bộ VPBank đo
    2026-09-22) và giữ lượt nhiều từ có nghĩa hơn."""
    lines = read_upright(det, rec, img)
    if vocab_hits(lines) >= 3:
        return lines
    flipped = read_upright(det, rec, cv2.rotate(img, cv2.ROTATE_180))
    return flipped if vocab_hits(flipped) > vocab_hits(lines) else lines


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
    predictor, pad = rec
    crops = [crop(img, b[3], pad) for b in boxes]
    crops = [c for c in crops if c is not None]
    if not crops:
        return []
    return [t.strip() for t in predictor.predict_batch(crops) if t and t.strip()]


def fetch_models(target):
    """Tải model dò vùng, YAML và trọng số VietOCR vào `target`, chạy một lần lúc build."""
    os.makedirs(target, exist_ok=True)
    TextDetection(model_name=DET_MODEL, device="cpu", enable_mkldnn=False)
    from vietocr.tool.utils import download_weights

    for name, _, _, _ in REC_MODELS.values():
        cfg = Cfg.load_config_from_name(name)
        cfg["cnn"]["pretrained"] = False
        cfg["device"] = "cpu"
        cfg.save(os.path.join(target, f"{name}.yml"))
        path = download_weights(cfg["weights"])
        os.replace(path, os.path.join(target, f"{name}.pth"))
    print("đã tải model vào", target, file=sys.stderr)


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--tai-model":
        fetch_models(sys.argv[2])
        return
    det = load_det()
    recs = {"transformer": load_rec("transformer")}
    OUT.write(json.dumps({"ready": True}) + "\n")
    OUT.flush()
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        t = time.time()
        try:
            req = json.loads(raw)
            key = req.get("model") or "transformer"
            if key not in recs:
                recs[key] = load_rec(key)
            lines = read(det, recs[key], req["path"])
            reply = {"lines": lines, "ms": int((time.time() - t) * 1000)}
        except Exception as e:  # noqa: BLE001
            reply = {"error": f"{type(e).__name__}: {e}"}
        OUT.write(json.dumps(reply, ensure_ascii=False) + "\n")
        OUT.flush()


if __name__ == "__main__":
    main()
