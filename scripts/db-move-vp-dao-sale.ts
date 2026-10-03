import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { banks, referralCodes } from "../src/server/db/schema";

/**
 * Chuyển số DAO của VPa, VPb từ Mã text sang cột `dao_sale` (migration 0119,
 * chốt 2026-10-03). Trước migration đó Mã text của hai ngân hàng này giữ số
 * DAO; từ đây Mã text giữ ô "MÃ GIỚI THIỆU", người nhập liệu điền lại sau.
 *
 * Chạy khô, in những gì sẽ ghi:
 *   bun run db:move-vp-dao-sale
 * Ghi thật:
 *   bun run db:move-vp-dao-sale -- --apply
 *
 * Chép nguyên văn, kể cả Mã text không phải số: kiểm ảnh sẽ báo không đạt và
 * người nhập liệu sửa. Chỉ đụng mã chưa có `dao_sale`, nên chạy lại nhiều lần vô hại.
 */

const apply = process.argv.includes("--apply");

const rows = await db
  .select({ id: referralCodes.id, bank: banks.code, code: referralCodes.code, displayName: referralCodes.displayName })
  .from(referralCodes)
  .innerJoin(banks, eq(banks.id, referralCodes.bankId))
  .where(
    and(
      inArray(banks.code, ["VPa", "VPb"]),
      isNull(referralCodes.daoSale),
      sql`nullif(btrim(${referralCodes.code}), '') is not null`,
    ),
  );

for (const bank of ["VPa", "VPb"]) {
  console.log(`${bank}: ${rows.filter((r) => r.bank === bank).length} mã sẽ chuyển Mã text sang Mã DAO SALE`);
}
const notDigits = rows.filter((r) => !/^\d+$/.test(r.code!));
if (notDigits.length) {
  console.log(`\n${notDigits.length} Mã text không phải toàn chữ số, vẫn chép nguyên văn:`);
  for (const r of notDigits) console.log(`  ${r.bank}  "${r.code}"  (tên hiển thị: ${r.displayName})`);
}

if (!apply) {
  console.log("\nChạy khô, chưa ghi gì. Thêm --apply để ghi thật.");
  process.exit(0);
}

const moved = await db.transaction(async (tx) => {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return 0;
  const updated = await tx
    .update(referralCodes)
    .set({ daoSale: sql`${referralCodes.code}`, code: null })
    .where(and(inArray(referralCodes.id, ids), isNull(referralCodes.daoSale)))
    .returning({ id: referralCodes.id });
  return updated.length;
});
console.log(`\nĐã chuyển ${moved} mã.`);
process.exit(0);
