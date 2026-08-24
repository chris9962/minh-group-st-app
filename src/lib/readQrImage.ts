/**
 * Đọc chuỗi trong ảnh QR — chạy Ở TRÌNH DUYỆT.
 *
 * Ngân hàng đưa link mở tài khoản dưới dạng ảnh QR (spec §4.4b). Giải ngay tại
 * máy người dùng thì họ thấy link trong ô để đọc lại trước khi lưu, và ô đó vẫn
 * sửa được khi ảnh mờ không ra kết quả.
 *
 * Việc LƯU ảnh là đường riêng (`uploadImage`), chạy lúc bấm Lưu. Hàm này chỉ
 * đọc, không đụng tới kho ảnh.
 *
 * `jsqr` nạp động — nó chỉ cần cho một hộp thoại ở màn P-61, mà người mở màn đó
 * là Kinh doanh tổng hợp ngồi máy tính. Nạp tĩnh thì đội kinh doanh dùng 4G
 * ngoài trời cũng phải tải theo.
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

export async function readQrImage(file: File): Promise<QrReadResult> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
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
