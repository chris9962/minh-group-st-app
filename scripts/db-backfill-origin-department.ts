import { and, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { customers } from "../src/server/db/schema";

/**
 * Điền `customers.origin_department_id` cho hồ sơ lập TRƯỚC migration 0158.
 * Hồ sơ mới do trigger điền.
 *
 * Lấy phòng đang ghi trên hồ sơ. Hồ sơ của người từng chuyển phòng giữa tháng
 * đã bị `writeStaff` ghi đè phòng, nên không khôi phục được phòng lúc lập thật;
 * chủ dự án chấp nhận 2026-11-01.
 *
 * Ghi từng lô, mỗi lô một transaction: một câu UPDATE cho 112.552 hồ sơ mất
 * 14,5 giây trên DB local và khoá mọi dòng `customers` suốt thời gian đó, nên
 * nhân viên hoàn thành tài khoản lúc ấy phải đợi.
 *
 * Chỉ nhắm vào NULL, chạy lại bao nhiêu lần cũng an toàn:
 *   bun run db:backfill-origin-department -- --dry-run
 *   bun run db:backfill-origin-department
 */
const BATCH_SIZE = 2_000;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const missing = and(isNull(customers.originDepartmentId), isNotNull(customers.createdByDepartmentId));

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customers)
    .where(missing);

  console.log(`${count} hồ sơ chưa có phòng lúc lập${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}.`);
  if (dryRun || count === 0) return;

  const started = performance.now();
  let filled = 0;
  let slowest = 0;
  for (;;) {
    const batchStarted = performance.now();
    const result = await db.execute(sql`
      update customers set origin_department_id = created_by_department_id
      where id in (
        select id from customers
        where origin_department_id is null and created_by_department_id is not null
        order by id
        limit ${BATCH_SIZE}
      )`);
    const updated = result.rowCount ?? 0;
    if (updated === 0) break;
    filled += updated;
    slowest = Math.max(slowest, performance.now() - batchStarted);
    console.log(`  ${filled}/${count}`);
  }
  console.log(
    `Đã điền ${filled} hồ sơ trong ${Math.round((performance.now() - started) / 1000)} giây, lô chậm nhất ${Math.round(slowest)} ms.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
