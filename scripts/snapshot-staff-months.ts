import { eq, sql } from "drizzle-orm";
import { businessMonth } from "../src/lib/format";
import { db } from "../src/server/db/client";
import { socialInsuranceRecords } from "../src/server/db/schema";
import { recomputeKpi } from "../src/server/kpi";

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
 *
 * Job cũng chấm lại điểm BHYT/BHXH của tháng vừa bắt đầu. File tải trước đó
 * có thể ghi biên lai của tháng này, mà lúc tải tháng này chưa có dòng nhân sự
 * nên `recomputeKpi` chưa chấm được.
 */

const countsByMonth = async (): Promise<Map<string, number>> => {
  const result = await db.execute<{ year_month: string; n: number }>(
    sql`select year_month, count(*)::int as n from staff_months group by year_month`,
  );
  return new Map(result.rows.map((row) => [row.year_month, row.n]));
};

async function recomputeSocialInsurance() {
  const month = businessMonth();
  const uploads = await db
    .selectDistinct({ userId: socialInsuranceRecords.uploadedBy })
    .from(socialInsuranceRecords)
    .where(eq(socialInsuranceRecords.receiptMonth, month));
  for (const u of uploads) await recomputeKpi(u.userId, month);
  console.log(`Đã chấm lại điểm BHYT/BHXH tháng ${month}: ${uploads.length} người.`);
}

async function main() {
  const before = await countsByMonth();
  await db.execute(sql`select ensure_staff_months()`);
  const after = await countsByMonth();

  const added = [...after].filter(([month]) => !before.has(month)).sort();
  if (added.length === 0) console.log("Không có tháng nào cần chụp.");
  for (const [month, count] of added) console.log(`Đã chụp nhân sự tháng ${month}: ${count} người.`);

  await recomputeSocialInsurance();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
