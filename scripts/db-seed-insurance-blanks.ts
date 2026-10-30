import { eq } from "drizzle-orm";
import { businessMonth } from "../src/lib/format";
import { db } from "../src/server/db/client";
import { insuranceBlankTypes, insuranceMixTargets } from "../src/server/db/schema";

/**
 * Nạp danh mục 3 loại phôi bảo hiểm và mục tiêu tỉ lệ điện/xe 7/3 (chốt 2026-10-29).
 * Migration 0154 chỉ tạo bảng; dữ liệu đi bằng script này.
 *
 * Đơn điện chia loại phôi theo số tiền bảo hiểm: 40 triệu là phôi 100k, 80 triệu
 * là phôi 200k. Đo trên DB 2026-10-29, đơn Hoàn thành từ 2026-10-01 khớp 1-1 với phí.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:seed-insurance-blanks
 * Ghi thật, mục tiêu đặt cho tháng hiện tại hoặc tháng chỉ định:
 *   bun run db:seed-insurance-blanks -- --apply [--month=2026-10]
 *
 * Chạy lại được: loại phôi đã có mã thì bỏ qua; đã có mục tiêu ở bất kỳ tháng nào thì không ghi mục tiêu.
 */

const TYPES = [
  { code: "XE-MAY", name: "BH xe máy", product: "motorbike", sumInsured: null, sort: 1 },
  { code: "DIEN-100K", name: "BH điện 100k", product: "electric-accident", sumInsured: 40_000_000, sort: 2 },
  { code: "DIEN-200K", name: "BH điện 200k", product: "electric-accident", sumInsured: 80_000_000, sort: 3 },
] as const;

const TARGET = { electricParts: 7, motorbikeParts: 3 };

const apply = process.argv.includes("--apply");
const month = process.argv.find((a) => a.startsWith("--month="))?.slice(8) ?? businessMonth();
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`Tháng không hợp lệ: ${month}`);

const existingCodes = new Set((await db.select({ code: insuranceBlankTypes.code }).from(insuranceBlankTypes)).map((r) => r.code));
const missing = TYPES.filter((t) => !existingCodes.has(t.code));
const [anyTarget] = await db.select({ month: insuranceMixTargets.yearMonth }).from(insuranceMixTargets).limit(1);

console.log(apply ? "GHI THẬT" : "CHẠY KHÔ — không ghi gì, thêm --apply để ghi");
console.log(missing.length ? `Thêm ${missing.length} loại phôi: ${missing.map((t) => t.code).join(", ")}` : "Đủ 3 loại phôi.");
console.log(anyTarget ? `Đã có mục tiêu từ tháng ${anyTarget.month}, không ghi.` : `Ghi mục tiêu 7/3 cho tháng ${month}.`);

if (apply) {
  if (missing.length) await db.insert(insuranceBlankTypes).values(missing.map((t) => ({ ...t })));
  if (!anyTarget) await db.insert(insuranceMixTargets).values({ yearMonth: month, ...TARGET });
  const rows = await db.select().from(insuranceBlankTypes).where(eq(insuranceBlankTypes.active, true));
  console.log(`Xong. Danh mục có ${rows.length} loại phôi đang dùng.`);
}
process.exit(0);
