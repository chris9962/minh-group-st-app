/**
 * Đọc chuỗi trong ảnh QR — chạy Ở TRÌNH DUYỆT.
 *
 * Ngân hàng đưa link mở tài khoản dưới dạng ảnh QR (spec §4.4b). Giải ngay tại
 * máy người dùng thì họ thấy link để đọc lại trước khi dùng, và không cần thêm
 * đường xử lý ảnh ở máy chủ.
 *
 * Hai đường vào: `readQrImage` nhận file người dùng vừa chọn, `readQrImageUrl`
 * nhận ảnh đã lưu trong kho.
 *
 * `zxing-wasm` nạp động — chỉ vài màn có ảnh QR mới cần tới nó. Nạp tĩnh thì đội
 * kinh doanh dùng 4G ngoài trời cũng phải tải theo. Đổi từ `jsqr` 2026-10-07:
 * ảnh chụp cả thẻ CCCD mẫu cũ bằng camera điện thoại, `jsqr` không đọc được QR,
 * `zxing-wasm` đọc được.
 *
 * File wasm nằm ở `public/zxing_reader.wasm`, chép từ
 * `node_modules/zxing-wasm/dist/reader/`. Nâng `zxing-wasm` thì chép lại: file
 * wasm phải cùng phiên bản với phần JS.
 */

/**
 * Cạnh dài tối đa khi vẽ lên canvas để dò. Ảnh 12MP của điện thoại dài khoảng
 * 4000 điểm ảnh; giữ gần nguyên cỡ vì QR trên CCCD mẫu cũ chỉ chiếm khoảng 1/8
 * bề ngang thẻ.
 */
const MAX_EDGE = 4096;

let zxingReady = false;

async function zxingReader() {
  const zxing = await import("zxing-wasm/reader");
  if (!zxingReady) {
    zxing.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? "/zxing_reader.wasm" : prefix + path,
      },
    });
    zxingReady = true;
  }
  return zxing.readBarcodes;
}

export type QrReadResult =
  | { ok: true; text: string }
  | { ok: false; message: string };

/**
 * Vẽ ảnh lên canvas, thu về dưới `MAX_EDGE` nếu lớn hơn. Đi qua canvas chứ không
 * đưa file thẳng cho zxing: trình duyệt giải được HEIC và xoay ảnh theo EXIF,
 * bộ giải ảnh trong zxing thì không.
 */
const drawScaled = (bitmap: ImageBitmap): ImageData | null => {
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
};

async function decodeBlob(blob: Blob): Promise<QrReadResult> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return { ok: false, message: "Không mở được ảnh này. Chọn file JPG hoặc PNG." };
  }

  try {
    const pixels = drawScaled(bitmap);
    if (!pixels) return { ok: false, message: "Trình duyệt không dựng được canvas để đọc ảnh." };

    const readBarcodes = await zxingReader();
    // `tryInvert` mặc định bật: QR in trên nền tối của tờ rơi ngân hàng vẫn đọc được.
    const [found] = await readBarcodes(pixels, { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 1 });
    const text = found?.text.trim();

    if (!text)
      return {
        ok: false,
        message: "Không đọc được mã QR trong ảnh. Chụp lại rõ hơn, hoặc dán link bằng tay.",
      };

    return { ok: true, text };
  } finally {
    // Giải phóng bộ nhớ ảnh ngay, không đợi bộ dọn rác.
    bitmap.close();
  }
}

/** Chuỗi trong QR của một khung điểm ảnh, hoặc `null`. Dùng cho camera quét liên tục. */
export async function readQrPixels(pixels: ImageData): Promise<string | null> {
  const readBarcodes = await zxingReader();
  const [found] = await readBarcodes(pixels, { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 1 });
  return found?.text.trim() || null;
}

export async function readQrImage(file: File): Promise<QrReadResult> {
  return decodeBlob(file);
}

/** Đọc ảnh QR đã lưu. `url` phải cùng nguồn — kho ảnh đi qua `/api/images`. */
export async function readQrImageUrl(url: string): Promise<QrReadResult> {
  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, message: "Không tải được ảnh QR." };
    blob = await res.blob();
  } catch {
    return { ok: false, message: "Không tải được ảnh QR." };
  }
  return decodeBlob(blob);
}

/**
 * Link http(s) đầu tiên trong chuỗi QR, hoặc `''`.
 *
 * QR của mã giới thiệu có ba dạng: link trần, link kèm chữ, và chuỗi EMV của
 * VietQR (không phải link). Chỉ nhận http/https — deep link kiểu `vcb://` mở ra
 * không báo gì khi máy chưa cài app.
 */
export function httpLinkIn(text: string): string {
  const found = text.match(/https?:\/\/[^\s"'<>]+/i);
  // Dấu câu cuối câu dính vào link khi QR chứa cả chữ lẫn link.
  return found ? found[0].replace(/[.,;:)\]]+$/, "") : "";
}
