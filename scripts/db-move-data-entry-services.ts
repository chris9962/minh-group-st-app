import { eq, inArray, sql } from "drizzle-orm";
import { closedMonthAmong } from "../src/server/closedMonths";
import { db } from "../src/server/db/client";
import { services, socialInsuranceRecords } from "../src/server/db/schema";
import { recomputeKpi } from "../src/server/kpi";
import { entryServiceDate } from "../src/server/socialInsuranceImport";
import { recomputeEmployeeWorkDay } from "../src/server/workDays";

/**
 * Dời lượt nhập liệu của trang BHYT/BHXH về tháng biên lai (chốt 2026-11-14).
 * Trước ngày đó lượt lấy ngày tải file, nên file tải sau tháng biên lai ghi
 * điểm của nhân viên ATM vào sai tháng. Ngày mới theo `entryServiceDate`. Dời
 * xong thì tính lại KPI và ngày công của người làm ở cả ngày cũ lẫn ngày mới.
 *
 * Lượt có tháng cũ hoặc tháng biên lai đã chốt lương thì bỏ qua, chỉ in số.
 *
 * Chạy khô, in số lượt sẽ dời, không ghi gì:
 *   bun run db:move-data-entry-services
 *
 * Dời thật:
 *   bun run db:move-data-entry-services -- --apply
 */

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await db
    .select({
      id: services.id,
      createdBy: services.createdBy,
      serviceDate: services.serviceDate,
      receiptMonth: socialInsuranceRecords.receiptMonth,
    })
    .from(socialInsuranceRecords)
    .innerJoin(services, eq(services.id, socialInsuranceRecords.serviceId))
    .where(sql`to_char(${services.serviceDate}, 'YYYY-MM') <> ${socialInsuranceRecords.receiptMonth}`);

  const closed = new Set<string>();
  for (const month of new Set(rows.flatMap((r) => [r.serviceDate.slice(0, 7), r.receiptMonth])))
    if (await closedMonthAmong([month])) closed.add(month);

  const targets = rows
    .filter((r) => !closed.has(r.serviceDate.slice(0, 7)) && !closed.has(r.receiptMonth))
    .map((r) => ({ ...r, newDate: entryServiceDate(r.receiptMonth) }));
  const skipped = rows.length - targets.length;

  const byMove = new Map<string, number>();
  for (const r of targets) {
    const key = `${r.serviceDate.slice(0, 7)} → ${r.newDate}`;
    byMove.set(key, (byMove.get(key) ?? 0) + 1);
  }

  console.log(`${targets.length} lượt nhập liệu sẽ dời về tháng biên lai${apply ? "" : " (CHẠY KHÔ, không ghi gì)"}.`);
  for (const [move, n] of byMove) console.log(`  ${move}: ${n}`);
  if (skipped > 0) console.log(`Bỏ qua ${skipped} lượt thuộc tháng đã chốt lương (${[...closed].join(", ")}).`);
  if (targets.length === 0 || !apply) {
    if (!apply && targets.length > 0) console.log("Thêm --apply để dời.");
    process.exit(0);
  }

  const idsByDate = new Map<string, string[]>();
  for (const r of targets) idsByDate.set(r.newDate, [...(idsByDate.get(r.newDate) ?? []), r.id]);
  await db.transaction(async (tx) => {
    for (const [serviceDate, ids] of idsByDate)
      await tx.update(services).set({ serviceDate }).where(inArray(services.id, ids));
  });

  const kpiKeys = new Set(
    targets.flatMap((r) => [`${r.createdBy}|${r.serviceDate.slice(0, 7)}`, `${r.createdBy}|${r.newDate.slice(0, 7)}`]),
  );
  for (const key of kpiKeys) {
    const [userId, month] = key.split("|");
    await recomputeKpi(userId, month);
  }
  const dayKeys = new Set(targets.flatMap((r) => [`${r.createdBy}|${r.serviceDate}`, `${r.createdBy}|${r.newDate}`]));
  for (const key of dayKeys) {
    const [userId, date] = key.split("|");
    await recomputeEmployeeWorkDay(userId, date);
  }

  console.log(`Đã dời ${targets.length} lượt, tính lại ${kpiKeys.size} bản KPI, ${dayKeys.size} ngày công.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
