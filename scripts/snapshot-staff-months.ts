import { sql } from "drizzle-orm";
import { db } from "../src/server/db/client";

/**
 * Chụp nhân sự của các tháng đã kết thúc (chốt 2026-09-30).
 *
 * Timer `mgst-staff-snapshot.timer` gọi lúc 00:00 ngày 1 hằng tháng, giờ Việt
 * Nam. Hàm `ensure_staff_months()` ở database ghi vào `staff_months` một dòng
 * cho mỗi người của mỗi tháng đã kết thúc mà chưa có bản chụp, theo hồ sơ lúc
 * chạy. Từ đó số liệu của tháng ấy không đổi theo hồ sơ nữa.
 *
 *   bun --env-file=.env.local scripts/snapshot-staff-months.ts
 *
 * Chạy lại vô hại: tháng đã chụp thì bỏ qua.
 */

const countsByMonth = async (): Promise<Map<string, number>> => {
  const result = await db.execute<{ year_month: string; n: number }>(
    sql`select year_month, count(*)::int as n from staff_months group by year_month`,
  );
  return new Map(result.rows.map((row) => [row.year_month, row.n]));
};

async function main() {
  const before = await countsByMonth();
  await db.execute(sql`select ensure_staff_months()`);
  const after = await countsByMonth();

  const added = [...after].filter(([month]) => !before.has(month)).sort();
  if (added.length === 0) {
    console.log("Không có tháng nào cần chụp.");
    return;
  }
  for (const [month, count] of added) console.log(`Đã chụp nhân sự tháng ${month}: ${count} người.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
