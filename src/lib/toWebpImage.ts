/**
 * Thu nhỏ và nén ảnh NGAY TẠI TRÌNH DUYỆT, trước khi tải lên (spec §U7).
 *
 * Ảnh chụp bằng điện thoại ra 5712x4284, mỗi tấm 2–8MB. Mỗi tài khoản ngân hàng
 * cần 3 ảnh chứng minh, cộng ảnh giao dịch và ảnh chứng nhận bảo hiểm. Nén ở
 * trình duyệt giảm cả dung lượng kho LẪN thời gian tải lên — đội kinh doanh
 * dùng 4G ngoài trời, còn máy chủ thì chỉ giảm được vế thứ nhất.
 *
 * Không thêm thư viện nào: `canvas.toBlob` là API sẵn có.
 *
 * ⚠️ Đây KHÔNG phải chốt kiểm bảo mật. Máy chủ vẫn đọc chữ ký đầu file và vẫn
 * chặn theo dung lượng — trình duyệt nén rồi không có nghĩa là tin được thứ
 * gửi lên.
 */

/** Cạnh dài tối đa sau khi thu. Ảnh chứng minh chỉ cần đọc được chữ trên màn hình. */
const MAX_EDGE = 1600;

/**
 * Trần dung lượng mỗi ảnh sau khi nén.
 *
 * Đo 2026-09-05 trên 20 ảnh nặng nhất trong kho: thu về 1600 rồi nén tới mức
 * này cho trung bình 266KB, từ 8.625KB. Mọi ảnh đều đạt ngay ở 1600 điểm ảnh,
 * chỉ cần hạ chất lượng xuống khoảng 75–85.
 */
const MAX_BYTES = 300 * 1024;

/**
 * Bậc chất lượng thử lần lượt, cao xuống thấp.
 *
 * Dừng ở bậc ĐẦU TIÊN đạt trần: ảnh giấy tờ nền phẳng đạt ngay ở 95, ảnh chụp
 * ngoài trời nhiều chi tiết phải xuống 75. Đặt một mức cố định cho cả hai thì
 * hoặc ảnh này quá nặng, hoặc ảnh kia mất chữ.
 */
const QUALITY_STEPS = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7];

/**
 * Cạnh dài thử lần lượt khi hạ hết chất lượng vẫn chưa đạt trần.
 *
 * Hạ chất lượng TRƯỚC, hạ kích thước SAU: chữ trên CCCD sống nhờ số điểm ảnh,
 * còn nhiễu nén thì mắt bỏ qua được. 20 ảnh mẫu không ảnh nào phải xuống dưới
 * 1600, hai mức sau là đường lùi cho ảnh đặc biệt nhiều chi tiết.
 */
const EDGE_STEPS = [MAX_EDGE, 1400, 1200];

const renameTo = (name: string, ext: string) => `${name.replace(/\.[^.]+$/, "")}.${ext}`;

/** Ảnh đã giải mã, chung cho cả hai đường đọc ở `docAnh`. */
type Source = { image: CanvasImageSource; width: number; height: number; release: () => void };

function drawScaled(source: Source, edge: number): HTMLCanvasElement | null {
  const scale = Math.min(1, edge / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source.image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * ĐÚNG MỘT đường đọc: `createImageBitmap`. Không đọc được thì trả `null` và ảnh
 * lên kho nguyên gốc — `server/toWebpOnServer.ts` ép nó về WebP trong trần.
 *
 * ❌ ĐỪNG thêm lại đường dự phòng bằng thẻ `<img>`. Bản 2026-09-05 làm vậy để
 * cứu ảnh JPEG thiếu byte cuối, và nó ghi ẢNH TRỐNG lên kho: `img.onload` chỉ
 * báo dữ liệu đã tải và kích thước đã đọc được, KHÔNG báo trình duyệt đã giải
 * mã xong. `drawImage` gọi ngay sau đó vẽ ra canvas rỗng. Chromium máy tính giải
 * mã kịp nên không thấy gì; điện thoại của đội kinh doanh thì không, và một tài
 * khoản TPB nhận 4 ảnh 722x1600 nặng 3KB với mọi kênh màu bằng 0.
 *
 * Máy chủ nay đọc được đúng loại ảnh đó — `sharp` mở với `failOn: "none"` nên
 * ảnh cắt cụt vẫn dựng được phần đã có. Ảnh hiếm này tải lên nặng hơn một lần,
 * đổi lại không còn đường nào sinh ra ảnh trống.
 */
async function docAnh(file: File): Promise<Source | null> {
  try {
    // `from-image`: ảnh chụp dọc bằng điện thoại mang hướng trong EXIF. Bỏ qua
    // nó là ảnh lưu lên nằm ngang.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    return null;
  }
}

const toBlob = (canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, mime, quality));

/**
 * Định dạng trình duyệt này xuất được, thử một lần rồi nhớ.
 *
 * Theo chuẩn HTML, `toBlob` với định dạng không hỗ trợ thì LẶNG LẼ xuất PNG chứ
 * không báo lỗi. Nên phải đọc `blob.type` để biết nó có làm đúng yêu cầu không.
 *
 * WebP nhỏ hơn JPEG khoảng 20% ở cùng chất lượng, nhưng Safari cũ và một số
 * WebView trong ứng dụng không xuất được. Bản trước gặp ca đó thì trả về FILE
 * GỐC, mất luôn cả phần thu nhỏ — 71% ảnh trong kho vì thế vẫn 5712x4284, đo
 * 2026-09-05.
 */
let webpSupport: boolean | null = null;

async function canWriteWebp(canvas: HTMLCanvasElement): Promise<boolean> {
  if (webpSupport !== null) return webpSupport;
  const blob = await toBlob(canvas, "image/webp", 0.9);
  webpSupport = blob?.type === "image/webp";
  return webpSupport;
}

/** Bậc đầu tiên lọt trần, hoặc bậc thấp nhất khi không bậc nào lọt. */
async function nenDenNguong(
  source: Source,
  mime: string,
): Promise<{ blob: Blob; ext: string } | null> {
  const ext = mime === "image/webp" ? "webp" : "jpg";
  let cuoiCung: Blob | null = null;

  for (const edge of EDGE_STEPS) {
    const canvas = drawScaled(source, edge);
    if (!canvas) return null;

    for (const quality of QUALITY_STEPS) {
      const blob = await toBlob(canvas, mime, quality);
      if (!blob || blob.type !== mime) return null;
      cuoiCung = blob;
      if (blob.size <= MAX_BYTES) return { blob, ext };
    }
  }

  // Hết bậc mà vẫn quá trần: lấy bản nhỏ nhất đã dựng được. Ảnh 400KB vẫn tốt
  // hơn nhiều so với bản gốc 8MB.
  return cuoiCung ? { blob: cuoiCung, ext } : null;
}

/**
 * Trả ảnh đã thu nhỏ và nén, hoặc chính file gốc khi trình duyệt không xử lý được.
 *
 * Thứ tự: thử WebP trước vì nó nhỏ hơn JPEG khoảng 20% ở cùng chất lượng.
 * Trình duyệt không xuất được WebP thì chuyển sang JPEG — vẫn thu nhỏ, vẫn nén.
 *
 * ⚠️ Ảnh PNG đi ra JPEG, không giữ đuôi gốc. PNG không có tham số chất lượng
 * nên không nén tới trần dung lượng được: ảnh chụp màn hình 1179x2556 để dạng
 * PNG là 8.704KB, qua JPEG còn 228KB. Ảnh chứng minh không cần nền trong suốt.
 *
 * Hai đường trả về file gốc, đều là đường đi tiếp chứ không phải lỗi. Máy chủ
 * nhận nguyên bản rồi ép về WebP trong trần, nên không đường nào để ảnh quá cỡ
 * nằm lại trong kho:
 *
 * 1. `createImageBitmap` không giải được ảnh — HEIC ở mọi trình duyệt ngoài
 *    Safari, và ảnh JPEG thiếu byte cuối.
 * 2. Bản nén không nhỏ hơn bản gốc. Ảnh vốn đã nhỏ và nén kỹ thì nén lần nữa
 *    chỉ tốn thêm dung lượng.
 */
export async function toWebpImage(file: File): Promise<File> {
  const source = await docAnh(file);
  if (!source) return file;

  try {
    const thu = drawScaled(source, MAX_EDGE);
    if (!thu) return file;

    const mime = (await canWriteWebp(thu)) ? "image/webp" : "image/jpeg";
    const ket = await nenDenNguong(source, mime);
    if (!ket || ket.blob.size >= file.size) return file;

    return new File([ket.blob], renameTo(file.name, ket.ext), { type: mime });
  } finally {
    source.release();
  }
}
