/**
 * Chuyển ảnh sang WebP NGAY TẠI TRÌNH DUYỆT, trước khi tải lên (spec §U7).
 *
 * Ảnh chụp bằng điện thoại ra 2–4MB mỗi tấm. Mỗi tài khoản ngân hàng cần 3 ảnh
 * chứng minh, cộng ảnh giao dịch và ảnh chứng nhận bảo hiểm. Chuyển ở trình
 * duyệt giảm cả dung lượng kho LẪN thời gian tải lên — đội kinh doanh dùng 4G
 * ngoài trời, còn máy chủ thì chỉ giảm được vế thứ nhất.
 *
 * Không thêm thư viện nào: `canvas.toBlob` là API sẵn có.
 *
 * ⚠️ Đây KHÔNG phải chốt kiểm bảo mật. Máy chủ vẫn đọc chữ ký đầu file và vẫn
 * chặn theo dung lượng — trình duyệt chuyển rồi không có nghĩa là tin được thứ
 * gửi lên.
 */

/** Cạnh dài tối đa sau khi thu. Ảnh chứng minh chỉ cần đọc được chữ trên màn hình. */
const MAX_EDGE = 1600;

/** Chất lượng WebP. 0,8 là mức giữ chữ số sắc nét mà dung lượng còn khoảng 1/5. */
const QUALITY = 0.8;

const webpName = (name: string) => `${name.replace(/\.[^.]+$/, "")}.webp`;

function drawScaled(bitmap: ImageBitmap): HTMLCanvasElement | null {
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, "image/webp", QUALITY));

/**
 * Trả ảnh WebP đã thu nhỏ, hoặc chính file gốc khi không chuyển được.
 *
 * Ba đường trả gốc, đều là đường đi tiếp chứ không phải lỗi:
 *
 * 1. Trình duyệt không giải được ảnh — HEIC trên Chrome máy tính. Máy chủ nhận
 *    nguyên bản như trước đây.
 * 2. `toBlob` trả về thứ không phải WebP. Theo chuẩn HTML, trình duyệt không hỗ
 *    trợ định dạng yêu cầu thì lặng lẽ xuất PNG — mà PNG của một tấm ảnh chụp
 *    còn nặng hơn bản gốc.
 * 3. Bản chuyển không nhỏ hơn bản gốc. Ảnh nhỏ, đã nén kỹ, hoặc đã là WebP thì
 *    chuyển lần nữa chỉ tốn thêm dung lượng.
 */
export async function toWebpImage(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    // `from-image`: ảnh chụp dọc bằng điện thoại mang hướng trong EXIF. Bỏ qua
    // nó là ảnh lưu lên nằm ngang.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  try {
    const canvas = drawScaled(bitmap);
    if (!canvas) return file;

    const blob = await toBlob(canvas);
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;

    return new File([blob], webpName(file.name), { type: "image/webp" });
  } finally {
    bitmap.close();
  }
}
