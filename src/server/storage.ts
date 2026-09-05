import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { heicToJpeg } from "./heicToJpeg";

/**
 * Kho lưu trữ ảnh — hai ngả sau CÙNG một cửa.
 *
 * Nơi gọi chỉ thấy `putImage(...)` và một KHOÁ trả về; nó không biết đằng sau là
 * S3 hay đĩa cứng. Đổi nhà cung cấp về sau là sửa đúng file này.
 *
 *   Có đủ biến môi trường S3   →  đẩy lên FPT Object Storage
 *   Chưa có                    →  ghi vào `.uploads/` trên đĩa máy chủ
 *
 * Ngả thứ hai là BẢN TẠM để làm việc khi chưa có kho lưu trữ. Điền đủ năm biến
 * vào `.env.local` là tự động chuyển sang S3, không phải sửa dòng code nào.
 *
 * ⚠️ BUCKET PHẢI ĐỂ PRIVATE. Không ai đọc ảnh thẳng từ FPT được; mọi lượt xem đi
 * qua `GET /api/images/<key>`, và route đó đòi phiên đăng nhập. Mở bucket ra
 * public là bỏ luôn chốt đó — ảnh chứng minh với tài khoản ngân hàng là dữ liệu
 * cá nhân theo Nghị định 13/2023.
 *
 * ⚠️ Hai giới hạn còn lại, phải biết trước khi mang lên máy chủ thật:
 *
 * 1. Bản tạm ghi ảnh lên ĐĨA CỦA MÁY CHỦ ỨNG DỤNG. Deploy dạng container hay
 *    nhiều máy chạy song song là ảnh mất hoặc máy này không thấy ảnh máy kia.
 * 2. Ảnh thay ra KHÔNG bị xoá khỏi kho. Bản ghi chỉ trỏ sang khoá mới; file cũ
 *    nằm lại. Dọn rác là việc riêng, chưa làm ở cả hai ngả.
 */

type StorageConfig = {
  /** Endpoint của nhà cung cấp, ví dụ `https://s3-han02.fptcloud.com`. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * Đọc cấu hình mỗi lần gọi, KHÔNG cache ở tầng module.
 *
 * Cache thì lần khởi động đầu tiên thiếu biến sẽ khoá cứng trạng thái "chưa cấu
 * hình" cho tới khi khởi động lại tiến trình — thêm biến vào `.env.local` xong
 * vẫn ghi vào đĩa mà không hiểu vì sao.
 */
function readConfig(): StorageConfig | null {
  const endpoint = (process.env.S3_ENDPOINT ?? "").replace(/\/+$/, "");
  const region = process.env.S3_REGION ?? "";
  const bucket = process.env.S3_BUCKET ?? "";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? "";
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;

  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

/**
 * Thư mục ảnh của bản tạm — NẰM NGOÀI `public/`.
 *
 * Để trong `public/` thì Next phục vụ thẳng file ra web, không qua route kiểm
 * phiên đăng nhập nào cả. Bản tạm khi đó lỏng hơn hẳn bản thật, và chỗ lỏng ấy
 * chỉ hiện ra lúc đã có người mở đúng đường dẫn.
 */
const LOCAL_DIR = path.join(process.cwd(), ".uploads");

export const storageBackend = (): "s3" | "local" => (readConfig() ? "s3" : "local");

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

const MIME_BY_EXT = new Map(IMAGE_SIGNATURES.map((s) => [s.ext, s.mime]));

/** Đường dẫn của route đọc ảnh. Đổi ở đây thì đổi cả thư mục route theo. */
const IMAGE_ROUTE = "/api/images";

/**
 * Hình dạng ĐÚNG của một khoá: `<nhóm>/<ngày>/<uuid>.<đuôi>`.
 *
 * ⚠️ Đây là chốt chặn DUYỆT NGƯỢC THƯ MỤC, không phải kiểm tra cho gọn. Khoá đi
 * thẳng vào `path.join` của bản tạm và vào `Key` của S3; nhận chuỗi tự do thì
 * `../../.env.local` là một khoá hợp lệ và route đọc ảnh trở thành đường đọc mọi
 * file trên máy chủ.
 *
 * Mẫu này cũng chặn luôn XSS lưu trữ ở nhịp GHI: `javascript:` hay `data:text/html`
 * không khớp được, nên không chuỗi nào ngoài kho của mình vào nổi database.
 */
const KEY_PATTERN = new RegExp(
  `^[a-z0-9-]+/\\d{4}-\\d{2}-\\d{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${IMAGE_SIGNATURES.map(
    (s) => s.ext,
  ).join("|")})$`,
);

/** Khoá trong database → URL cho `<img src>`. Cùng nguồn với app, không hết hạn. */
export const imageUrl = (key: string): string => `${IMAGE_ROUTE}/${key}`;

/**
 * Chuỗi FE gửi lên → khoá để ghi database, hoặc `null` nếu không phải của mình.
 *
 * FE nhận `/api/images/<key>` rồi gửi nguyên chuỗi đó về lúc lưu, nên nhịp ghi
 * phải cắt phần đầu ra. Nhận thẳng khoá trần cũng được — bản client cũ và các
 * lượt gọi nội bộ đi đường đó.
 */
export function imageKeyOf(value: string): string | null {
  const key = value.trim().replace(new RegExp(`^${IMAGE_ROUTE}/`), "");
  return KEY_PATTERN.test(key) ? key : null;
}

/** Dạng dùng cho `z.refine`. Cặp với `imageKeyOf` ở bước `transform`. */
export const isImageRef = (value: string): boolean => imageKeyOf(value) !== null;

const MAX_BYTES = 20 * 1024 * 1024;

export type PutResult =
  | { ok: true; key: string }
  | { ok: false; message: string };

let warnedAboutLocal = false;

/**
 * Đẩy một ảnh lên kho và trả về KHOÁ của nó.
 *
 * Trả khoá chứ không trả URL: URL là thứ dựng ra lúc đọc (`imageUrl`), còn thứ
 * nằm lại trong database phải là khoá. Lưu URL thì ngày đổi tên miền hay đổi
 * đường route là mọi ảnh cũ chết.
 *
 * Khoá gồm ngày + uuid: ngày để dọn theo lô về sau, uuid để không đoán được và
 * không đụng nhau. KHÔNG dùng tên file gốc — người dùng đặt tên gì cũng được,
 * kể cả `../` hay tên trùng của người khác.
 */
export async function putImage(file: File, folder: string): Promise<PutResult> {
  if (file.size === 0) return { ok: false, message: "File rỗng." };
  if (file.size > MAX_BYTES)
    return {
      ok: false,
      message: `Ảnh nặng ${(file.size / 1024 / 1024).toFixed(1)}MB, vượt mức 20MB.`,
    };

  const raw = new Uint8Array(await file.arrayBuffer());
  const kind = IMAGE_SIGNATURES.find((s) => s.test(raw));
  if (!kind)
    return { ok: false, message: "File này không phải ảnh. Chỉ nhận JPG, PNG, WEBP hoặc HEIC." };

  // HEIC vào kho là ảnh không xem lại được ngoài Safari — chuyển ngay tại đây
  // để mọi đường tải ảnh đều được, không riêng route `/api/uploads`. Chuyển
  // hỏng thì giữ nguyên bản gốc như trước, xem ghi chú ở `heicToJpeg`.
  const converted = kind.ext === "heic" ? await heicToJpeg(raw) : null;
  const bytes = converted ?? raw;
  const ext = converted ? "jpg" : kind.ext;
  const mime = converted ? "image/jpeg" : kind.mime;

  const day = new Date().toISOString().slice(0, 10);
  const key = `${folder}/${day}/${randomUUID()}.${ext}`;

  const config = readConfig();
  return config ? putToS3(config, key, bytes, mime) : putToDisk(key, bytes);
}

function clientFor(config: StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    /**
     * Path-style (`<endpoint>/<bucket>/<key>`) chứ không phải virtual-host
     * (`<bucket>.<endpoint>/<key>`): FPT Object Storage chạy Ceph RGW, dạng
     * virtual-host cần bản ghi DNS ký tự đại diện mà tài khoản thường không có.
     */
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

async function putToS3(
  config: StorageConfig,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<PutResult> {
  try {
    await clientFor(config).send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: bytes,
        // Kiểu suy từ chữ ký thật, không phải từ thứ client khai.
        ContentType: contentType,
      }),
    );
  } catch (e) {
    // Ghi lại nguyên lỗi cho người vận hành, nhưng KHÔNG trả nó ra client: lỗi
    // của SDK có kèm tên bucket và cấu hình.
    console.error("[storage] không đẩy được ảnh lên S3:", e);
    return { ok: false, message: "Không tải được ảnh lên kho lưu trữ. Thử lại sau ít phút." };
  }

  return { ok: true, key };
}

async function putToDisk(key: string, bytes: Uint8Array): Promise<PutResult> {
  if (!warnedAboutLocal) {
    warnedAboutLocal = true;
    console.warn(
      "[storage] Chưa cấu hình S3 — ảnh đang ghi vào .uploads/ trên đĩa máy chủ. Bản tạm để làm việc, xem ghi chú đầu file src/server/storage.ts.",
    );
  }

  const target = path.join(LOCAL_DIR, key);
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  } catch (e) {
    console.error("[storage] không ghi được ảnh xuống đĩa:", e);
    return { ok: false, message: "Không lưu được ảnh. Thử lại sau ít phút." };
  }

  return { ok: true, key };
}

export type StoredImage = { body: ReadableStream<Uint8Array> | ArrayBuffer; contentType: string };

/**
 * Đọc một ảnh ra để route `/api/images` trả về. `null` = không có ảnh nào.
 *
 * Trả luồng chứ không trả cả file trong bộ nhớ ở ngả S3: mười người cùng mở P-22
 * là mười tấm ảnh nằm trong RAM của tiến trình Node cùng lúc.
 *
 * Nơi gọi PHẢI kiểm `imageKeyOf` trước. Hàm này không kiểm lại — nhận khoá tự do
 * thì `path.join` của bản tạm đi ra ngoài `.uploads/` được.
 */
export async function readImage(key: string): Promise<StoredImage | null> {
  const config = readConfig();
  const contentType = MIME_BY_EXT.get(key.split(".").pop() ?? "") ?? "application/octet-stream";

  if (!config) {
    const bytes = await readFile(path.join(LOCAL_DIR, key)).catch(() => null);
    return bytes ? { body: new Uint8Array(bytes).buffer, contentType } : null;
  }

  try {
    const out = await clientFor(config).send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    );
    if (!out.Body) return null;
    return { body: out.Body.transformToWebStream(), contentType: out.ContentType || contentType };
  } catch (e) {
    console.error("[storage] không đọc được ảnh từ S3:", e);
    return null;
  }
}
