import { and, eq, inArray, isNull } from "drizzle-orm";
import { roundPoints } from "../src/lib/format";
import { db } from "../src/server/db/client";
import { bankAccounts, customers, kpiAdjustments, vpaUnqualifiedAccounts } from "../src/server/db/schema";
import { comboLossByAccount, type ComboLoss } from "../src/server/kpi";

/**
 * Điền chi tiết cho tài khoản VPa bị trừ điểm TRƯỚC migration 0174: dòng điểm
 * trừ của người lập hồ sơ, điểm combo và ngân hàng trước, sau khi trừ. Lượt
 * nhập file chốt chỉ tiêu VPa ngày 2026-11-16 trên production ghi trước khi có
 * các cột này, nên nút "Xem chi tiết" của khối Điểm trừ không có dòng nào.
 *
 * Nhập lại file không điền được: app bỏ qua tài khoản đã trừ điểm.
 *
 * Dòng điểm trừ nối theo người lập hồ sơ, tháng và giờ ghi: một lượt nhập ghi
 * hai bảng trong một transaction nên `created_at` bằng nhau. Điểm tính lại
 * bằng đúng hàm của lượt nhập; lệch với số đã trừ thì in ra, không ghi.
 *
 *   bun run db:backfill-vpa-deduction-detail -- --dry-run
 *   bun run db:backfill-vpa-deduction-detail
 */

type Target = {
  bankAccountId: string;
  customerId: string;
  customerName: string;
  ownerId: string | null;
  yearMonth: string;
  points: number;
  createdAt: Date;
};

type Detail = { target: Target; combo: ComboLoss; adjustmentId: string | null };

/** `comboLossByAccount` nhận một tài khoản mỗi khách, nên khách có hai tài khoản bị trừ đi hai lượt. */
function batchesOf(targets: Target[]): Target[][] {
  const batches: Target[][] = [];
  for (const t of targets) {
    const batch = batches.find((b) => b.length < 1000 && !b.some((x) => x.customerId === t.customerId));
    if (batch) batch.push(t);
    else batches.push([t]);
  }
  return batches;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const targets: Target[] = (
    await db
      .select({
        bankAccountId: vpaUnqualifiedAccounts.bankAccountId,
        customerId: customers.id,
        customerName: customers.fullName,
        ownerId: customers.createdBy,
        yearMonth: vpaUnqualifiedAccounts.yearMonth,
        points: vpaUnqualifiedAccounts.points,
        createdAt: vpaUnqualifiedAccounts.createdAt,
      })
      .from(vpaUnqualifiedAccounts)
      .innerJoin(bankAccounts, eq(bankAccounts.id, vpaUnqualifiedAccounts.bankAccountId))
      .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
      .where(isNull(vpaUnqualifiedAccounts.pointsBefore))
  ).map((r) => ({ ...r, points: Number(r.points) }));

  if (targets.length === 0) {
    console.log("Không có tài khoản VPa bị trừ điểm nào còn thiếu chi tiết.");
    return;
  }
  console.log(`${targets.length} tài khoản thiếu chi tiết${dryRun ? " (CHẠY KHÔ, không ghi gì)" : ""}.`);

  const ownerIds = [...new Set(targets.map((t) => t.ownerId).filter((id): id is string => id !== null))];
  const adjustments = await db
    .select({
      id: kpiAdjustments.id,
      userId: kpiAdjustments.userId,
      yearMonth: kpiAdjustments.yearMonth,
      points: kpiAdjustments.points,
      createdAt: kpiAdjustments.createdAt,
    })
    .from(kpiAdjustments)
    .where(inArray(kpiAdjustments.userId, ownerIds));
  const keyOf = (userId: string, yearMonth: string, at: Date) => `${userId}|${yearMonth}|${at.getTime()}`;
  const adjustmentOf = new Map(adjustments.map((a) => [keyOf(a.userId, a.yearMonth, a.createdAt), a]));

  const details: Detail[] = [];
  const skipped: string[] = [];
  for (const batch of batchesOf(targets)) {
    const loss = await comboLossByAccount(db, new Map(batch.map((t) => [t.customerId, t.bankAccountId])));
    for (const t of batch) {
      const combo = loss.get(t.bankAccountId);
      if (!combo) {
        skipped.push(`${t.customerName}: tài khoản không còn ở trạng thái Hoàn thành`);
        continue;
      }
      if (roundPoints(combo.points) !== t.points) {
        skipped.push(`${t.customerName}: đã trừ ${t.points}, tính lại ra ${combo.points}`);
        continue;
      }
      const adjustment = t.ownerId ? adjustmentOf.get(keyOf(t.ownerId, t.yearMonth, t.createdAt)) : undefined;
      if (!adjustment && t.points > 0) {
        skipped.push(`${t.customerName}: không tìm thấy dòng điểm trừ của người lập hồ sơ`);
        continue;
      }
      details.push({ target: t, combo, adjustmentId: adjustment?.id ?? null });
    }
  }

  const sumOf = new Map<string, number>();
  for (const d of details)
    if (d.adjustmentId) sumOf.set(d.adjustmentId, roundPoints((sumOf.get(d.adjustmentId) ?? 0) + d.target.points));
  const unbalanced = adjustments.filter((a) => sumOf.has(a.id) && roundPoints(-Number(a.points)) !== sumOf.get(a.id));

  console.log(`Điền được: ${details.length}. Không điền: ${skipped.length}.`);
  console.log(`Dòng điểm trừ nối được: ${sumOf.size}. Lệch tổng: ${unbalanced.length}.`);
  for (const line of skipped) console.log(`  BỎ  ${line}`);
  for (const a of unbalanced)
    console.log(`  LỆCH  điểm trừ ${a.id}: ghi ${a.points}, tổng tài khoản ${sumOf.get(a.id)}`);
  for (const d of details.slice(0, 10))
    console.log(
      `  ${d.target.customerName}: ${d.combo.before} → ${d.combo.after}, ${d.combo.banksBefore.join("+")} → ${d.combo.banksAfter.join("+") || "không còn"}`,
    );

  if (dryRun) return;

  await db.transaction(async (tx) => {
    for (const d of details)
      await tx
        .update(vpaUnqualifiedAccounts)
        .set({
          adjustmentId: d.adjustmentId,
          pointsBefore: d.combo.before.toFixed(2),
          pointsAfter: d.combo.after.toFixed(2),
          banksBefore: d.combo.banksBefore,
          banksAfter: d.combo.banksAfter,
        })
        .where(
          and(eq(vpaUnqualifiedAccounts.bankAccountId, d.target.bankAccountId), isNull(vpaUnqualifiedAccounts.pointsBefore)),
        );
  });
  console.log(`Đã ghi ${details.length} tài khoản.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
