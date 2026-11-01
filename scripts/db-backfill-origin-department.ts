import { isNull, sql } from "drizzle-orm";
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
 * Chỉ nhắm vào NULL, chạy lại bao nhiêu lần cũng an toàn:
 *   bun run db:backfill-origin-department -- --dry-run
 *   bun run db:backfill-origin-department
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customers)
    .where(isNull(customers.originDepartmentId));

  console.log(`${count} hồ sơ chưa có phòng lúc lập${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}.`);
  if (dryRun || count === 0) return;

  const updated = await db
    .update(customers)
    .set({ originDepartmentId: customers.createdByDepartmentId })
    .where(isNull(customers.originDepartmentId))
    .returning({ id: customers.id });
  console.log(`Đã điền ${updated.length} hồ sơ.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
