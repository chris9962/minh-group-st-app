import { sql } from "drizzle-orm";
import { db } from "../src/server/db/client";

/**
 * Chạy MỘT lần ngay sau migration 0183, lúc phôi bảo hiểm và phiếu ngân hàng thôi
 * đếm tự động (chủ dự án chốt 2026-11-20, docs/plan-phoi-nhap-con-lai-2026-11-20.md
 * mục 4.2). Lượt deploy sau bỏ cột `used_orders` thì xoá script này.
 *
 * 1. Xoá dòng chỉ do trigger tạo: `issued = 0`, `used` trống, `returned = 0`, kể cả
 *    dòng đã khoá. Sổ của phòng chỉ đọc `issued` và `returned`, nên số phòng không đổi.
 * 2. Dòng đã phát mà chưa ai nhập Đã sử dụng: chép số trigger đếm vào `used`, không
 *    quá tổng đã nhận, để Còn lại không âm. Chạy theo tháng tăng dần vì tồn tháng
 *    trước đọc `used` của tháng trước.
 *
 *   bun run db:blanks-manual            # in số dòng, không ghi
 *   bun run db:blanks-manual -- --apply # ghi
 */

const TABLES = [
  { table: "insurance_blank_staff_quotas", type: "blank_type_id", label: "Phôi bảo hiểm" },
  { table: "bank_blank_staff_quotas", type: "bank_id", label: "Phiếu ngân hàng" },
] as const;

class DryRun extends Error {}

async function main() {
  const apply = process.argv.includes("--apply");
  try {
    await db.transaction(async (tx) => {
      for (const { table, type, label } of TABLES) {
        const t = sql.raw(table);
        const k = sql.raw(type);
        const removed = await tx.execute<{ closed: boolean }>(sql`
          delete from ${t} where issued = 0 and used is null and returned = 0
          returning closed_at is not null as closed`);
        const closed = removed.rows.filter((r) => r.closed).length;

        const months = await tx.execute<{ year_month: string }>(sql`
          select distinct year_month from ${t} where issued > 0 and used is null order by year_month`);
        let filled = 0;
        for (const { year_month } of months.rows) {
          const updated = await tx.execute(sql`
            update ${t} q
            set used = least(q.used_orders, greatest(q.issued - q.returned + coalesce((
                  select sum(p.issued - coalesce(p.used, 0) - p.returned) from ${t} p
                  where p.user_id = q.user_id and p.${k} = q.${k} and p.department_id = q.department_id
                    and p.year_month < q.year_month
                ), 0), 0)),
                updated_at = now()
            where q.year_month = ${year_month} and q.issued > 0 and q.used is null`);
          filled += updated.rowCount ?? 0;
        }
        const [left] = (await tx.execute<{ rows: number }>(sql`select count(*)::int as rows from ${t}`)).rows;
        console.log(
          `${label}: xoá ${removed.rows.length} dòng (${closed} dòng đã khoá), ghi Đã sử dụng cho ${filled} dòng, còn ${left.rows} dòng.`,
        );
      }
      if (!apply) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  console.log(apply ? "Đã ghi." : "Chưa ghi gì. Thêm -- --apply để ghi.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
