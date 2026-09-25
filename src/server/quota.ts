import { and, asc, desc, eq, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { monthRange } from "@/lib/format";
import type { QuotaKindItem, QuotaMonth, QuotaMonthForm } from "@/lib/api/quota";
import { customerDayBetween } from "./customerDay";
import { db } from "./db/client";
import {
  bankAccounts,
  customers,
  departmentQuotas,
  departments,
  quotaAccountKinds,
  quotaMonths,
  referralCodes,
  salaryClosings,
} from "./db/schema";

async function isClosed(yearMonth: string): Promise<boolean> {
  const [row] = await db
    .select({ yearMonth: salaryClosings.yearMonth })
    .from(salaryClosings)
    .where(eq(salaryClosings.yearMonth, yearMonth))
    .limit(1);
  return Boolean(row);
}

/** Tháng gần nhất đã lưu chỉ tiêu, không sau `yearMonth`. */
async function latestSavedMonth(yearMonth: string): Promise<string | null> {
  const [row] = await db
    .select({ yearMonth: quotaMonths.yearMonth })
    .from(quotaMonths)
    .where(lte(quotaMonths.yearMonth, yearMonth))
    .orderBy(desc(quotaMonths.yearMonth))
    .limit(1);
  return row?.yearMonth ?? null;
}

async function readMonth(yearMonth: string) {
  const [month] = await db.select().from(quotaMonths).where(eq(quotaMonths.yearMonth, yearMonth));
  if (!month) return null;
  const [departmentRows, kindRows] = await Promise.all([
    db.select().from(departmentQuotas).where(eq(departmentQuotas.yearMonth, yearMonth)),
    db.select().from(quotaAccountKinds).where(eq(quotaAccountKinds.yearMonth, yearMonth)),
  ]);
  return { month, departmentRows, kindRows };
}

/**
 * Cấu hình màn Chỉ tiêu tháng. Tháng chưa lưu lần nào thì trả bản của tháng gần
 * nhất trước đó kèm `copiedFrom`, đúng bản lương đang dùng (`quotaConfigOf`).
 */
export async function getQuotaMonth(yearMonth: string): Promise<QuotaMonth> {
  const source = await latestSavedMonth(yearMonth);
  const data = source ? await readMonth(source) : null;

  const salesDepartments = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(eq(departments.type, "sales"))
    .orderBy(asc(departments.name));
  const byDepartment = new Map(data?.departmentRows.map((row) => [row.departmentId, row]));
  const kindsOf = (kind: "hkd" | "directed"): QuotaKindItem[] =>
    (data?.kindRows ?? [])
      .filter((row) => row.kind === kind)
      .map((row) => ({ bankId: row.bankId, accountType: row.accountType }));

  return {
    month: yearMonth,
    copiedFrom: data && source !== yearMonth ? source : null,
    locked: await isClosed(yearMonth),
    staffHkd: data?.month.staffHkd ?? null,
    staffDirected: data?.month.staffDirected ?? null,
    staffCasa: data?.month.staffCasa ?? null,
    departments: salesDepartments.map((d) => ({
      departmentId: d.id,
      departmentName: d.name,
      hkd: byDepartment.get(d.id)?.hkd ?? null,
      directed: byDepartment.get(d.id)?.directed ?? null,
      casa: byDepartment.get(d.id)?.casa ?? null,
    })),
    hkdKinds: kindsOf("hkd"),
    directedKinds: kindsOf("directed"),
  };
}

/** `null` khi lương tháng đó đã chốt: số đã trả thì chỉ tiêu cũng đứng yên. */
export async function saveQuotaMonth(
  yearMonth: string,
  form: QuotaMonthForm,
  actorId: string,
): Promise<QuotaMonth | null> {
  if (await isClosed(yearMonth)) return null;

  const departmentRows = form.departments
    .filter((d) => d.hkd !== null || d.directed !== null || d.casa !== null)
    .map((d) => ({ yearMonth, departmentId: d.departmentId, hkd: d.hkd, directed: d.directed, casa: d.casa }));
  const kindRows = [
    ...form.hkdKinds.map((k) => ({ yearMonth, kind: "hkd" as const, ...k })),
    ...form.directedKinds.map((k) => ({ yearMonth, kind: "directed" as const, ...k })),
  ];

  await db.transaction(async (tx) => {
    const values = {
      staffHkd: form.staffHkd,
      staffDirected: form.staffDirected,
      staffCasa: form.staffCasa,
      updatedBy: actorId,
      updatedAt: new Date(),
    };
    await tx
      .insert(quotaMonths)
      .values({ yearMonth, ...values })
      .onConflictDoUpdate({ target: quotaMonths.yearMonth, set: values });
    await tx.delete(departmentQuotas).where(eq(departmentQuotas.yearMonth, yearMonth));
    await tx.delete(quotaAccountKinds).where(eq(quotaAccountKinds.yearMonth, yearMonth));
    if (departmentRows.length > 0) await tx.insert(departmentQuotas).values(departmentRows);
    if (kindRows.length > 0)
      await tx.insert(quotaAccountKinds).values(kindRows).onConflictDoNothing();
  });

  return getQuotaMonth(yearMonth);
}

/* ── Phần lương đọc ─────────────────────────────────────────────────────── */

export type QuotaTargets = { hkd: number | null; directed: number | null; casa: number | null };

export type QuotaConfig = {
  staffDirected: number | null;
  departments: Map<string, QuotaTargets>;
  hkdKinds: QuotaKindItem[];
  directedKinds: QuotaKindItem[];
};

/**
 * Tháng chưa lưu chỉ tiêu thì dùng tháng gần nhất đã lưu trước đó (chốt
 * 2026-09-25): tháng 10 chưa lưu thì lấy tháng 9. Chưa có tháng nào thì không chấm.
 */
export async function quotaConfigOf(yearMonth: string): Promise<QuotaConfig | null> {
  const source = await latestSavedMonth(yearMonth);
  const data = source ? await readMonth(source) : null;
  if (!data) return null;
  return {
    staffDirected: data.month.staffDirected,
    departments: new Map(
      data.departmentRows.map((row) => [
        row.departmentId,
        { hkd: row.hkd, directed: row.directed, casa: row.casa },
      ]),
    ),
    hkdKinds: data.kindRows
      .filter((row) => row.kind === "hkd")
      .map((row) => ({ bankId: row.bankId, accountType: row.accountType })),
    directedKinds: data.kindRows
      .filter((row) => row.kind === "directed")
      .map((row) => ({ bankId: row.bankId, accountType: row.accountType })),
  };
}

/**
 * Loại đã chụp trên tài khoản; dữ liệu cũ mang `none` thì đọc loại của mã giới
 * thiệu, cùng luật với `accountTypeOf` ở `banking.ts`.
 */
const effectiveType = sql`case when ${bankAccounts.accountType} = 'none'
  then ${referralCodes.accountType} else ${bankAccounts.accountType} end`;

const kindWhere = (kinds: QuotaKindItem[]): SQL =>
  or(
    ...kinds.map(
      (k) => and(eq(bankAccounts.bankId, k.bankId), sql`${effectiveType} = ${k.accountType}`)!,
    ),
  )!;

/**
 * Đếm tài khoản hoàn thành thuộc `kinds` trong tháng, theo NGÀY HỒ SƠ khách như
 * KPI (chốt 2026-09-25). `by` chọn trục đếm:
 * - `creator`: người lập hồ sơ khách, cùng người được tính điểm KPI.
 * - `department`: phòng ghi nhận của tài khoản; chuyển phòng thì cột này đi theo người.
 */
export async function countQuotaAccounts(
  yearMonth: string,
  kinds: QuotaKindItem[],
  by: "creator" | "department",
  ids: string[],
): Promise<Map<string, number>> {
  if (kinds.length === 0 || ids.length === 0) return new Map();
  const { from, to } = monthRange(yearMonth);
  const key = by === "creator" ? customers.createdBy : bankAccounts.createdByDepartmentId;
  const rows = await db
    .select({ id: key, count: sql<number>`count(*)::int` })
    .from(bankAccounts)
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .innerJoin(referralCodes, eq(referralCodes.id, bankAccounts.referralCodeId))
    .where(
      and(
        eq(bankAccounts.status, "done"),
        customerDayBetween(from, to),
        kindWhere(kinds),
        inArray(key, ids),
      ),
    )
    .groupBy(key);
  return new Map(rows.filter((row) => row.id).map((row) => [row.id!, row.count]));
}
