import { eq, inArray } from "drizzle-orm";
import { db } from "../src/server/db/client";
import {
  bankBlankDepartmentQuotas,
  banks,
  departments,
  insuranceBlankDepartmentQuotas,
  insuranceBlankTypes,
  users,
} from "../src/server/db/schema";

/**
 * Nạp lại số phôi bảo hiểm và phiếu ngân hàng văn phòng đã cấp cho các phòng,
 * đọc từ production 2026-11-02 trước khi dọn 4 bảng phôi/phiếu lúc deploy
 * migration 0160, 0161. Phôi là tháng 2026-11, phiếu là tháng 2026-10. Toàn bộ
 * do Huỳnh Thị Chúc Mi nhập; `updated_by` ghi lại người đó nếu tìm thấy.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:seed-blank-quotas-2026-11
 * Ghi thật, dòng đã có thì ghi đè số:
 *   bun run db:seed-blank-quotas-2026-11 -- --apply
 *
 * Chạy sau `db:migrate` và sau khi dọn bảng; không phụ thuộc `db:recount-blanks`.
 */

const INSURANCE_MONTH = "2026-11";
/** Phòng → [XE-MAY, DIEN-100K, DIEN-200K]; 0 là không cấp loại đó. */
const INSURANCE: Record<string, [number, number, number]> = {
  "Phòng Kinh doanh 1": [1521, 830, 2018],
  "Phòng Kinh doanh 2": [1857, 0, 1500],
  "Phòng Kinh doanh 3": [2000, 2000, 800],
  "Phòng Kinh doanh 4": [1000, 1000, 1000],
  "Phòng Kinh doanh 5": [1986, 1760, 2511],
  "Phòng Kinh doanh 6": [1500, 0, 1500],
  "Phòng Kinh doanh 7": [3209, 1732, 3045],
  "Phòng Kinh doanh 8": [1000, 1000, 2000],
  "Phòng Kinh doanh 9": [2500, 1500, 1500],
  "Phòng Kinh doanh 10": [1000, 1078, 2125],
  "Phòng Kinh doanh 11": [2083, 2071, 3504],
  "Phòng Dự Án": [200, 200, 0],
  "Phòng Y": [180, 35, 0],
};
const INSURANCE_TYPES = ["XE-MAY", "DIEN-100K", "DIEN-200K"] as const;

const BANK_MONTH = "2026-10";
const BANK: Record<string, Record<string, number>> = {
  "Phòng Kinh doanh 10": { MB: 3000, TPB: 3000, VPb: 500 },
};

const ENTERED_BY = "Huỳnh Thị Chúc Mi";

const apply = process.argv.includes("--apply");

const departmentNames = [...new Set([...Object.keys(INSURANCE), ...Object.keys(BANK)])];
const departmentRows = await db
  .select({ id: departments.id, name: departments.name })
  .from(departments)
  .where(inArray(departments.name, departmentNames));
const departmentId = new Map(departmentRows.map((d) => [d.name, d.id]));
const missingDepartments = departmentNames.filter((n) => !departmentId.has(n));
if (missingDepartments.length) throw new Error(`Không thấy phòng: ${missingDepartments.join(", ")}`);

const typeRows = await db.select({ id: insuranceBlankTypes.id, code: insuranceBlankTypes.code }).from(insuranceBlankTypes);
const typeId = new Map(typeRows.map((t) => [t.code, t.id]));
const missingTypes = INSURANCE_TYPES.filter((c) => !typeId.has(c));
if (missingTypes.length) throw new Error(`Không thấy loại phôi: ${missingTypes.join(", ")}. Chạy db:seed-insurance-blanks trước.`);

const bankCodes = [...new Set(Object.values(BANK).flatMap((b) => Object.keys(b)))];
const bankRows = await db.select({ id: banks.id, code: banks.code }).from(banks).where(inArray(banks.code, bankCodes));
const bankId = new Map(bankRows.map((b) => [b.code, b.id]));
const missingBanks = bankCodes.filter((c) => !bankId.has(c));
if (missingBanks.length) throw new Error(`Không thấy ngân hàng: ${missingBanks.join(", ")}`);

const enteredBy = await db.select({ id: users.id }).from(users).where(eq(users.fullName, ENTERED_BY));
const updatedBy = enteredBy.length === 1 ? enteredBy[0].id : null;

const insuranceValues = Object.entries(INSURANCE).flatMap(([name, quantities]) =>
  INSURANCE_TYPES.flatMap((code, i) =>
    quantities[i] > 0
      ? [{ yearMonth: INSURANCE_MONTH, departmentId: departmentId.get(name)!, blankTypeId: typeId.get(code)!, quantity: quantities[i], updatedBy }]
      : [],
  ),
);
const bankValues = Object.entries(BANK).flatMap(([name, byBank]) =>
  Object.entries(byBank).map(([code, quantity]) => ({
    yearMonth: BANK_MONTH,
    departmentId: departmentId.get(name)!,
    bankId: bankId.get(code)!,
    quantity,
    updatedBy,
  })),
);

console.log(apply ? "GHI THẬT" : "CHẠY KHÔ — không ghi gì, thêm --apply để ghi");
console.log(`Phôi ${INSURANCE_MONTH}: ${insuranceValues.length} dòng cho ${Object.keys(INSURANCE).length} phòng.`);
for (const [name, q] of Object.entries(INSURANCE)) console.log(`- ${name}: xe máy ${q[0]}, điện 100k ${q[1]}, điện 200k ${q[2]}`);
console.log(`Phiếu ${BANK_MONTH}: ${bankValues.length} dòng.`);
for (const [name, byBank] of Object.entries(BANK))
  console.log(`- ${name}: ${Object.entries(byBank).map(([c, q]) => `${c} ${q}`).join(", ")}`);
console.log(updatedBy ? `Người nhập: ${ENTERED_BY}.` : `Không thấy đúng một tài khoản tên ${ENTERED_BY}, để trống người nhập.`);

if (apply) {
  await db.transaction(async (tx) => {
    for (const v of insuranceValues)
      await tx
        .insert(insuranceBlankDepartmentQuotas)
        .values(v)
        .onConflictDoUpdate({
          target: [insuranceBlankDepartmentQuotas.yearMonth, insuranceBlankDepartmentQuotas.departmentId, insuranceBlankDepartmentQuotas.blankTypeId],
          set: { quantity: v.quantity, updatedBy, updatedAt: new Date() },
        });
    for (const v of bankValues)
      await tx
        .insert(bankBlankDepartmentQuotas)
        .values(v)
        .onConflictDoUpdate({
          target: [bankBlankDepartmentQuotas.yearMonth, bankBlankDepartmentQuotas.departmentId, bankBlankDepartmentQuotas.bankId],
          set: { quantity: v.quantity, updatedBy, updatedAt: new Date() },
        });
  });
  console.log("Xong.");
}
process.exit(0);
