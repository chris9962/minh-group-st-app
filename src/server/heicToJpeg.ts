import convert from "heic-convert";
import sharp from "sharp";

/**
 * Chuyển ảnh HEIC của iPhone sang JPEG, ngay lúc nhận.
 *
 * Trình duyệt KHÔNG hiển thị được HEIC — Chrome, Firefox và Edge đều không giải
 * mã, chỉ Safari xem được. Ảnh HEIC lên kho là ảnh không ai xem lại được, mà
 * đối soát vẫn duyệt qua vì họ không mở nổi để đối chiếu. Đo 2026-09-05: 37 ảnh
 * trong `bank_account_photos` ở dạng này, gom trong hai ngày 09-04 và 09-05.
 *
 * Hàm nén ở trình duyệt cũng chịu: `createImageBitmap` lẫn thẻ `<img>` đều
 * không đọc HEIC, nên file lên kho nguyên bản trên 1MB.
 *
 * ⚠️ KHÔNG dùng `sharp` để đọc thẳng HEIC. libvips trong image production biên
 * dịch với libheif nhưng chỉ kèm bộ giải mã AV1, không có HEVC — `sharp` treo
 * vô hạn khi đọc, không ném lỗi. `heic-convert` mang bộ giải mã HEVC riêng viết
 * bằng JavaScript nên chạy ở mọi bản dựng; `sharp` chỉ nhận JPEG sau bước đó.
 */

/** Cùng trần với hàm nén ở trình duyệt (`lib/toWebpImage.ts`). */
const MAX_EDGE = 1600;

/**
 * Chuyển HEIC sang JPEG đã thu nhỏ, hoặc `null` nếu không giải mã được.
 *
 * Nơi gọi giữ nguyên file gốc khi nhận `null`: ảnh xem không được vẫn hơn không
 * có ảnh nào.
 *
 * Chi phí đo trên ảnh 3072x4096 nặng 1189KB: 0,8 giây giải mã cộng 0,2 giây thu
 * nhỏ, ra 1200x1600 nặng 169KB. Giải mã chạy đồng bộ và chặn tiến trình Node
 * trong khoảng đó, chấp nhận được vì HEIC chiếm 0,09% số ảnh.
 */
export async function heicToJpeg(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const jpeg = await convert({
      buffer: Buffer.from(bytes),
      format: "JPEG",
      // Cao hơn mức cuối vì đây mới là bản trung gian; `sharp` nén lại ngay sau.
      quality: 0.92,
    });

    const out = await sharp(Buffer.from(jpeg))
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    return new Uint8Array(out);
  } catch (e) {
    console.error("[storage] không chuyển được ảnh HEIC sang JPEG:", e);
    return null;
  }
}
