import convert from "heic-convert";
import sharp from "sharp";

/**
 * Ép mọi ảnh về WebP trong trần kích thước và dung lượng, ngay lúc nhận.
 *
 * Đây là chốt CUỐI. `lib/toWebpImage.ts` đã thu nhỏ và nén ở trình duyệt trước
 * khi gửi, nhưng nó phụ thuộc thứ trình duyệt làm được: Safari cũ và vài WebView
 * trong ứng dụng không xuất nổi WebP, còn HEIC thì không đọc nổi. Ảnh nào trình
 * duyệt bỏ qua thì máy chủ làm nốt, nên kho chỉ còn một định dạng và không ảnh
 * nào vượt trần (chốt 2026-09-05).
 *
 * Ảnh đã là WebP và đã trong trần thì giữ nguyên — nén lại lần nữa chỉ mất thêm
 * chất lượng mà giảm không đáng bao nhiêu.
 */

/** Cạnh dài tối đa. Ảnh chứng minh chỉ cần đọc được chữ trên màn hình. */
const MAX_EDGE = 1600;

/** Trần dung lượng mỗi ảnh, cùng mức với hàm nén ở trình duyệt. */
const MAX_BYTES = 300 * 1024;

/**
 * Bậc chất lượng thử lần lượt, cao xuống thấp. Dừng ở bậc ĐẦU TIÊN lọt trần.
 *
 * Đo 2026-09-05 trên ảnh 1200x1600 đã qua trình duyệt: q85 cho 91KB, q80 cho
 * 72KB. Ảnh giấy tờ nền phẳng đạt ngay ở 85; ảnh chụp ngoài trời nhiều chi tiết
 * mới phải xuống thấp hơn.
 */
const QUALITY_STEPS = [85, 80, 75, 70];

/**
 * Ảnh đã trong trần và đã là WebP thì trả `null` — nơi gọi giữ nguyên file gốc.
 *
 * Cũng trả `null` khi không giải mã được. Ảnh xem không được vẫn hơn không có
 * ảnh nào.
 *
 * ⚠️ KHÔNG dùng `sharp` để đọc thẳng HEIC. libvips trong image production biên
 * dịch với libheif nhưng chỉ kèm bộ giải mã AV1, không có HEVC — `sharp` treo vô
 * hạn khi đọc, không ném lỗi. `heic-convert` mang bộ giải mã HEVC viết bằng
 * JavaScript nên chạy ở mọi bản dựng; `sharp` chỉ nhận JPEG sau bước đó.
 */
export async function toWebpOnServer(bytes: Uint8Array, ext: string): Promise<Uint8Array | null> {
  try {
    const src =
      ext === "heic"
        ? Buffer.from(await convert({ buffer: Buffer.from(bytes), format: "JPEG", quality: 0.92 }))
        : Buffer.from(bytes);

    // `failOn: "none"`: ảnh JPEG thiếu vài byte cuối vẫn dựng được phần đã có.
    // Mặc định của sharp là ném `premature end of JPEG image` và mất cả tấm ảnh
    // — đo 2026-09-05, bốn ảnh chụp màn hình của một tài khoản MSBb rơi vào ca đó.
    const meta = await sharp(src, { failOn: "none" }).metadata();
    const canhDai = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (ext === "webp" && canhDai <= MAX_EDGE && bytes.length <= MAX_BYTES) return null;

    let cuoiCung: Buffer | null = null;
    for (const quality of QUALITY_STEPS) {
      const out = await sharp(src, { failOn: "none" })
        .rotate()
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      cuoiCung = out;
      if (out.length <= MAX_BYTES) break;
    }

    return cuoiCung ? new Uint8Array(cuoiCung) : null;
  } catch (e) {
    console.error("[storage] không ép được ảnh về WebP:", e);
    return null;
  }
}
