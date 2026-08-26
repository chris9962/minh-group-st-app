/**
 * Kiểm bản sao lưu mới nhất có quá cũ không — `bun run db:backup:check`.
 *
 * Chạy 08:00 mỗi ngày qua `mgst-backup-check.timer`.
 *
 * Vì sao cần một timer RIÊNG: `mgst-backup.timer` chỉ báo động được khi nó CHẠY
 * và hỏng. Timer chết hẳn — service bị disable, máy chủ dừng lâu, đồng hồ sai —
 * thì không có lượt chạy nào để mà hỏng, và mọi thứ trông vẫn ổn cho tới ngày
 * cần khôi phục. Câu hỏi "bản mới nhất bao nhiêu tuổi" phải đến từ bên ngoài.
 *
 * Ngưỡng mặc định 20 giờ: hai lượt sao lưu cách nhau 12:00 → 18:00 → 12:00, tức
 * khoảng cách dài nhất là 18 giờ. Thêm 2 giờ dư cho lượt chạy trễ.
 */
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const MAX_AGE_HOURS = Number(process.env.BACKUP_MAX_AGE_HOURS ?? 20);

function fail(message: string): never {
  console.error(`[backup-check] HỎNG — ${message}`);
  process.exit(1);
}

/** `BACKUP_S3_*` thiếu thì dùng `S3_*` của app — xem ghi chú trong `db-backup.ts`. */
const env = process.env;
const endpoint = (env.BACKUP_S3_ENDPOINT || env.S3_ENDPOINT || "").replace(/\/+$/, "");
const region = env.BACKUP_S3_REGION || env.S3_REGION || "";
const bucket = env.BACKUP_S3_BUCKET ?? "";
const accessKeyId = env.BACKUP_S3_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID || "";
const secretAccessKey = env.BACKUP_S3_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY || "";
if (!bucket || !endpoint || !region || !accessKeyId || !secretAccessKey)
  fail("thiếu cấu hình S3 — khai BACKUP_S3_BUCKET, và BACKUP_S3_* hoặc S3_*");

const client = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

let token: string | undefined;
let newest: { key: string; at: Date; size: number } | null = null;
do {
  const page = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
  );
  for (const o of page.Contents ?? []) {
    if (!o.LastModified || !o.Key) continue;
    if (!newest || o.LastModified > newest.at)
      newest = { key: o.Key, at: o.LastModified, size: o.Size ?? 0 };
  }
  token = page.NextContinuationToken;
} while (token);

if (!newest) fail(`bucket ${bucket} không có bản sao lưu nào`);

const ageHours = (Date.now() - newest.at.getTime()) / 3_600_000;
const line = `${newest.key} · ${Math.round(newest.size / 1024)} KB · ${ageHours.toFixed(1)} giờ tuổi`;

if (ageHours > MAX_AGE_HOURS)
  fail(`bản mới nhất quá ${MAX_AGE_HOURS} giờ tuổi — ${line}`);

console.log(`[backup-check] đạt — ${line}`);
