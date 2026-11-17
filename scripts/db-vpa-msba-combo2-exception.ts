import { eq, inArray, sql } from "drizzle-orm";
import { formatPoints, roundPoints } from "../src/lib/format";
import { bankTierFor, comboPointsAt } from "../src/rules";
import { isMonthClosed, lockSalaryMonth } from "../src/server/closedMonths";
import { customerDayText } from "../src/server/customerDay";
import { db } from "../src/server/db/client";
import { bankAccounts, customers, kpiAdjustments, users, vpaUnqualifiedAccounts } from "../src/server/db/schema";
import { comboLossByAccount } from "../src/server/kpi";

/**
 * Ngoại lệ MỘT LẦN cho điểm trừ của file chốt chỉ tiêu VPa, chủ dự án chốt
 * 2026-11-17: khách mất VPa mà còn đúng MSBa và một ngân hàng nữa thì hai
 * ngân hàng còn lại được tính là Combo 2. Luật kỳ tháng 9 loại MSBa khỏi
 * Combo 2 và KHÔNG đổi; điểm đã cộng không đổi; lượt nhập file sau vẫn theo
 * luật kỳ. Vì vậy ngoại lệ nằm ở script này, không nằm ở `src/rules`.
 *
 * Điểm Combo 2 dùng cho phần còn lại: 2 ưu tiên 0,7; 1 ưu tiên + 1 khác 0,5.
 * MSBa kèm ngân hàng hạn chế thì giữ nguyên, chưa có quyết định.
 *
 * Chỉ ghi tài khoản mà số đang lưu khớp số luật kỳ tính lại. Chạy lại được:
 * tài khoản đã áp ngoại lệ thì giữ nguyên. Không gửi thông báo.
 *
 *   bun scripts/db-vpa-msba-combo2-exception.ts --month=2026-10
 *   bun scripts/db-vpa-msba-combo2-exception.ts --month=2026-10 --apply --as=admin
 */

const COMBO_2_WITH_MSBA: Record<string, number> = { priority: 0.7, other: 0.5 };

type Target = {
  bankAccountId: string;
  customerId: string;
  customerName: string;
  day: string;
  adjustmentId: string | null;
  points: number;
  pointsAfter: number | null;
  banksAfter: string[] | null;
};

type Change = { target: Target; partner: string; delta: number; points: number; after: number };

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

/** Ngân hàng đi cùng MSBa khi phần còn lại là đúng hai ngân hàng; nhãn có thể kèm " CNKD" hoặc " HKD". */
function partnerOf(banksAfter: string[] | null): string | null {
  const codes = [...new Set((banksAfter ?? []).map((label) => label.split(" ")[0]))];
  if (codes.length !== 2 || !codes.includes("MSBa")) return null;
  return codes.find((code) => code !== "MSBa") ?? null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const month = process.argv.find((a) => a.startsWith("--month="))?.slice(8) ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Thiếu --month=YYYY-MM, là tháng lương của dòng điểm trừ.");
  if (await isMonthClosed(month)) throw new Error(`Lương tháng ${month} đã chốt, không sửa được.`);

  const targets: Target[] = (
    await db
      .select({
        bankAccountId: vpaUnqualifiedAccounts.bankAccountId,
        customerId: customers.id,
        customerName: customers.fullName,
        day: customerDayText,
        adjustmentId: vpaUnqualifiedAccounts.adjustmentId,
        points: vpaUnqualifiedAccounts.points,
        pointsAfter: vpaUnqualifiedAccounts.pointsAfter,
        banksAfter: vpaUnqualifiedAccounts.banksAfter,
      })
      .from(vpaUnqualifiedAccounts)
      .innerJoin(bankAccounts, eq(bankAccounts.id, vpaUnqualifiedAccounts.bankAccountId))
      .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
      .where(eq(vpaUnqualifiedAccounts.yearMonth, month))
  ).map((r) => ({
    ...r,
    points: Number(r.points),
    pointsAfter: r.pointsAfter === null ? null : Number(r.pointsAfter),
  }));

  const candidates = targets.filter((t) => partnerOf(t.banksAfter) !== null);
  const changes: Change[] = [];
  const restricted: Target[] = [];
  const noGain: Target[] = [];
  const mismatched: string[] = [];
  let alreadyApplied = 0;
  for (const batch of batchesOf(candidates)) {
    const loss = await comboLossByAccount(db, new Map(batch.map((t) => [t.customerId, t.bankAccountId])));
    for (const t of batch) {
      const partner = partnerOf(t.banksAfter) as string;
      const tier = bankTierFor(partner, t.day);
      const exception = tier === null ? undefined : COMBO_2_WITH_MSBA[tier];
      if (exception === undefined) {
        restricted.push(t);
        continue;
      }
      const delta = roundPoints(exception - comboPointsAt([partner, "MSBa"], t.day));
      if (delta <= 0) {
        noGain.push(t);
        continue;
      }
      const combo = loss.get(t.bankAccountId);
      if (combo && roundPoints(combo.points - delta) === t.points) {
        alreadyApplied++;
        continue;
      }
      if (!combo || roundPoints(combo.points) !== t.points || roundPoints(combo.after) !== t.pointsAfter) {
        mismatched.push(
          `${t.customerName}: đang lưu trừ ${t.points}, còn ${t.pointsAfter}; luật kỳ tính lại trừ ${combo?.points ?? "không có"}, còn ${combo?.after ?? "không có"}`,
        );
        continue;
      }
      changes.push({
        target: t,
        partner,
        delta,
        points: roundPoints(t.points - delta),
        after: roundPoints(combo.after + delta),
      });
    }
  }

  const adjustmentIds = [...new Set(changes.map((c) => c.target.adjustmentId).filter((id): id is string => id !== null))];
  const adjustments =
    adjustmentIds.length === 0
      ? []
      : await db
          .select({
            id: kpiAdjustments.id,
            points: kpiAdjustments.points,
            yearMonth: kpiAdjustments.yearMonth,
            username: users.username,
            fullName: users.fullName,
          })
          .from(kpiAdjustments)
          .innerJoin(users, eq(users.id, kpiAdjustments.userId))
          .where(inArray(kpiAdjustments.id, adjustmentIds));

  // Tổng tài khoản phải bằng dòng điểm trừ trước khi sửa; lệch là có người sửa tay, không đụng.
  const newPointsOf = new Map(changes.map((c) => [c.target.bankAccountId, c.points]));
  const plans = adjustments.map((a) => {
    const rows = targets.filter((t) => t.adjustmentId === a.id);
    const stored = roundPoints(rows.reduce((s, t) => s + t.points, 0));
    const next = roundPoints(rows.reduce((s, t) => s + (newPointsOf.get(t.bankAccountId) ?? t.points), 0));
    return {
      ...a,
      current: roundPoints(-Number(a.points)),
      stored,
      next,
      changed: rows.filter((t) => newPointsOf.has(t.bankAccountId)).length,
      balanced: a.yearMonth === month && roundPoints(-Number(a.points)) === stored,
    };
  });
  const unbalanced = plans.filter((p) => !p.balanced);
  const blocked = new Set(unbalanced.map((p) => p.id));
  const orphan = changes.filter((c) => c.target.adjustmentId === null);
  const writable = changes.filter((c) => c.target.adjustmentId !== null && !blocked.has(c.target.adjustmentId));
  const edits = plans.filter((p) => p.balanced && p.next !== p.current);

  const sum = (list: number[]) => roundPoints(list.reduce((s, n) => s + n, 0));
  console.log(`Tháng lương ${month}${apply ? "" : " (CHẠY KHÔ, không ghi gì)"}.`);
  console.log(`Tài khoản VPa đã trừ: ${targets.length}, tổng ${formatPoints(sum(targets.map((t) => t.points)))} điểm.`);
  console.log(`Còn lại MSBa và một ngân hàng: ${candidates.length}.`);
  console.log(`  Đổi điểm: ${writable.length}, trả lại ${formatPoints(sum(writable.map((c) => c.delta)))} điểm.`);
  for (const delta of [...new Set(writable.map((c) => c.delta))].sort())
    console.log(`    trả ${formatPoints(delta)}: ${writable.filter((c) => c.delta === delta).length} tài khoản`);
  console.log(`  Giữ nguyên, đã áp ngoại lệ: ${alreadyApplied}.`);
  console.log(`  Giữ nguyên, MSBa kèm ngân hàng hạn chế: ${restricted.length}.`);
  console.log(`  Giữ nguyên, luật kỳ đã tính đủ: ${noGain.length}.`);
  console.log(`  Giữ nguyên, lệch số: ${mismatched.length}.`);
  console.log(`  Giữ nguyên, không nối dòng điểm trừ: ${orphan.length}.`);
  for (const line of mismatched) console.log(`    LỆCH  ${line}`);
  for (const p of unbalanced)
    console.log(`    LỆCH TỔNG  ${p.fullName} (${p.username}): dòng điểm trừ ${p.current}, tổng tài khoản ${p.stored}`);
  console.log(
    `Dòng điểm trừ đổi: ${edits.length}, ${formatPoints(sum(edits.map((p) => p.current)))} còn ${formatPoints(sum(edits.map((p) => p.next)))} điểm.`,
  );
  for (const p of [...edits].sort((a, b) => a.username.localeCompare(b.username)))
    console.log(
      `  ${p.username.toUpperCase()} ${p.fullName}: -${formatPoints(p.current)} → ${p.next === 0 ? "xoá dòng" : `-${formatPoints(p.next)}`} (${p.changed} tài khoản)`,
    );
  if (!apply) return;
  if (writable.length === 0) {
    console.log("Không có gì để ghi.");
    return;
  }

  if (!asArg) throw new Error("Thiếu --as=<tên đăng nhập>. Sửa điểm trừ KPI đổi lương, phải có người chịu trách nhiệm.");
  const [actor] = await db.select({ id: users.id }).from(users).where(sql`${users.username} = ${asArg} and ${users.active}`).limit(1);
  if (!actor) throw new Error(`Không tìm thấy tài khoản đang hoạt động nào có tên đăng nhập "${asArg}".`);

  await db.transaction(async (tx) => {
    await lockSalaryMonth(tx, month);
    if (await isMonthClosed(month, tx)) throw new Error(`Lương tháng ${month} đã chốt, không sửa được.`);

    // Số cũ đọc ngoài transaction: dòng nào đã đổi từ lúc đọc thì huỷ cả lượt, chạy lại.
    for (const c of writable) {
      const written = await tx
        .update(vpaUnqualifiedAccounts)
        .set({ points: c.points.toFixed(2), pointsAfter: c.after.toFixed(2) })
        .where(
          sql`${vpaUnqualifiedAccounts.bankAccountId} = ${c.target.bankAccountId} and ${vpaUnqualifiedAccounts.points} = ${c.target.points.toFixed(2)}`,
        )
        .returning({ id: vpaUnqualifiedAccounts.bankAccountId });
      if (written.length !== 1) throw new Error(`Tài khoản của ${c.target.customerName} đã đổi từ lúc đọc. Không ghi gì, chạy lại.`);
    }

    for (const p of edits) {
      const untouched = sql`${kpiAdjustments.id} = ${p.id} and ${kpiAdjustments.points} = ${(-p.current).toFixed(2)}`;
      const written =
        p.next === 0
          ? await tx.delete(kpiAdjustments).where(untouched).returning({ id: kpiAdjustments.id })
          : await tx.update(kpiAdjustments).set({ points: (-p.next).toFixed(2) }).where(untouched).returning({ id: kpiAdjustments.id });
      if (written.length !== 1) throw new Error(`Dòng điểm trừ của ${p.fullName} đã đổi từ lúc đọc. Không ghi gì, chạy lại.`);
      await tx.execute(sql`
        insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
        values (
          ${actor.id}, 'system'::module_key, 'adjust-kpi'::action_key,
          ${`Tính lại điểm trừ VPa tháng ${month} cho ${p.fullName}: ${formatPoints(p.current)} còn ${formatPoints(p.next)} điểm, MSBa tính trong Combo 2`},
          'kpi_adjustments', ${p.id}
        )
      `);
    }
  });
  console.log(`Đã ghi ${writable.length} tài khoản, ${edits.length} dòng điểm trừ và nhật ký truy vết.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
