import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { BANK_ACCOUNT_STATUS_LABEL } from "@/lib/api/bankAccounts";
import type { CasaFileRow } from "@/lib/api/casa";
import {
  CASA_MIN_BALANCE,
  isQualifiedValue,
  type StaffDeduction,
  type UnqualifiedRow,
  type VpaDeductedAccount,
  type VpaTargetFileRow,
  type VpaTargetImportRequest,
  type VpaTargetImportResult,
} from "@/lib/api/vpaTargets";
import { formatPoints, monthRange, roundPoints } from "@/lib/format";
import { parseMoneyCents } from "@/lib/money";
import { shiftMonth } from "@/lib/period";
import type { User } from "@/lib/types";
import { logAudit } from "./audit";
import {
  CASA_BANK_CODE,
  checkRows as checkCasaRows,
  normalizeIdNumber,
  pickAccount,
  type Candidate,
  type Conn,
  type Outcome,
} from "./casa";
import { closedMonthMessage, isMonthClosed, lockSalaryMonth } from "./closedMonths";
import { db } from "./db/client";
import {
  bankAccounts,
  banks,
  casaAccounts,
  customers,
  kpiAdjustments,
  salaryClosings,
  users,
  vpaUnqualifiedAccounts,
} from "./db/schema";
import { comboLossByAccount, type ComboLoss } from "./kpi";
import { notify } from "./notifications";
import { visibleStaffId } from "./people";

const monthText = (yearMonth: string) => `${yearMonth.slice(5)}/${yearMonth.slice(0, 4)}`;

/** Cùng câu với đợt trừ điểm VPBa tháng 08 (`scripts/db-kpi-deduction.ts`), đổi số tháng của file. */
export const deductionReason = (month: string) =>
  `điểm trừ lỗi VPBa tháng ${shiftMonth(month, -1).slice(5)} không ghi nhận đủ giao dịch khác ngày`;

const isQualified = (r: VpaTargetFileRow) => isQualifiedValue(r.qualified);

/** Ô "Chưa có dữ liệu" không đọc được số, không đạt ngưỡng. */
const isCasaRow = (r: VpaTargetFileRow) => {
  const cents = parseMoneyCents(r.casa);
  return isQualified(r) && typeof cents === "number" && cents >= CASA_MIN_BALANCE * 100;
};

type Match = Candidate & {
  customerId: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerActive: boolean;
  deductedMonth: string | null;
};

type Counted = { accountId: string; customerId: string; ownerId: string; index: number };

type StaffTotal = StaffDeduction & { active: boolean };

type Checked = {
  unqualified: UnqualifiedRow[];
  casa: VpaTargetImportResult["casa"];
  staff: StaffTotal[];
  counted: (Counted & { points: number; combo: ComboLoss | null })[];
  casaIds: string[];
  casaRemoveIds: string[];
};

async function matchesOf(conn: Conn, idNumbers: string[]): Promise<Map<string, Match[]>> {
  const out = new Map<string, Match[]>();
  if (idNumbers.length === 0) return out;
  const found = await conn
    .select({
      idNumber: customers.idNumber,
      customerId: customers.id,
      customerName: customers.fullName,
      ownerId: customers.createdBy,
      creatorUsername: users.username,
      ownerName: users.fullName,
      ownerActive: users.active,
      id: bankAccounts.id,
      accountNumber: bankAccounts.accountNumber,
      status: bankAccounts.status,
      accountType: bankAccounts.accountType,
      createdAt: bankAccounts.createdAt,
      casaMonth: casaAccounts.yearMonth,
      deductedMonth: vpaUnqualifiedAccounts.yearMonth,
    })
    .from(customers)
    .leftJoin(
      bankAccounts,
      and(
        eq(bankAccounts.customerId, customers.id),
        eq(bankAccounts.bankId, sql`(select ${banks.id} from ${banks} where ${banks.code} = ${CASA_BANK_CODE})`),
      ),
    )
    .leftJoin(users, eq(users.id, customers.createdBy))
    .leftJoin(casaAccounts, eq(casaAccounts.bankAccountId, bankAccounts.id))
    .leftJoin(vpaUnqualifiedAccounts, eq(vpaUnqualifiedAccounts.bankAccountId, bankAccounts.id))
    .where(inArray(customers.idNumber, idNumbers));

  for (const f of found) {
    if (!f.idNumber) continue;
    const list = out.get(f.idNumber) ?? [];
    out.set(f.idNumber, list);
    if (!f.id || !f.status || !f.accountType || !f.createdAt) continue;
    list.push({
      id: f.id,
      accountNumber: f.accountNumber,
      status: f.status,
      accountType: f.accountType,
      createdAt: f.createdAt,
      customerName: f.customerName,
      creatorUsername: f.creatorUsername,
      casaMonth: f.casaMonth,
      customerId: f.customerId,
      ownerId: f.ownerId,
      ownerName: f.ownerName,
      ownerActive: f.ownerActive ?? false,
      deductedMonth: f.deductedMonth,
    });
  }
  return out;
}

async function checkFile(conn: Conn, rows: VpaTargetFileRow[]): Promise<Checked> {
  const unqualifiedRows = rows.filter((r) => !isQualified(r));
  const casaRows: CasaFileRow[] = rows
    .filter(isCasaRow)
    .map(({ row, fullName, idNumber, accountNumber, staffCode }) => ({ row, fullName, idNumber, accountNumber, staffCode }));

  // Nối tiếp chứ không `Promise.all`: trong transaction, mọi câu đi chung một kết nối.
  const matches = await matchesOf(
    conn,
    [...new Set(unqualifiedRows.map((r) => normalizeIdNumber(r.idNumber)).filter(Boolean))],
  );
  const closedRows = await conn.select({ yearMonth: salaryClosings.yearMonth }).from(salaryClosings);
  const closed = new Set(closedRows.map((r) => r.yearMonth));
  const casaChecked = await checkCasaRows(conn, casaRows);

  const firstRowOf = new Map<string, number>();
  const counted: Counted[] = [];
  const owners = new Map<string, Match>();
  const casaRemoveIds: string[] = [];
  const unqualified = unqualifiedRows.map((r, index): UnqualifiedRow => {
    const idNumber = normalizeIdNumber(r.idNumber);
    const base: UnqualifiedRow = {
      row: r.row,
      fullName: r.fullName,
      idNumberTail: idNumber.slice(-4),
      staffCode: r.staffCode,
      ownerCode: "",
      accountNumber: "",
      points: null,
      note: "",
      casaRemovedMonth: null,
      errors: [],
    };

    if (!idNumber) return { ...base, errors: ["Thiếu CCCD"] };
    const firstRow = firstRowOf.get(idNumber);
    if (firstRow !== undefined) return { ...base, errors: [`CCCD trùng dòng ${firstRow}`] };
    firstRowOf.set(idNumber, r.row);

    const candidates = matches.get(idNumber);
    if (!candidates) return { ...base, note: "Không có hồ sơ khớp CCCD" };
    if (candidates.length === 0) return { ...base, note: "Hồ sơ không có tài khoản VPa" };

    const account = pickAccount(candidates, r.accountNumber);
    // TMDK không đạt thì không tính CASA (chủ dự án chốt 2026-11-15); tháng lương đã chốt thì giữ.
    const casaRemovedMonth = account.casaMonth && !closed.has(account.casaMonth) ? account.casaMonth : null;
    if (casaRemovedMonth) casaRemoveIds.push(account.id);
    const matched = {
      ...base,
      ownerCode: account.creatorUsername?.toUpperCase() ?? "",
      accountNumber: account.accountNumber ?? "",
      casaRemovedMonth,
    };

    if (account.deductedMonth) return { ...matched, note: `Đã trừ điểm lương tháng ${monthText(account.deductedMonth)}` };
    if (account.status !== "done")
      return { ...matched, note: `Tài khoản đang ở trạng thái ${BANK_ACCOUNT_STATUS_LABEL[account.status]}` };
    if (!account.ownerId) return { ...matched, note: "Hồ sơ không có người lập" };

    counted.push({ accountId: account.id, customerId: account.customerId, ownerId: account.ownerId, index });
    owners.set(account.ownerId, account);
    return matched;
  });

  const loss = await comboLossByAccount(conn, new Map(counted.map((c) => [c.customerId, c.accountId])));
  const totals = new Map<string, StaffTotal>();
  const countedWithPoints = counted.map((c) => {
    const combo = loss.get(c.accountId) ?? null;
    const points = combo?.points ?? 0;
    unqualified[c.index] = { ...unqualified[c.index], points };
    const owner = owners.get(c.ownerId)!;
    const total = totals.get(c.ownerId) ?? {
      userId: c.ownerId,
      staffCode: owner.creatorUsername?.toUpperCase() ?? "",
      fullName: owner.ownerName ?? "",
      accounts: 0,
      points: 0,
      active: owner.ownerActive,
    };
    totals.set(c.ownerId, { ...total, accounts: total.accounts + 1, points: roundPoints(total.points + points) });
    return { ...c, points, combo };
  });

  return {
    unqualified,
    casa: casaChecked.preview,
    staff: [...totals.values()].filter((s) => s.points > 0),
    counted: countedWithPoints,
    casaIds: casaChecked.accountIds,
    casaRemoveIds,
  };
}

const resultOf = (month: string, checked: Checked, written: VpaTargetImportResult["written"]): VpaTargetImportResult => ({
  reason: deductionReason(month),
  staff: checked.staff.map(({ userId, staffCode, fullName, accounts, points }) => ({
    userId,
    staffCode,
    fullName,
    accounts,
    points,
  })),
  unqualified: checked.unqualified,
  casa: checked.casa,
  written,
});

const NOTHING_WRITTEN = { staff: 0, accounts: 0, casa: 0, casaRemoved: 0 };

export type VpaTargetCommit = {
  result: VpaTargetImportResult;
  /** Để route ghi nhật ký và báo tin sau khi trả kết quả. */
  deductions: { adjustmentId: string; staff: StaffTotal }[];
};

/**
 * Nhập file chốt chỉ tiêu VPBank vào lương tháng `month`. `commit: false` chỉ
 * trả bảng kiểm. Một lượt ghi gồm: điểm trừ của từng người lập hồ sơ, đánh dấu
 * tài khoản đã trừ, bỏ CASA của tài khoản không đạt, thêm CASA mới. Có một dòng
 * lỗi thì không ghi gì, cùng luật với nhập file CASA.
 */
export async function importVpaTargetFile(
  actor: User,
  month: string,
  request: VpaTargetImportRequest,
): Promise<Outcome<VpaTargetCommit>> {
  if (await isMonthClosed(month)) return { ok: false, message: closedMonthMessage(month) };

  if (!request.commit) {
    const checked = await checkFile(db, request.rows);
    return { ok: true, result: { result: resultOf(month, checked, NOTHING_WRITTEN), deductions: [] } };
  }

  return db.transaction(async (tx): Promise<Outcome<VpaTargetCommit>> => {
    await lockSalaryMonth(tx, month);
    if (await isMonthClosed(month, tx)) return { ok: false, message: closedMonthMessage(month) };
    const checked = await checkFile(tx, request.rows);
    const errorRows =
      checked.unqualified.filter((r) => r.errors.length > 0).length +
      checked.casa.filter((r) => r.errors.length > 0).length;
    if (errorRows > 0) return { ok: false, message: `File có ${errorRows} dòng lỗi.` };
    if (checked.counted.length === 0 && checked.casaIds.length === 0 && checked.casaRemoveIds.length === 0)
      return { ok: false, message: "File không có tài khoản mới." };

    const reason = deductionReason(month);
    const deductions: VpaTargetCommit["deductions"] = [];
    if (checked.staff.length > 0) {
      const inserted = await tx
        .insert(kpiAdjustments)
        .values(
          checked.staff.map((s) => ({
            userId: s.userId,
            yearMonth: month,
            points: (-s.points).toFixed(2),
            reason,
            createdBy: actor.id,
          })),
        )
        .returning({ id: kpiAdjustments.id, userId: kpiAdjustments.userId });
      const staffOf = new Map(checked.staff.map((s) => [s.userId, s]));
      for (const row of inserted) deductions.push({ adjustmentId: row.id, staff: staffOf.get(row.userId)! });
    }

    // Người có tổng điểm mất bằng 0 không có dòng điểm trừ, tài khoản của họ không nối dòng nào.
    const adjustmentOf = new Map(deductions.map((d) => [d.staff.userId, d.adjustmentId]));
    if (checked.counted.length > 0)
      await tx.insert(vpaUnqualifiedAccounts).values(
        checked.counted.map((c) => ({
          bankAccountId: c.accountId,
          yearMonth: month,
          points: c.points.toFixed(2),
          adjustmentId: adjustmentOf.get(c.ownerId) ?? null,
          pointsBefore: c.combo?.before.toFixed(2) ?? null,
          pointsAfter: c.combo?.after.toFixed(2) ?? null,
          banksBefore: c.combo?.banksBefore ?? null,
          banksAfter: c.combo?.banksAfter ?? null,
          createdBy: actor.id,
        })),
      );

    if (checked.casaRemoveIds.length > 0)
      await tx.delete(casaAccounts).where(inArray(casaAccounts.bankAccountId, checked.casaRemoveIds));

    if (checked.casaIds.length > 0)
      await tx
        .insert(casaAccounts)
        .values(checked.casaIds.map((bankAccountId) => ({ bankAccountId, yearMonth: month, createdBy: actor.id })));

    return {
      ok: true,
      result: {
        result: resultOf(month, checked, {
          staff: deductions.length,
          accounts: checked.counted.length,
          casa: checked.casaIds.length,
          casaRemoved: checked.casaRemoveIds.length,
        }),
        deductions,
      },
    };
  });
}

/**
 * Nhật ký và thông báo sau khi ghi, cùng nhãn và cùng câu với
 * `scripts/db-kpi-deduction.ts`. Người đã nghỉ vẫn bị trừ, không nhận tin.
 */
export async function afterVpaTargetCommit(actor: User, month: string, commit: VpaTargetCommit): Promise<void> {
  const { result, deductions } = commit;
  for (const { adjustmentId, staff } of deductions)
    await logAudit(actor, {
      module: "system",
      action: "adjust-kpi",
      targetLabel: `Trừ ${formatPoints(staff.points)} điểm KPI tháng ${month} cho ${staff.fullName}`,
      targetTable: "kpi_adjustments",
      targetId: adjustmentId,
    });
  await logAudit(actor, {
    module: "system",
    action: "update",
    targetLabel:
      `Nhập file chốt chỉ tiêu VPa lương tháng ${month}: trừ điểm ${result.written.staff} người, ` +
      `${result.written.accounts} tài khoản không đạt; thêm ${result.written.casa} tài khoản CASA, ` +
      `bỏ ${result.written.casaRemoved} tài khoản CASA`,
    targetTable: "vpa_unqualified_accounts",
  });

  const salaryMonth = monthText(month);
  for (const { staff } of deductions.filter((d) => d.staff.active))
    await notify(staff.userId, "announcement", {
      title: `Đã tính lại điểm KPI tháng ${salaryMonth}`,
      body: `Điểm KPI tháng ${salaryMonth} của bạn bị trừ ${formatPoints(staff.points)} điểm cho ${staff.accounts} tài khoản. Lý do: ${result.reason}.`,
      url: `/users/${staff.userId}?month=${month}`,
    }).catch(() => undefined);
}

/**
 * Tài khoản nằm trong một dòng điểm trừ của file chốt chỉ tiêu VPa. `null` khi
 * dòng không thuộc người đó, hoặc người xem không thấy hồ sơ người đó trong tháng
 * của dòng. Nơi gọi đã hỏi `staff:view-detail` khi xem hồ sơ người khác.
 */
export async function deductedAccountsFor(
  actor: User,
  staffId: string,
  adjustmentId: string,
): Promise<VpaDeductedAccount[] | null> {
  const [adjustment] = await db
    .select({ yearMonth: kpiAdjustments.yearMonth })
    .from(kpiAdjustments)
    .where(and(eq(kpiAdjustments.id, adjustmentId), eq(kpiAdjustments.userId, staffId)))
    .limit(1);
  if (!adjustment) return null;
  if (staffId !== actor.id && !(await visibleStaffId(actor, staffId, monthRange(adjustment.yearMonth)))) return null;

  const rows = await db
    .select({
      bankAccountId: vpaUnqualifiedAccounts.bankAccountId,
      customerId: customers.id,
      customerName: customers.fullName,
      accountNumber: bankAccounts.accountNumber,
      points: vpaUnqualifiedAccounts.points,
      pointsBefore: vpaUnqualifiedAccounts.pointsBefore,
      pointsAfter: vpaUnqualifiedAccounts.pointsAfter,
      banksBefore: vpaUnqualifiedAccounts.banksBefore,
      banksAfter: vpaUnqualifiedAccounts.banksAfter,
    })
    .from(vpaUnqualifiedAccounts)
    .innerJoin(bankAccounts, eq(bankAccounts.id, vpaUnqualifiedAccounts.bankAccountId))
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .where(eq(vpaUnqualifiedAccounts.adjustmentId, adjustmentId))
    .orderBy(desc(vpaUnqualifiedAccounts.points), asc(customers.fullName));

  const numberOrNull = (value: string | null) => (value === null ? null : Number(value));
  return rows.map((r) => ({
    ...r,
    accountNumber: r.accountNumber ?? "",
    points: Number(r.points),
    pointsBefore: numberOrNull(r.pointsBefore),
    pointsAfter: numberOrNull(r.pointsAfter),
  }));
}
