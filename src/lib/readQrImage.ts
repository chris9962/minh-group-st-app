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
 * `jsqr` nạp động — chỉ vài màn có ảnh QR mới cần tới nó. Nạp tĩnh thì đội kinh
 * doanh dùng 4G ngoài trời cũng phải tải theo.
 */

/** Cạnh dài tối đa khi vẽ lên canvas để dò. */
const MAX_EDGE = 1600;

export type QrReadResult =
  | { ok: true; text: string }
  | { ok: false; message: string };

/**
 * Thu ảnh về dưới `MAX_EDGE` trước khi dò.
 *
 * Ảnh chụp bằng điện thoại 12MP ra khoảng 4000×3000 — `jsqr` quét từng điểm ảnh
 * nên nó mất vài giây và làm treo luồng giao diện. Thu nhỏ không làm mất mã: QR
 * chỉ cần vài điểm ảnh cho mỗi ô vuông.
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

    const { default: jsQR } = await import("jsqr");
    /**
     * `attemptBoth` cho `jsqr` thử cả ảnh gốc lẫn ảnh đảo màu. QR in trên nền
     * tối — tờ rơi của ngân hàng hay dùng — không đọc được nếu chỉ thử một chiều.
     */
    const found = jsQR(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: "attemptBoth",
    });

    if (!found?.data.trim())
      return {
        ok: false,
        message: "Không đọc được mã QR trong ảnh. Chụp lại rõ hơn, hoặc dán link bằng tay.",
      };

    return { ok: true, text: found.data.trim() };
  } finally {
    // Giải phóng bộ nhớ ảnh ngay, không đợi bộ dọn rác.
    bitmap.close();
  }
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
