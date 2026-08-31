/**
 * Xoá ảnh khỏi kho S3 theo danh sách khoá đọc từ file.
 *
 * Dùng cho lượt dọn dữ liệu khách trước buổi tập huấn
 * (`docs/plan-clean-tap-huan-2026-08-30.md`, bước 8).
 *
 *   bun --env-file=.env.local scripts/clean-training-images.ts <file> --thu
 *   bun --env-file=.env.local scripts/clean-training-images.ts <file> --xoa-that
 *
 * Nhận khoá từ FILE chứ không tự truy vấn database: tới lúc chạy thì dòng
 * `bank_account_photos` đã bị xoá ở bước 4, không còn chỗ nào tra ra khoá nữa.
 * File phải xuất TRƯỚC lượt xoá database.
 *
 * `src/server/storage.ts` không có hàm xoá và cố ý không có — nó là cửa GHI của
 * ứng dụng. Phần đọc cấu hình và dựng client chép sang đây, không sửa file kia.
 */
import { readFileSync } from "node:fs";
import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Tiền tố của ảnh DANH MỤC, không bao giờ được xoá trong lượt này.
 *
 * `referral-codes` là ảnh QR của mã giới thiệu, `bank-guides` là ảnh mẫu đi kèm
 * hướng dẫn ngân hàng. Cả hai sống lâu hơn dữ liệu khách. Một khoá lạc vào file
 * đầu vào là mất ảnh cấu hình mà không có đường khôi phục.
 */
const CAM_XOA = ["referral-codes/", "bank-guides/"];

/** Cùng hình dạng khoá với `KEY_PATTERN` của `src/server/storage.ts`. */
const KHOA_HOP_LE =
  /^[a-z0-9-]+\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic)$/;

/** S3 nhận tối đa 1000 khoá mỗi lượt `DeleteObjects`. */
const LO = 1000;

const duongDan = process.argv[2];
const xoaThat = process.argv.includes("--xoa-that");

if (!duongDan || duongDan.startsWith("--")) {
  console.error("Thiếu đường dẫn file khoá. Xem docs/plan-clean-tap-huan-2026-08-30.md bước 8.");
  process.exit(1);
}

const endpoint = (process.env.S3_ENDPOINT ?? "").replace(/\/+$/, "");
const region = process.env.S3_REGION ?? "";
const bucket = process.env.S3_BUCKET ?? "";
const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? "";
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? "";

if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
  console.error("Thiếu biến S3_*. Chạy bằng --env-file=.env.local trên máy chủ.");
  process.exit(1);
}

const khoa = readFileSync(duongDan, "utf8")
  .split("\n")
  .map((d) => d.trim())
  .filter(Boolean);

if (khoa.length === 0) {
  console.error(`${duongDan} không có dòng nào.`);
  process.exit(1);
}

// Kiểm TOÀN BỘ file rồi mới xoá dòng nào. Kiểm lẫn xoá theo từng dòng thì một
// khoá hỏng ở cuối file chỉ hiện ra sau khi phần đầu đã mất.
const camXoa = khoa.filter((k) => CAM_XOA.some((p) => k.startsWith(p)));
const saiDang = khoa.filter((k) => !KHOA_HOP_LE.test(k));

if (camXoa.length || saiDang.length) {
  for (const k of camXoa) console.error(`ảnh danh mục, không được xoá: ${k}`);
  for (const k of saiDang) console.error(`khoá sai dạng: ${k}`);
  console.error("Dừng, chưa xoá gì. Sửa file đầu vào rồi chạy lại.");
  process.exit(1);
}

const trung = khoa.length - new Set(khoa).size;
const nhom = new Map<string, number>();
for (const k of khoa) {
  const g = k.slice(0, k.indexOf("/"));
  nhom.set(g, (nhom.get(g) ?? 0) + 1);
}

console.log(`Bucket ${bucket} tại ${endpoint}`);
console.log(`${khoa.length} khoá đọc từ ${duongDan}${trung ? `, ${trung} khoá trùng` : ""}`);
for (const [g, n] of nhom) console.log(`  ${g}: ${n}`);

if (!xoaThat) {
  console.log("\nLượt chạy thử, không xoá gì. Ba khoá đầu:");
  for (const k of khoa.slice(0, 3)) console.log(`  ${k}`);
  console.log("\nXoá thật thì thêm cờ --xoa-that.");
  process.exit(0);
}

const s3 = new S3Client({
  region,
  endpoint,
  // FPT Object Storage chạy Ceph RGW, dạng virtual-host cần DNS ký tự đại diện.
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

const rieng = [...new Set(khoa)];
let daXoa = 0;
const loi: string[] = [];

for (let i = 0; i < rieng.length; i += LO) {
  const lo = rieng.slice(i, i + LO);
  const ketQua = await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: lo.map((Key) => ({ Key })), Quiet: false },
    }),
  );
  daXoa += ketQua.Deleted?.length ?? 0;
  for (const e of ketQua.Errors ?? []) loi.push(`${e.Key}: ${e.Code} ${e.Message}`);
}

console.log(`\nĐã xoá ${daXoa}/${rieng.length} khoá.`);
if (loi.length) {
  console.error(`${loi.length} khoá không xoá được:`);
  for (const d of loi) console.error(`  ${d}`);
  process.exit(1);
}
