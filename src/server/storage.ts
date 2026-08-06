import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Kho lưu trữ ảnh — hai ngả sau CÙNG một cửa.
 *
 * Nơi gọi chỉ thấy `putImage(...)` và một URL trả về; nó không biết đằng sau là
 * S3 hay đĩa cứng. Đổi nhà cung cấp về sau là sửa đúng file này.
 *
 *   Có đủ biến môi trường AWS  →  đẩy lên S3
 *   Chưa có                    →  ghi vào `public/uploads/` và trả URL nội bộ
 *
 * Ngả thứ hai là BẢN TẠM để làm việc khi chưa có tài khoản AWS. Điền đủ bốn
 * biến vào `.env.local` là tự động chuyển sang S3, không phải sửa dòng code nào.
 *
 * ⚠️ Ba giới hạn của bản tạm, phải biết trước khi mang lên máy chủ thật:
 *
 * 1. Ảnh nằm trên ĐĨA CỦA MÁY CHỦ ỨNG DỤNG. Deploy dạng container hay nhiều
 *    máy chạy song song là ảnh mất hoặc máy này không thấy ảnh máy kia.
 * 2. Ảnh thay ra KHÔNG bị xoá khỏi đĩa. Bản ghi chỉ trỏ sang URL mới; file cũ
 *    nằm lại. S3 cũng vậy — dọn rác là việc riêng, chưa làm ở cả hai ngả.
 * 3. `public/` ai cũng đọc được nếu ĐOÁN ĐÚNG đường dẫn. Tên file là uuid nên
 *    không đoán được, nhưng đó là "khó đoán", không phải "có kiểm quyền".
 */

type StorageConfig = {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Tên miền đọc ảnh (CloudFront…). Trống thì dùng URL S3 mặc định. */
  publicBaseUrl: string;
};

/**
 * Đọc cấu hình mỗi lần gọi, KHÔNG cache ở tầng module.
 *
 * Cache thì lần khởi động đầu tiên thiếu biến sẽ khoá cứng trạng thái "chưa cấu
 * hình" cho tới khi khởi động lại tiến trình — thêm biến vào `.env.local` xong
 * vẫn ghi vào đĩa mà không hiểu vì sao.
 */
function readConfig(): StorageConfig | null {
  const region = process.env.AWS_REGION ?? "";
  const bucket = process.env.AWS_S3_BUCKET ?? "";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "";
  if (!region || !bucket || !accessKeyId || !secretAccessKey) return null;

  return {
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: (process.env.AWS_S3_PUBLIC_URL ?? "").replace(/\/+$/, ""),
  };
}

/** Thư mục ảnh của bản tạm. Nằm trong `public/` nên Next phục vụ thẳng ra web. */
const LOCAL_DIR = "uploads";

export const storageBackend = (): "s3" | "local" => (readConfig() ? "s3" : "local");

/**
 * URL này có phải do CHÍNH kho của mình phát ra không.
 *
 * ⚠️ Chốt chặn XSS LƯU TRỮ, không phải kiểm tra cho gọn.
 *
 * Endpoint ghi ảnh nhận một mảng URL. Không ràng buộc thì nhân viên gửi
 * `javascript:fetch('/api/staff',{method:'POST',…})` lên bản ghi của chính
 * mình, trưởng phòng mở P-22 bấm vào ô ảnh — `<a href>` — và mã đó chạy trong
 * phiên của trưởng phòng. `rel="noreferrer"` không chặn scheme `javascript:`,
 * `data:text/html` cũng vào được cùng đường.
 *
 * Nhận đúng hai dạng: đường dẫn nội bộ của bản tạm, và tên miền đọc ảnh đang
 * cấu hình. Mọi thứ khác từ chối — kể cả `https://` của nơi khác, vì ảnh chứng
 * minh không có lý do gì nằm ngoài kho của hệ thống.
 */
export function isStorageUrl(url: string): boolean {
  const value = url.trim();
  if (value.startsWith(`/${LOCAL_DIR}/`)) return !value.includes("..");

  const config = readConfig();
  if (!config) return false;

  const allowed = [
    config.publicBaseUrl,
    `https://${config.bucket}.s3.${config.region}.amazonaws.com`,
  ].filter(Boolean);
  return allowed.some((base) => value.startsWith(`${base}/`));
}

/**
 * Nhận diện ảnh bằng CHỮ KÝ ĐẦU FILE, không tin `Content-Type` client khai.
 *
 * Trình duyệt gửi gì cũng được, và một file thực thi đặt tên `.jpg` với header
 * `image/jpeg` vẫn qua được nếu chỉ đọc phần khai báo. Bốn chữ ký dưới đây phủ
 * đúng những định dạng máy ảnh điện thoại sinh ra.
 */
const IMAGE_SIGNATURES: { ext: string; mime: string; test: (b: Uint8Array) => boolean }[] = [
  { ext: "jpg", mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: "png",
    mime: "image/png",
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    ext: "webp",
    mime: "image/webp",
    // "RIFF" ở byte 0-3 và "WEBP" ở byte 8-11.
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    ext: "heic",
    mime: "image/heic",
    /**
     * "ftyp" ở byte 4-7 VÀ brand ở byte 8-11 — ảnh HEIC của iPhone.
     *
     * Chỉ soi `ftyp` là thủng: MP4 và MOV cũng có `ftyp` ở đúng vị trí đó, nên
     * một video (hay file nặn tay) sẽ qua chốt "chỉ nhận ảnh" rồi được lưu với
     * đuôi `.heic`.
     */
    test: (b) => {
      if (!(b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70)) return false;
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      return ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand);
    },
  },
];

const MAX_BYTES = 10 * 1024 * 1024;

export type PutResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

let warnedAboutLocal = false;

/**
 * Đẩy một ảnh lên kho và trả về URL đọc được.
 *
 * Khoá lưu trữ gồm ngày + uuid: ngày để dọn theo lô về sau, uuid để không đoán
 * được và không đụng nhau. KHÔNG dùng tên file gốc — người dùng đặt tên gì cũng
 * được, kể cả `../` hay tên trùng của người khác.
 */
export async function putImage(file: File, folder: string): Promise<PutResult> {
  if (file.size === 0) return { ok: false, message: "File rỗng." };
  if (file.size > MAX_BYTES)
    return {
      ok: false,
      message: `Ảnh nặng ${(file.size / 1024 / 1024).toFixed(1)}MB, vượt mức 10MB.`,
    };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = IMAGE_SIGNATURES.find((s) => s.test(bytes));
  if (!kind)
    return { ok: false, message: "File này không phải ảnh. Chỉ nhận JPG, PNG, WEBP hoặc HEIC." };

  const day = new Date().toISOString().slice(0, 10);
  const key = `${folder}/${day}/${randomUUID()}.${kind.ext}`;

  const config = readConfig();
  return config ? putToS3(config, key, bytes, kind.mime) : putToDisk(key, bytes);
}

async function putToS3(
  config: StorageConfig,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<PutResult> {
  const client = new S3Client({
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: bytes,
        // Kiểu suy từ chữ ký thật, không phải từ thứ client khai.
        ContentType: contentType,
        // Ảnh chứng minh không bao giờ đổi nội dung dưới cùng một khoá.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  } catch (e) {
    // Ghi lại nguyên lỗi cho người vận hành, nhưng KHÔNG trả nó ra client: lỗi
    // của AWS có kèm tên bucket và cấu hình.
    console.error("[storage] không đẩy được ảnh lên S3:", e);
    return { ok: false, message: "Không tải được ảnh lên kho lưu trữ. Thử lại sau ít phút." };
  }

  const base = config.publicBaseUrl || `https://${config.bucket}.s3.${config.region}.amazonaws.com`;
  return { ok: true, url: `${base}/${key}` };
}

/**
 * Bản tạm: ghi vào `public/uploads/` và trả URL TƯƠNG ĐỐI.
 *
 * Tương đối chứ không tuyệt đối là cố ý — `<img src="/uploads/…">` chạy đúng ở
 * mọi tên miền, kể cả khi mở qua IP nội bộ hay cổng khác. Nhồi `localhost:3002`
 * vào database là ngày đổi cổng thì mọi ảnh cũ chết.
 */
async function putToDisk(key: string, bytes: Uint8Array): Promise<PutResult> {
  if (!warnedAboutLocal) {
    warnedAboutLocal = true;
    console.warn(
      "[storage] Chưa cấu hình AWS S3 — ảnh đang ghi vào public/uploads/ trên đĩa máy chủ. Bản tạm để làm việc, xem ghi chú đầu file src/server/storage.ts.",
    );
  }

  const target = path.join(process.cwd(), "public", LOCAL_DIR, key);
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  } catch (e) {
    console.error("[storage] không ghi được ảnh xuống đĩa:", e);
    return { ok: false, message: "Không lưu được ảnh. Thử lại sau ít phút." };
  }

  return { ok: true, url: `/${LOCAL_DIR}/${key}` };
}
