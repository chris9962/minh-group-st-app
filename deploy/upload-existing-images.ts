/**
 * Đẩy ảnh còn nằm trên đĩa lên FPT Object Storage. Chạy MỘT LẦN lúc chuyển kho.
 *
 *   bun --env-file=.env.local deploy/upload-existing-images.ts --dry-run
 *   bun --env-file=.env.local deploy/upload-existing-images.ts
 *
 * Thư mục nguồn mặc định là `public/uploads` — chỗ bản cũ ghi ảnh. Đường dẫn
 * tương đối trong thư mục đó CHÍNH LÀ khoá trên kho, nên
 * `public/uploads/bank-accounts/2026-08-20/abc.jpg` lên thành
 * `bank-accounts/2026-08-20/abc.jpg`. Đó cũng là giá trị migration 0031 để lại
 * trong database.
 *
 * Bản đầu viết bằng `curl --aws-sigv4`. Bỏ vì curl 7.81 của Ubuntu 22.04 ký
 * SigV4 sai: mọi request trả `SignatureDoesNotMatch`, kể cả GET. Máy chủ chạy
 * bun nên dùng thẳng SDK của repo.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const CHAY_THU = process.argv.includes("--dry-run");
// Chạy TỪ GỐC REPO: `bun --env-file=.env.local deploy/upload-existing-images.ts`.
// Không dùng `import.meta.dir` vì đó là API riêng của bun, `tsc` không biết.
const NGUON = process.env.NGUON ?? path.join(process.cwd(), "public", "uploads");

const cauHinh = {
  endpoint: (process.env.S3_ENDPOINT ?? "").replace(/\/+$/, ""),
  region: process.env.S3_REGION ?? "",
  bucket: process.env.S3_BUCKET ?? "",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
};

for (const [ten, gt] of Object.entries(cauHinh)) {
  if (!gt) {
    console.error(`Thiếu ${ten} trong .env.local`);
    process.exit(1);
  }
}

const KIEU: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
};

async function duyet(thuMuc: string): Promise<string[]> {
  const muc = await readdir(thuMuc, { withFileTypes: true }).catch(() => []);
  const ra: string[] = [];
  for (const m of muc) {
    const duong = path.join(thuMuc, m.name);
    if (m.isDirectory()) ra.push(...(await duyet(duong)));
    else ra.push(duong);
  }
  return ra;
}

const client = new S3Client({
  region: cauHinh.region,
  endpoint: cauHinh.endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: cauHinh.accessKeyId,
    secretAccessKey: cauHinh.secretAccessKey,
  },
});

if (!(await stat(NGUON).catch(() => null))) {
  console.log(`Không có thư mục ${NGUON}, không có gì để đẩy.`);
  process.exit(0);
}

const files = await duyet(NGUON);
let daDay = 0;
let daCo = 0;
let hong = 0;

for (const duong of files) {
  const khoa = path.relative(NGUON, duong).split(path.sep).join("/");

  /**
   * Có rồi thì bỏ qua.
   *
   * Chạy lại lần hai không đẩy lại từ đầu, và KHÔNG ghi đè ảnh người dùng tải
   * lên sau đó — khoá mang uuid nên trùng khoá nghĩa là trùng đúng tấm ảnh.
   */
  const daTonTai = await client
    .send(new HeadObjectCommand({ Bucket: cauHinh.bucket, Key: khoa }))
    .then(() => true)
    .catch(() => false);

  if (daTonTai) {
    daCo += 1;
    continue;
  }

  if (CHAY_THU) {
    console.log(`[chạy thử] sẽ đẩy: ${khoa}`);
    daDay += 1;
    continue;
  }

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: cauHinh.bucket,
        Key: khoa,
        Body: await readFile(duong),
        ContentType: KIEU[path.extname(duong).toLowerCase()] ?? "application/octet-stream",
      }),
    );
    daDay += 1;
    console.log(`đã đẩy: ${khoa}`);
  } catch (e) {
    hong += 1;
    console.error(`HỎNG: ${khoa} — ${(e as Error).name}: ${(e as Error).message}`);
  }
}

console.log(`\nĐã đẩy: ${daDay} · Đã có sẵn: ${daCo} · Hỏng: ${hong}`);
process.exit(hong > 0 ? 1 : 0);
