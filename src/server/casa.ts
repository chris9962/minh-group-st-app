import { and, eq, inArray, sql } from "drizzle-orm";
import { BANK_ACCOUNT_STATUS_LABEL } from "@/lib/api/bankAccounts";
import type { CasaFileRow, CasaImportRequest, CasaImportResult, CasaMonth, CasaPreviewRow } from "@/lib/api/casa";
import { removeDiacritics } from "@/lib/format";
import type { User } from "@/lib/types";
import { closedMonthMessage, isMonthClosed, lockSalaryMonth } from "./closedMonths";
import { db } from "./db/client";
import { bankAccounts, banks, casaAccounts, customers, users } from "./db/schema";

type Conn = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Outcome<T> = { ok: true; result: T } | { ok: false; message: string };

/** File CASA hiện chỉ có của VPBank, ghi nhận vào dòng VPa của app. */
const CASA_BANK_CODE = "VPa";

const monthLabel = (month: string) => `${month.slice(5)}/${month.slice(0, 4)}`;

/** CCCD luôn bắt đầu bằng 0 (mã tỉnh 001–096), mà ô số trong Excel bỏ mất số 0 đó. */
const normalizeIdNumber = (raw: string) => {
  const v = raw.replace(/\s/g, "");
  return /^\d{11}$/.test(v) ? `0${v}` : v;
};

/** STK của VPa là SĐT; ô số trong Excel bỏ mất số 0 đầu, nên so sau khi bỏ số 0 đầu. */
const accountKey = (raw: string) => raw.replace(/\D/g, "").replace(/^0+/, "");

const nameKey = (raw: string) => removeDiacritics(raw).toUpperCase().replace(/\s+/g, " ").trim();

type Candidate = {
  id: string;
  accountNumber: string | null;
  status: keyof typeof BANK_ACCOUNT_STATUS_LABEL;
  accountType: string;
  createdAt: Date;
  customerName: string;
  creatorUsername: string | null;
  casaMonth: string | null;
};

/**
 * Khách có 2 tài khoản VPa (thường và HKD) thì chọn tài khoản trùng STK, rồi
 * tài khoản không phải HKD. Luật này còn chờ chốt (sổ việc chờ làm 2026-11-09).
 */
function pickAccount(candidates: Candidate[], fileAccount: string): Candidate {
  const key = accountKey(fileAccount);
  const sameNumber = (c: Candidate) => key !== "" && accountKey(c.accountNumber ?? "") === key;
  return [...candidates].sort(
    (a, b) =>
      Number(sameNumber(b)) - Number(sameNumber(a)) ||
      Number(a.accountType === "HKD") - Number(b.accountType === "HKD") ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  )[0];
}

async function checkRows(
  conn: Conn,
  month: string,
  rows: CasaFileRow[],
): Promise<{ preview: CasaPreviewRow[]; accountIds: string[] }> {
  const idNumbers = [...new Set(rows.map((r) => normalizeIdNumber(r.idNumber)).filter(Boolean))];
  const found = idNumbers.length
    ? await conn
        .select({
          idNumber: customers.idNumber,
          id: bankAccounts.id,
          accountNumber: bankAccounts.accountNumber,
          status: bankAccounts.status,
          accountType: bankAccounts.accountType,
          createdAt: bankAccounts.createdAt,
          customerName: customers.fullName,
          creatorUsername: users.username,
          casaMonth: casaAccounts.yearMonth,
        })
        .from(customers)
        .leftJoin(
          bankAccounts,
          and(
            eq(bankAccounts.customerId, customers.id),
            eq(
              bankAccounts.bankId,
              sql`(select ${banks.id} from ${banks} where ${banks.code} = ${CASA_BANK_CODE})`,
            ),
          ),
        )
        .leftJoin(users, eq(users.id, customers.createdBy))
        .leftJoin(casaAccounts, eq(casaAccounts.bankAccountId, bankAccounts.id))
        .where(inArray(customers.idNumber, idNumbers))
    : [];

  const profiles = new Set(found.map((f) => f.idNumber));
  const candidatesOf = new Map<string, Candidate[]>();
  for (const f of found) {
    if (!f.id || !f.idNumber || !f.status || !f.accountType || !f.createdAt) continue;
    const list = candidatesOf.get(f.idNumber) ?? [];
    list.push({
      id: f.id,
      accountNumber: f.accountNumber,
      status: f.status,
      accountType: f.accountType,
      createdAt: f.createdAt,
      customerName: f.customerName,
      creatorUsername: f.creatorUsername,
      casaMonth: f.casaMonth,
    });
    candidatesOf.set(f.idNumber, list);
  }

  const firstRowOf = new Map<string, number>();
  const accountIds: string[] = [];
  const preview = rows.map((r): CasaPreviewRow => {
    const idNumber = normalizeIdNumber(r.idNumber);
    const errors: string[] = [];
    const differences: string[] = [];
    const base = {
      row: r.row,
      fullName: r.fullName,
      idNumberTail: idNumber.slice(-4),
      staffCode: r.staffCode,
    };

    if (!idNumber) return { ...base, accountNumber: "", errors: ["Thiếu CCCD"], differences };
    const firstRow = firstRowOf.get(idNumber);
    if (firstRow !== undefined)
      return { ...base, accountNumber: "", errors: [`CCCD trùng dòng ${firstRow}`], differences };
    firstRowOf.set(idNumber, r.row);

    if (!profiles.has(idNumber))
      return { ...base, accountNumber: "", errors: ["Không có hồ sơ khớp CCCD"], differences };
    const candidates = candidatesOf.get(idNumber);
    if (!candidates)
      return { ...base, accountNumber: "", errors: ["Hồ sơ không có tài khoản VPa"], differences };

    const account = pickAccount(candidates, r.accountNumber);
    if (account.casaMonth && account.casaMonth !== month)
      errors.push(`Tài khoản đã tính CASA lương tháng ${monthLabel(account.casaMonth)}`);

    const appNumber = account.accountNumber ?? "";
    if (r.accountNumber && accountKey(r.accountNumber) !== accountKey(appNumber))
      differences.push(`STK file ${r.accountNumber}, app ${appNumber || "trống"}`);
    if (account.status !== "done")
      differences.push(`Tài khoản đang ở trạng thái ${BANK_ACCOUNT_STATUS_LABEL[account.status]}`);
    if (r.staffCode && r.staffCode.toLowerCase() !== (account.creatorUsername ?? "").toLowerCase())
      differences.push(`Người lập hồ sơ ${account.creatorUsername?.toUpperCase() ?? "trống"}`);
    if (r.fullName && nameKey(r.fullName) !== nameKey(account.customerName))
      differences.push(`Tên trong app ${account.customerName}`);

    if (errors.length === 0) accountIds.push(account.id);
    return { ...base, accountNumber: appNumber, errors, differences };
  });

  return { preview, accountIds };
}

const countOfMonth = async (conn: Conn, month: string) => {
  const [row] = await conn
    .select({ count: sql<number>`count(*)::int` })
    .from(casaAccounts)
    .where(eq(casaAccounts.yearMonth, month));
  return row?.count ?? 0;
};

export async function getCasaMonth(month: string): Promise<CasaMonth> {
  const [count, locked] = await Promise.all([countOfMonth(db, month), isMonthClosed(month)]);
  return { month, count, locked };
}

/**
 * Nhập file CASA cho lương tháng `month`. `commit: false` chỉ trả bảng kiểm.
 * Ghi thay toàn bộ tài khoản đã nhập của tháng đó, để nhập lại file đã sửa
 * không cộng dồn. Có một dòng lỗi thì không ghi.
 */
export async function importCasaFile(
  actor: User,
  month: string,
  request: CasaImportRequest,
): Promise<Outcome<CasaImportResult>> {
  if (await isMonthClosed(month)) return { ok: false, message: closedMonthMessage(month) };

  if (!request.commit) {
    const [{ preview }, replaced] = await Promise.all([
      checkRows(db, month, request.rows),
      countOfMonth(db, month),
    ]);
    return { ok: true, result: { rows: preview, written: 0, replaced } };
  }

  return db.transaction(async (tx): Promise<Outcome<CasaImportResult>> => {
    await lockSalaryMonth(tx, month);
    if (await isMonthClosed(month, tx)) return { ok: false, message: closedMonthMessage(month) };
    const { preview, accountIds } = await checkRows(tx, month, request.rows);
    const errorRows = preview.filter((r) => r.errors.length > 0).length;
    if (errorRows > 0) return { ok: false, message: `File có ${errorRows} dòng lỗi.` };

    const replaced = await countOfMonth(tx, month);
    await tx.delete(casaAccounts).where(eq(casaAccounts.yearMonth, month));
    await tx
      .insert(casaAccounts)
      .values(accountIds.map((bankAccountId) => ({ bankAccountId, yearMonth: month, createdBy: actor.id })));
    return { ok: true, result: { rows: preview, written: accountIds.length, replaced } };
  });
}

/**
 * Đếm tài khoản đạt CASA tính vào lương tháng `yearMonth`. `by` chọn trục đếm,
 * cùng hai trục của `countQuotaAccounts`:
 * - `creator`: người lập hồ sơ khách.
 * - `department`: phòng ghi nhận của tài khoản.
 */
export async function countCasaAccounts(
  yearMonth: string,
  by: "creator" | "department",
  ids: string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const key = by === "creator" ? customers.createdBy : bankAccounts.createdByDepartmentId;
  const rows = await db
    .select({ id: key, count: sql<number>`count(*)::int` })
    .from(casaAccounts)
    .innerJoin(bankAccounts, eq(bankAccounts.id, casaAccounts.bankAccountId))
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .where(and(eq(casaAccounts.yearMonth, yearMonth), inArray(key, ids)))
    .groupBy(key);
  return new Map(rows.filter((row) => row.id).map((row) => [row.id!, row.count]));
}
