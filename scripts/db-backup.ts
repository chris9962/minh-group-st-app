/**
 * Sao lưu database lên S3 — `bun run db:backup`.
 *
 * Chạy hai lượt mỗi ngày, 12:00 và 18:00 giờ Việt Nam (chốt 2026-08-26), qua
 * systemd timer `mgst-backup.timer`. Xem `docs/plan-backup-db.md`.
 *
 * ⚠️ Bucket sao lưu KHÁC bucket ảnh, và dùng CẶP KHOÁ RIÊNG. Bucket ảnh là dữ
 * liệu của ứng dụng đang chạy — app có quyền xoá trong đó. Bản sao lưu phải nằm
 * ngoài tầm với của app: một lỗi ở đường xoá ảnh không được phép chạm tới nó.
 *
 * Biến môi trường, đọc từ `/opt/mgst-app/.env.backup` chứ không từ `.env.local`:
 *
 *   BACKUP_S3_ENDPOINT · BACKUP_S3_REGION · BACKUP_S3_BUCKET
 *   BACKUP_S3_ACCESS_KEY_ID · BACKUP_S3_SECRET_ACCESS_KEY
 *   BACKUP_KEEP_DAYS   số ngày giữ trên S3, mặc định 30
 *   BACKUP_LOCAL_DIR   thư mục giữ bản trên đĩa, mặc định /root/mgst-backup
 *   BACKUP_KEEP_LOCAL  số file giữ trên đĩa, mặc định 14
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/** Dump rỗng vẫn cho mã 0, nên phải kiểm cả kích thước. */
const MIN_DUMP_BYTES = 100 * 1024;

const CONTAINER_DB = process.env.BACKUP_DB_CONTAINER ?? "mgst-db";
const LOCAL_DIR = process.env.BACKUP_LOCAL_DIR ?? "/root/mgst-backup";
const KEEP_LOCAL = Number(process.env.BACKUP_KEEP_LOCAL ?? 14);
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS ?? 30);

function fail(message: string): never {
  console.error(`[backup] HỎNG — ${message}`);
  process.exit(1);
}

/**
 * Giờ Việt Nam, không phải UTC.
 *
 * Máy chủ đang đặt `Asia/Ho_Chi_Minh` nên `toLocaleString` không cần đổi gì,
 * nhưng ghi rõ múi giờ ở đây để ngày nào máy chủ chuyển sang UTC thì tên file
 * vẫn đúng — người đọc tên file mong thấy giờ họ nhìn trên đồng hồ.
 */
function stampVn(): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const [day, clock] = parts.split(" ");
  return { day, time: clock.replace(":", "") };
}

/**
 * Cấu hình S3 của bucket sao lưu.
 *
 * `BACKUP_S3_*` thiếu thì dùng `S3_*` của app. Khoá riêng cho bucket sao lưu là
 * hình dạng an toàn hơn — app không chạm được vào bản sao lưu — nhưng nó đòi
 * thêm một cặp khoá phải cấp và phải nhớ. Chọn dùng chung thì chỉ cần khai
 * `BACKUP_S3_BUCKET`, và ngày muốn tách thì thêm hai dòng khoá vào
 * `.env.backup`, không phải sửa code.
 *
 * BUCKET thì KHÔNG có đường dùng chung: sao lưu nằm chung bucket ảnh nghĩa là
 * đường xoá ảnh của app quét trúng bản sao lưu.
 */
function s3Client(): { client: S3Client; bucket: string } {
  const env = process.env;
  const endpoint = (env.BACKUP_S3_ENDPOINT || env.S3_ENDPOINT || "").replace(/\/+$/, "");
  const region = env.BACKUP_S3_REGION || env.S3_REGION || "";
  const bucket = env.BACKUP_S3_BUCKET ?? "";
  const accessKeyId = env.BACKUP_S3_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID || "";
  const secretAccessKey = env.BACKUP_S3_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY || "";
  if (!bucket) fail("thiếu BACKUP_S3_BUCKET — xem docs/plan-backup-db.md mục 8");
  if (bucket === env.S3_BUCKET)
    fail(`BACKUP_S3_BUCKET trùng bucket ảnh (${bucket}) — sao lưu phải nằm ở bucket khác`);
  if (!endpoint || !region || !accessKeyId || !secretAccessKey)
    fail("thiếu cấu hình S3 — khai BACKUP_S3_* hoặc để script dùng S3_* của app");

  return {
    // `forcePathStyle` bắt buộc với FPT Object Storage: nó không nhận dạng
    // `<bucket>.<endpoint>` mà đòi `<endpoint>/<bucket>`.
    client: new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
  };
}

const { day, time } = stampVn();
const fileName = `mgst-${day}-${time}.dump`;
/** Một thư mục mỗi ngày, hai file trong đó (chốt 2026-08-26). */
const objectKey = `${day}/${fileName}`;
const localFile = path.join(LOCAL_DIR, fileName);

mkdirSync(LOCAL_DIR, { recursive: true });

console.log(`[backup] dump → ${localFile}`);
const dump = spawnSync(
  "sh",
  ["-c", `docker exec ${CONTAINER_DB} pg_dump -U mgst -d mgst -Fc > "${localFile}"`],
  { stdio: ["ignore", "inherit", "inherit"] },
);
if (dump.status !== 0) fail(`pg_dump trả mã ${dump.status}`);

const size = statSync(localFile).size;
if (size < MIN_DUMP_BYTES)
  fail(`dump chỉ ${size} byte, dưới ngưỡng ${MIN_DUMP_BYTES} — nghi là dump rỗng`);
console.log(`[backup] dump xong ${(size / 1024).toFixed(0)} KB`);

const { client, bucket } = s3Client();

await client.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    Body: readFileSync(localFile),
    ContentType: "application/octet-stream",
  }),
);

// Đọc lại kích thước trên S3: `PutObject` không lỗi vẫn có thể ghi thiếu khi
// đường truyền đứt giữa chừng, và một bản sao lưu thiếu byte thì `pg_restore`
// chỉ báo lỗi vào ngày cần dùng tới nó.
const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
if (head.ContentLength !== size)
  fail(`S3 nhận ${head.ContentLength} byte, file gốc ${size} byte`);
console.log(`[backup] đã lên s3://${bucket}/${objectKey}`);

/* ── Dọn bản quá hạn ─────────────────────────────────────────────────── */

const local = readdirSync(LOCAL_DIR)
  .filter((f) => f.startsWith("mgst-") && f.endsWith(".dump"))
  .sort()
  .reverse();
for (const stale of local.slice(KEEP_LOCAL)) {
  rmSync(path.join(LOCAL_DIR, stale));
  console.log(`[backup] xoá bản cũ trên đĩa: ${stale}`);
}

/**
 * Trên S3 xoá theo NGÀY, không theo số file.
 *
 * Đếm file thì một ngày chạy lỗi nửa chừng sẽ đẩy cả cụm lệch đi, và số ngày
 * giữ được không còn đoán ra từ con số cấu hình.
 */
const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000)
  .toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });

let token: string | undefined;
let removed = 0;
do {
  const page = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
  );
  for (const obj of page.Contents ?? []) {
    const folder = obj.Key?.split("/")[0] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(folder) || folder >= cutoff) continue;
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key! }));
    removed += 1;
  }
  token = page.NextContinuationToken;
} while (token);

if (removed > 0) console.log(`[backup] xoá ${removed} object cũ hơn ${cutoff} trên S3`);
console.log(`[backup] XONG ${objectKey}`);
