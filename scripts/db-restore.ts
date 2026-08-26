/**
 * Khôi phục database từ bản sao lưu trên S3 — `bun run db:restore`.
 *
 * Ba cách gọi:
 *
 *   bun run db:restore                       liệt kê bản đang có, KHÔNG khôi phục
 *   bun run db:restore -- <key> --thu        khôi phục vào database `mgst_thu`
 *   bun run db:restore -- <key> --that       khôi phục ĐÈ lên `mgst`
 *
 * ⚠️ Mặc định là `--thu`, và đó là chủ ý. Khôi phục đè lên database đang chạy
 * thì một bản dump hỏng làm mất luôn dữ liệu thật — hai thứ mất cùng lúc, đúng
 * lúc bạn cần một trong hai. Diễn tập quý nào cũng chạy `--thu`.
 *
 * Biến môi trường giống `db-backup.ts`, đọc từ `/opt/mgst-app/.env.backup`.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const CONTAINER_DB = process.env.BACKUP_DB_CONTAINER ?? "mgst-db";
const TMP_FILE = "/tmp/mgst-restore.dump";

function fail(message: string): never {
  console.error(`[restore] ${message}`);
  process.exit(1);
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
    client: new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
  };
}

const args = process.argv.slice(2);
const key = args.find((a) => !a.startsWith("--"));
const toReal = args.includes("--that");
const { client, bucket } = s3Client();

if (!key) {
  let token: string | undefined;
  const rows: { key: string; size: number; at: string }[] = [];
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const o of page.Contents ?? [])
      rows.push({
        key: o.Key ?? "",
        size: o.Size ?? 0,
        at: o.LastModified?.toISOString().slice(0, 16).replace("T", " ") ?? "",
      });
    token = page.NextContinuationToken;
  } while (token);

  rows.sort((a, b) => b.key.localeCompare(a.key));
  console.log(`\n${rows.length} bản sao lưu trong s3://${bucket}\n`);
  for (const r of rows.slice(0, 30))
    console.log(`  ${r.key.padEnd(42)} ${String(Math.round(r.size / 1024)).padStart(6)} KB   ${r.at} UTC`);
  if (rows.length > 30) console.log(`  … còn ${rows.length - 30} bản nữa`);
  console.log(`\nKhôi phục thử:  bun run db:restore -- ${rows[0]?.key ?? "<key>"} --thu`);
  process.exit(0);
}

console.log(`[restore] tải s3://${bucket}/${key}`);
const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
const bytes = await object.Body!.transformToByteArray();
writeFileSync(TMP_FILE, bytes);
console.log(`[restore] tải xong ${(bytes.length / 1024).toFixed(0)} KB`);

const target = toReal ? "mgst" : "mgst_thu";

if (toReal) {
  console.log("\n⚠️  Khôi phục ĐÈ lên database THẬT `mgst`.");
  console.log("    Dừng container app trước, nếu không nó ghi tiếp lên dữ liệu đang được thay.\n");
} else {
  const psql = (sql: string) =>
    spawnSync("docker", ["exec", CONTAINER_DB, "psql", "-U", "mgst", "-d", "postgres", "-c", sql], {
      stdio: ["ignore", "inherit", "inherit"],
    });
  psql(`DROP DATABASE IF EXISTS ${target};`);
  const created = psql(`CREATE DATABASE ${target};`);
  if (created.status !== 0) fail(`không tạo được database ${target}`);
}

const restore = spawnSync(
  "sh",
  [
    "-c",
    `docker exec -i ${CONTAINER_DB} pg_restore -U mgst -d ${target} ${toReal ? "--clean --if-exists" : ""} < "${TMP_FILE}"`,
  ],
  { stdio: ["ignore", "inherit", "inherit"] },
);
// `pg_restore` trả mã khác 0 cả khi chỉ có cảnh báo về quyền sở hữu, nên không
// dừng ở đây — số dòng đếm bên dưới mới là câu trả lời thật.
if (restore.status !== 0)
  console.warn(`[restore] pg_restore trả mã ${restore.status} — đọc log trên, rồi xem số dòng dưới`);

console.log(`\n[restore] số dòng trong \`${target}\`:`);
spawnSync(
  "docker",
  [
    "exec",
    CONTAINER_DB,
    "psql",
    "-U",
    "mgst",
    "-d",
    target,
    "-c",
    `SELECT 'users' AS bang, count(*) FROM users
     UNION ALL SELECT 'customers', count(*) FROM customers
     UNION ALL SELECT 'bank_accounts', count(*) FROM bank_accounts
     UNION ALL SELECT 'insurance_orders', count(*) FROM insurance_orders
     UNION ALL SELECT 'kpi_scores', count(*) FROM kpi_scores ORDER BY 1;`,
  ],
  { stdio: ["ignore", "inherit", "inherit"] },
);

if (!toReal)
  console.log(
    `\nSo số dòng trên với database thật. Khớp thì xoá bản thử:\n` +
      `  docker exec ${CONTAINER_DB} psql -U mgst -d postgres -c "DROP DATABASE ${target};"`,
  );
