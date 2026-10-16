import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { DATA_ENTRY_TYPE_NAMES } from "../src/lib/api/socialInsurance";
import { closedMonthAmong } from "../src/server/closedMonths";
import { db } from "../src/server/db/client";
import { serviceTypes, services, socialInsuranceRecords } from "../src/server/db/schema";
import { recomputeKpi } from "../src/server/kpi";
import { recomputeEmployeeWorkDay } from "../src/server/workDays";

/**
 * Xoá mọi lượt dịch vụ "Nhập liệu BHYT" / "Nhập liệu BHXH" của một tháng (chốt
 * 2026-10-06), rồi tính lại KPI và ngày công của người làm, như nút Xoá ở P-31.
 *
 * Lượt sinh từ file của trang BHYT/BHXH thì BỎ QUA: dòng hồ sơ BHYT/BHXH trỏ vào
 * nó, xoá lượt là mất dữ liệu KPI An Sinh. Script chỉ đếm và in số lượt đó.
 *
 * Chạy khô, in số lượt sẽ xoá, không ghi gì:
 *   bun run db:delete-data-entry-services -- --month=2026-10
 *
 * Xoá thật:
 *   bun run db:delete-data-entry-services -- --month=2026-10 --apply
 */

async function main() {
  const month = process.argv.find((a) => a.startsWith("--month="))?.slice(8) ?? "";
  const apply = process.argv.includes("--apply");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Thiếu --month=YYYY-MM. Ví dụ: bun run db:delete-data-entry-services -- --month=2026-10");

  const closed = await closedMonthAmong([month]);
  if (closed) throw new Error(`Tháng ${closed} đã chốt lương, không xoá được.`);

  const [year, mon] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, "0")}-01`;

  const rows = await db
    .select({
      id: services.id,
      createdBy: services.createdBy,
      serviceDate: services.serviceDate,
      typeName: serviceTypes.name,
      recordId: socialInsuranceRecords.id,
    })
    .from(services)
    .innerJoin(serviceTypes, eq(serviceTypes.id, services.serviceTypeId))
    .leftJoin(socialInsuranceRecords, eq(socialInsuranceRecords.serviceId, services.id))
    .where(
      and(
        inArray(serviceTypes.name, [...DATA_ENTRY_TYPE_NAMES]),
        gte(services.serviceDate, from),
        lt(services.serviceDate, to),
      ),
    );

  const targets = rows.filter((r) => !r.recordId);
  const linked = rows.length - targets.length;
  const byType = new Map<string, number>();
  for (const r of targets) byType.set(r.typeName, (byType.get(r.typeName) ?? 0) + 1);

  console.log(`Tháng ${month}: ${targets.length} lượt nhập liệu sẽ xoá${apply ? "" : " (CHẠY KHÔ, không ghi gì)"}.`);
  for (const [name, n] of byType) console.log(`  ${name}: ${n}`);
  if (linked > 0) console.log(`Bỏ qua ${linked} lượt sinh từ file của trang BHYT/BHXH.`);
  if (targets.length === 0 || !apply) {
    if (!apply && targets.length > 0) console.log("Thêm --apply để xoá.");
    process.exit(0);
  }

  await db.delete(services).where(inArray(services.id, targets.map((r) => r.id)));

  const kpiKeys = new Set(targets.map((r) => r.createdBy));
  for (const userId of kpiKeys) await recomputeKpi(userId, month);
  const dayKeys = new Set(targets.map((r) => `${r.createdBy}|${r.serviceDate}`));
  for (const key of dayKeys) {
    const [userId, date] = key.split("|");
    await recomputeEmployeeWorkDay(userId, date);
  }

  console.log(`Đã xoá ${targets.length} lượt, tính lại KPI ${kpiKeys.size} người, ${dayKeys.size} ngày công.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
