import { eq, inArray, sql } from "drizzle-orm";
import { formatPoints, roundPoints } from "../src/lib/format";
import { isMonthClosed, lockSalaryMonth } from "../src/server/closedMonths";
import { db } from "../src/server/db/client";
import { bankAccounts, customers, kpiAdjustments, users, vpaUnqualifiedAccounts } from "../src/server/db/schema";
import { comboLossByAccount, type ComboLoss } from "../src/server/kpi";

/**
 * Tính lại điểm trừ của file chốt chỉ tiêu VPa đã nhập, theo luật chủ dự án
 * chốt 2026-11-17: tài khoản VPa không đạt chỉ mất phần tổ hợp, điểm CNKD và
 * HKD giữ nguyên. Lượt nhập trước ngày đó trừ cả điểm CNKD nằm trên dòng VPa.
 *
 * Mỗi tài khoản: tính lại bằng `comboLossByAccount`. Chỉ ghi khi số theo luật
 * cũ (`points + household`) khớp số đã trừ, tức dữ liệu của khách chưa đổi từ
 * lúc nhập. Tài khoản không còn Hoàn thành, hoặc lệch số, thì giữ nguyên và
 * in ra. Dòng điểm trừ của từng người ghi lại bằng tổng mới; tổng về 0 thì
 * xoá dòng, vì bảng không lưu dòng 0 điểm.
 *
 * Không gửi thông báo. Chạy lại được: tài khoản đã đúng luật mới thì giữ nguyên.
 *
 *   bun run db:recompute-vpa-deduction -- --month=2026-10
 *   bun run db:recompute-vpa-deduction -- --month=2026-10 --apply --as=admin
 */

type Target = {
  bankAccountId: string;
  customerId: string;
  customerName: string;
  adjustmentId: string | null;
  points: number;
};

type Change = { target: Target; combo: ComboLoss };

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
  const apply = process.argv.includes("--apply");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const month = process.argv.find((a) => a.startsWith("--month="))?.slice(8) ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Thiếu --month=YYYY-MM, là tháng lương của dòng điểm trừ.");
  if (await isMonthClosed(month)) throw new Error(`Lương tháng ${month} đã chốt, không tính lại được.`);

  const targets: Target[] = (
    await db
      .select({
        bankAccountId: vpaUnqualifiedAccounts.bankAccountId,
        customerId: customers.id,
        customerName: customers.fullName,
        adjustmentId: vpaUnqualifiedAccounts.adjustmentId,
        points: vpaUnqualifiedAccounts.points,
      })
      .from(vpaUnqualifiedAccounts)
      .innerJoin(bankAccounts, eq(bankAccounts.id, vpaUnqualifiedAccounts.bankAccountId))
      .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
      .where(eq(vpaUnqualifiedAccounts.yearMonth, month))
  ).map((r) => ({ ...r, points: Number(r.points) }));
  if (targets.length === 0) {
    console.log(`Tháng ${month} không có tài khoản VPa bị trừ điểm nào.`);
    return;
  }

  const adjustmentIds = [...new Set(targets.map((t) => t.adjustmentId).filter((id): id is string => id !== null))];
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

  const changes: Change[] = [];
  const notDone: Target[] = [];
  const mismatched: string[] = [];
  let unchanged = 0;
  for (const batch of batchesOf(targets)) {
    const loss = await comboLossByAccount(db, new Map(batch.map((t) => [t.customerId, t.bankAccountId])));
    for (const t of batch) {
      const combo = loss.get(t.bankAccountId);
      if (!combo) {
        notDone.push(t);
        continue;
      }
      if (roundPoints(combo.points) === t.points) {
        unchanged++;
        continue;
      }
      if (roundPoints(combo.points + combo.household) !== t.points) {
        mismatched.push(
          `${t.customerName}: đã trừ ${t.points}, luật cũ tính lại ra ${roundPoints(combo.points + combo.household)}, luật mới ra ${combo.points}`,
        );
        continue;
      }
      changes.push({ target: t, combo });
    }
  }

  // Tổng tài khoản phải bằng dòng điểm trừ trước khi sửa; lệch là có người sửa tay, không đụng.
  const newPointsOf = new Map(changes.map((c) => [c.target.bankAccountId, c.combo.points]));
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
  console.log(`  Đổi điểm: ${writable.length}, trả lại ${formatPoints(sum(writable.map((c) => c.combo.household)))} điểm.`);
  console.log(`  Giữ nguyên, số đã trừ đúng luật mới: ${unchanged}.`);
  console.log(`  Giữ nguyên, tài khoản không còn Hoàn thành: ${notDone.length}, ${formatPoints(sum(notDone.map((t) => t.points)))} điểm.`);
  console.log(`  Giữ nguyên, lệch số: ${mismatched.length}.`);
  console.log(`  Giữ nguyên, không nối dòng điểm trừ: ${orphan.length}.`);
  for (const line of mismatched) console.log(`    LỆCH  ${line}`);
  for (const p of unbalanced)
    console.log(`    LỆCH TỔNG  ${p.fullName} (${p.username}): dòng điểm trừ ${p.current}, tổng tài khoản ${p.stored}`);
  console.log(
    `Dòng điểm trừ: ${plans.length}, tổng ${formatPoints(sum(plans.map((p) => p.current)))} điểm. ` +
      `Đổi ${edits.length} dòng, tổng mới ${formatPoints(sum(plans.map((p) => (p.balanced ? p.next : p.current))))} điểm.`,
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
    if (await isMonthClosed(month, tx)) throw new Error(`Lương tháng ${month} đã chốt, không tính lại được.`);

    // Số cũ đọc ngoài transaction: dòng nào đã đổi từ lúc đọc thì huỷ cả lượt, chạy lại.
    for (const c of writable) {
      const written = await tx
        .update(vpaUnqualifiedAccounts)
        .set({
          points: c.combo.points.toFixed(2),
          pointsAfter: c.combo.after.toFixed(2),
        })
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
          ${`Tính lại điểm trừ VPa tháng ${month} cho ${p.fullName}: ${formatPoints(p.current)} còn ${formatPoints(p.next)} điểm, giữ điểm CNKD`},
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
