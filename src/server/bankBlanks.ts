import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type {
  BankDepartmentBlanks,
  BankDepartmentBlanksForm,
  BankStaffBlankCell,
  BankStaffBlanks,
  BankStaffBlanksForm,
} from "@/lib/api/bankBlanks";
import type { BlankType, DepartmentBlankCell } from "@/lib/api/insuranceBlanks";
import { BUSINESS_TIMEZONE, businessMonth } from "@/lib/format";
import { shiftMonth } from "@/lib/period";
import { recordVisibility } from "@/lib/permissions";
import { ROLE_RANK, type RoleKey, type User } from "@/lib/types";
import { db } from "./db/client";
import {
  bankAccounts,
  bankBlankDepartmentQuotas,
  bankBlankStaffQuotas,
  banks,
  customers,
  departments,
  staffRoster,
  users,
} from "./db/schema";
import { blankMonthEditable } from "./insuranceBlanks";

/**
 * Phiếu thông tin ngân hàng theo tháng (chốt 2026-10-31). Cùng luật phôi bảo
 * hiểm ở `insuranceBlanks.ts`, khác hai chỗ: loại phiếu là ngân hàng, và số đã
 * sử dụng mặc định là số tài khoản người đó mở (Hoàn thành, Lỗi, Đã sửa lỗi)
 * theo tháng của ngày hồ sơ khách. Không lưu số tồn: mọi số tính lại mỗi lần đọc.
 */

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type Outcome = { ok: true } | { ok: false; message: string };

const NOT_EDITABLE = "Chỉ sửa được tháng trước, tháng hiện tại và tháng sau.";
const OPENED_STATUSES = ["done", "error", "fixed"] as const;

const monthText = (month: string) => `${month.slice(5)}/${month.slice(0, 4)}`;

const activeBanks = (): Promise<BlankType[]> =>
  db
    .select({ id: banks.id, code: banks.code, name: banks.code })
    .from(banks)
    .where(eq(banks.active, true))
    .orderBy(desc(banks.priority), asc(banks.code));

const salesDepartments = () =>
  db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(and(eq(departments.type, "sales"), eq(departments.active, true)))
    .orderBy(asc(departments.name));

/** Tháng đầu tiên có số liệu phiếu; tài khoản trước tháng này không trừ phiếu. */
async function firstBlankMonth(): Promise<string | null> {
  const result = await db.execute<{ month: string | null }>(sql`
    select min(year_month) as month from (
      select year_month from ${bankBlankDepartmentQuotas}
      union all
      select year_month from ${bankBlankStaffQuotas}
    ) months`);
  return result.rows[0]?.month ?? null;
}

/** Tài khoản đã mở gom theo người mở, ngân hàng và tháng của ngày hồ sơ khách. */
function openedAccounts(userIds: string[], fromMonth: string, toMonth: string) {
  const month = sql<string>`to_char(${customers.createdAt} at time zone ${BUSINESS_TIMEZONE}, 'YYYY-MM')`;
  return db
    .select({
      userId: bankAccounts.createdBy,
      bankId: bankAccounts.bankId,
      month,
      count: sql<number>`count(*)::int`,
    })
    .from(bankAccounts)
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .where(
      and(
        inArray(bankAccounts.createdBy, userIds),
        inArray(bankAccounts.status, [...OPENED_STATUSES]),
        sql`${customers.createdAt} >= ((${`${fromMonth}-01`}::date)::timestamp at time zone ${BUSINESS_TIMEZONE})`,
        sql`${customers.createdAt} < ((${`${shiftMonth(toMonth, 1)}-01`}::date)::timestamp at time zone ${BUSINESS_TIMEZONE})`,
      ),
    )
    .groupBy(sql`1, 2, 3`);
}

/* ── Sổ phiếu của phòng: cấp thêm và đã phát theo từng tháng ────────────── */

type Movement = { allocated: number; issued: number };
/** Khoá `phòng:ngân hàng` → tháng → số cấp thêm và số đã phát cho người. */
type Ledger = Map<string, Map<string, Movement>>;

async function departmentLedger(conn: Db, departmentIds: string[]): Promise<Ledger> {
  const ledger: Ledger = new Map();
  if (departmentIds.length === 0) return ledger;
  const [allocated, issued] = await Promise.all([
    conn
      .select({
        departmentId: bankBlankDepartmentQuotas.departmentId,
        bankId: bankBlankDepartmentQuotas.bankId,
        month: bankBlankDepartmentQuotas.yearMonth,
        quantity: bankBlankDepartmentQuotas.quantity,
      })
      .from(bankBlankDepartmentQuotas)
      .where(inArray(bankBlankDepartmentQuotas.departmentId, departmentIds)),
    conn
      .select({
        departmentId: bankBlankStaffQuotas.departmentId,
        bankId: bankBlankStaffQuotas.bankId,
        month: bankBlankStaffQuotas.yearMonth,
        quantity: sql<number>`sum(${bankBlankStaffQuotas.issued})::int`,
      })
      .from(bankBlankStaffQuotas)
      .where(inArray(bankBlankStaffQuotas.departmentId, departmentIds))
      .groupBy(bankBlankStaffQuotas.departmentId, bankBlankStaffQuotas.bankId, bankBlankStaffQuotas.yearMonth),
  ]);
  const add = (row: { departmentId: string; bankId: string; month: string; quantity: number }, field: keyof Movement) => {
    const key = `${row.departmentId}:${row.bankId}`;
    const months = ledger.get(key) ?? new Map<string, Movement>();
    const movement = months.get(row.month) ?? { allocated: 0, issued: 0 };
    movement[field] += row.quantity;
    months.set(row.month, movement);
    ledger.set(key, months);
  };
  for (const row of allocated) add(row, "allocated");
  for (const row of issued) add(row, "issued");
  return ledger;
}

function departmentCell(ledger: Ledger, departmentId: string, bankId: string, month: string): DepartmentBlankCell {
  let openingUnallocated = 0;
  let current: Movement = { allocated: 0, issued: 0 };
  for (const [m, movement] of ledger.get(`${departmentId}:${bankId}`) ?? []) {
    if (m < month) openingUnallocated += movement.allocated - movement.issued;
    else if (m === month) current = movement;
  }
  return { blankTypeId: bankId, openingUnallocated, ...current };
}

/** Tháng đầu tiên từ `fromMonth` mà phiếu chưa chia của phòng bị âm. Cùng luật `insuranceBlanks.ts`. */
async function shortfallMessage(conn: Db, departmentIds: string[], fromMonth: string): Promise<string | null> {
  const ledger = await departmentLedger(conn, departmentIds);
  for (const [key, months] of ledger) {
    let running = 0;
    for (const [month, movement] of [...months].sort(([a], [b]) => a.localeCompare(b))) {
      running += movement.allocated - movement.issued;
      if (month < fromMonth || running >= 0) continue;
      const [departmentId, bankId] = key.split(":");
      const [names] = await conn
        .select({ department: departments.name, bank: banks.code })
        .from(departments)
        .innerJoin(banks, eq(banks.id, bankId))
        .where(eq(departments.id, departmentId));
      return `${names?.department ?? "Phòng"}, phiếu ${names?.bank ?? "ngân hàng"}: tháng ${monthText(month)} đã phát cho nhân viên nhiều hơn số phòng được cấp ${-running} phiếu.`;
    }
  }
  return null;
}

class Refused extends Error {}

async function lockDepartments(conn: Db, departmentIds: string[]) {
  if (departmentIds.length === 0) return;
  await conn
    .select({ id: departments.id })
    .from(departments)
    .where(inArray(departments.id, departmentIds))
    .orderBy(asc(departments.id))
    .for("no key update");
}

/* ── Màn Cấp phiếu cho phòng ───────────────────────────────────────────── */

export async function bankDepartmentBlanks(month: string): Promise<BankDepartmentBlanks> {
  const [types, depts] = await Promise.all([activeBanks(), salesDepartments()]);
  const ledger = await departmentLedger(
    db,
    depts.map((d) => d.id),
  );
  return {
    month,
    editable: blankMonthEditable(month),
    types,
    rows: depts.map((d) => ({
      departmentId: d.id,
      departmentName: d.name,
      cells: types.map((t) => departmentCell(ledger, d.id, t.id, month)),
    })),
  };
}

export async function saveBankDepartmentBlanks(
  actor: User,
  month: string,
  form: BankDepartmentBlanksForm,
): Promise<Outcome> {
  if (!blankMonthEditable(month)) return { ok: false, message: NOT_EDITABLE };
  const [types, depts] = await Promise.all([activeBanks(), salesDepartments()]);
  const bankIds = new Set(types.map((t) => t.id));
  const deptIds = new Set(depts.map((d) => d.id));
  if (form.rows.some((r) => !bankIds.has(r.blankTypeId) || !deptIds.has(r.departmentId)))
    return { ok: false, message: "Phòng hoặc ngân hàng không hợp lệ" };

  const touched = [...new Set(form.rows.map((r) => r.departmentId))];
  try {
    await db.transaction(async (tx) => {
      await lockDepartments(tx, touched);
      const existing = await tx
        .select()
        .from(bankBlankDepartmentQuotas)
        .where(eq(bankBlankDepartmentQuotas.yearMonth, month));
      const before = new Map(existing.map((r) => [`${r.departmentId}:${r.bankId}`, r.quantity]));

      for (const r of form.rows) {
        const key = and(
          eq(bankBlankDepartmentQuotas.yearMonth, month),
          eq(bankBlankDepartmentQuotas.departmentId, r.departmentId),
          eq(bankBlankDepartmentQuotas.bankId, r.blankTypeId),
        );
        const old = before.get(`${r.departmentId}:${r.blankTypeId}`) ?? 0;
        if (r.quantity === old) continue;
        if (r.quantity === 0) await tx.delete(bankBlankDepartmentQuotas).where(key);
        else
          await tx
            .insert(bankBlankDepartmentQuotas)
            .values({ yearMonth: month, departmentId: r.departmentId, bankId: r.blankTypeId, quantity: r.quantity, updatedBy: actor.id })
            .onConflictDoUpdate({
              target: [bankBlankDepartmentQuotas.yearMonth, bankBlankDepartmentQuotas.departmentId, bankBlankDepartmentQuotas.bankId],
              set: { quantity: r.quantity, updatedBy: actor.id, updatedAt: new Date() },
            });
      }

      const shortfall = await shortfallMessage(tx, touched, month);
      if (shortfall) throw new Refused(shortfall);
    });
  } catch (e) {
    if (e instanceof Refused) return { ok: false, message: e.message };
    throw e;
  }
  return { ok: true };
}

/* ── Màn Phát phiếu cho nhân viên ──────────────────────────────────────── */

/** Phòng người này nhập phiếu được. Phạm vi `own` hiểu là phòng của chính họ. */
async function splitDepartments(actor: User): Promise<{ id: string; name: string }[]> {
  const visibility = recordVisibility(actor, "banking", "split-blanks");
  if (visibility.kind === "none") return [];
  if (visibility.kind === "all") return salesDepartments();
  const ids = visibility.kind === "departments" ? visibility.departmentIds : actor.departmentId ? [actor.departmentId] : [];
  if (ids.length === 0) return [];
  return db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(and(inArray(departments.id, ids), eq(departments.active, true)))
    .orderBy(asc(departments.name));
}

type Member = { userId: string; fullName: string; role: RoleKey };

/** Người của phòng trong tháng theo `staff_roster`, cộng người đã có dòng phiếu của phòng trong tháng đó. */
async function membersOf(departmentId: string, month: string): Promise<Member[]> {
  const rosterMonth = month > businessMonth() ? businessMonth() : month;
  const [roster, extra] = await Promise.all([
    db
      .select({ userId: staffRoster.userId, fullName: users.fullName, role: staffRoster.role })
      .from(staffRoster)
      .innerJoin(users, eq(users.id, staffRoster.userId))
      .where(
        and(eq(staffRoster.departmentId, departmentId), eq(staffRoster.yearMonth, rosterMonth), eq(staffRoster.active, true)),
      ),
    db
      .selectDistinct({ userId: users.id, fullName: users.fullName, role: users.role })
      .from(bankBlankStaffQuotas)
      .innerJoin(users, eq(users.id, bankBlankStaffQuotas.userId))
      .where(and(eq(bankBlankStaffQuotas.departmentId, departmentId), eq(bankBlankStaffQuotas.yearMonth, month))),
  ]);
  const byId = new Map<string, Member>();
  for (const m of [...roster, ...extra]) if (!byId.has(m.userId)) byId.set(m.userId, m);
  return [...byId.values()].sort(
    (a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.fullName.localeCompare(b.fullName, "vi"),
  );
}

export type BankStaffBlanksResult = { ok: true; data: BankStaffBlanks } | { ok: false; status: 403 | 404; message: string };

export async function bankStaffBlanks(actor: User, month: string, requested: string): Promise<BankStaffBlanksResult> {
  const allowed = await splitDepartments(actor);
  if (allowed.length === 0) return { ok: false, status: 403, message: "Bạn chưa được giao phòng nào để chia phiếu." };
  const departmentId =
    requested || (allowed.some((d) => d.id === actor.departmentId) ? actor.departmentId! : allowed[0].id);
  if (!allowed.some((d) => d.id === departmentId))
    return { ok: false, status: 404, message: "Không tìm thấy phòng này trong phạm vi của bạn." };

  const [allBanks, members, first] = await Promise.all([activeBanks(), membersOf(departmentId, month), firstBlankMonth()]);
  const start = first && first < month ? first : month;
  const memberIds = members.map((m) => m.userId);

  const [ledger, rows, accounts] = await Promise.all([
    departmentLedger(db, [departmentId]),
    memberIds.length > 0
      ? db
          .select()
          .from(bankBlankStaffQuotas)
          .where(and(inArray(bankBlankStaffQuotas.userId, memberIds), lte(bankBlankStaffQuotas.yearMonth, month)))
      : [],
    memberIds.length > 0 ? openedAccounts(memberIds, start, month) : [],
  ]);

  const months: string[] = [];
  for (let m = start; m < month; m = shiftMonth(m, 1)) months.push(m);
  const rowOf = (userId: string, bankId: string, m: string) =>
    rows.find((r) => r.userId === userId && r.bankId === bankId && r.yearMonth === m);
  const usedByAccounts = (userId: string, bankId: string, m: string) =>
    accounts.filter((a) => a.userId === userId && a.bankId === bankId && a.month === m).reduce((s, a) => s + a.count, 0);

  const cellOf = (userId: string, bankId: string): BankStaffBlankCell => {
    let opening = 0;
    for (const m of months) {
      const row = rowOf(userId, bankId, m);
      opening += (row?.issued ?? 0) - (row?.used ?? usedByAccounts(userId, bankId, m));
    }
    const row = rowOf(userId, bankId, month);
    return {
      blankTypeId: bankId,
      opening,
      issued: row?.issued ?? 0,
      used: row?.used ?? null,
      usedAccounts: usedByAccounts(userId, bankId, month),
    };
  };

  const departmentCells = allBanks.map((b) => departmentCell(ledger, departmentId, b.id, month));
  const staffRows = members.map((m) => ({ ...m, cells: allBanks.map((b) => cellOf(m.userId, b.id)) }));
  // Ngân hàng phòng chưa từng có phiếu thì không hiện, để bảng gọn (chốt 2026-10-31).
  const shown = allBanks.filter((b, i) => {
    const d = departmentCells[i];
    if (d.openingUnallocated !== 0 || d.allocated !== 0 || d.issued !== 0) return true;
    return staffRows.some((r) => r.cells[i].opening !== 0 || r.cells[i].issued !== 0);
  });
  const shownIds = new Set(shown.map((b) => b.id));

  return {
    ok: true,
    data: {
      month,
      editable: blankMonthEditable(month),
      departmentId,
      departments: allowed,
      types: shown,
      departmentCells: departmentCells.filter((c) => shownIds.has(c.blankTypeId)),
      rows: staffRows.map((r) => ({ ...r, cells: r.cells.filter((c) => shownIds.has(c.blankTypeId)) })),
    },
  };
}

export async function saveBankStaffBlanks(
  actor: User,
  month: string,
  departmentId: string,
  form: BankStaffBlanksForm,
): Promise<Outcome> {
  if (!blankMonthEditable(month)) return { ok: false, message: NOT_EDITABLE };
  const allowed = await splitDepartments(actor);
  if (!allowed.some((d) => d.id === departmentId))
    return { ok: false, message: "Không tìm thấy phòng này trong phạm vi của bạn." };

  const [types, members] = await Promise.all([activeBanks(), membersOf(departmentId, month)]);
  const bankIds = new Set(types.map((t) => t.id));
  const memberIds = new Set(members.map((m) => m.userId));
  if (form.rows.some((r) => !bankIds.has(r.blankTypeId) || !memberIds.has(r.userId)))
    return { ok: false, message: "Người hoặc ngân hàng không thuộc phòng này trong tháng đang chọn." };

  const userIds = [...new Set(form.rows.map((r) => r.userId))];
  try {
    await db.transaction(async (tx) => {
      await lockDepartments(tx, [departmentId]);
      const existing =
        userIds.length > 0
          ? await tx
              .select()
              .from(bankBlankStaffQuotas)
              .where(and(eq(bankBlankStaffQuotas.yearMonth, month), inArray(bankBlankStaffQuotas.userId, userIds)))
          : [];
      const elsewhere = existing.find((r) => r.departmentId !== departmentId);
      if (elsewhere) {
        const name = members.find((m) => m.userId === elsewhere.userId)?.fullName ?? "Một người";
        throw new Refused(`${name} đã được phòng khác nhập phiếu trong tháng ${monthText(month)}.`);
      }

      for (const r of form.rows) {
        const old = existing.find((e) => e.userId === r.userId && e.bankId === r.blankTypeId);
        if (old && old.issued === r.issued && old.used === r.used) continue;
        if (!old && r.issued === 0 && r.used === null) continue;
        const key = and(
          eq(bankBlankStaffQuotas.yearMonth, month),
          eq(bankBlankStaffQuotas.userId, r.userId),
          eq(bankBlankStaffQuotas.bankId, r.blankTypeId),
        );
        if (r.issued === 0 && r.used === null) await tx.delete(bankBlankStaffQuotas).where(key);
        else
          await tx
            .insert(bankBlankStaffQuotas)
            .values({
              yearMonth: month,
              userId: r.userId,
              bankId: r.blankTypeId,
              departmentId,
              issued: r.issued,
              used: r.used,
              updatedBy: actor.id,
            })
            .onConflictDoUpdate({
              target: [bankBlankStaffQuotas.yearMonth, bankBlankStaffQuotas.userId, bankBlankStaffQuotas.bankId],
              set: { issued: r.issued, used: r.used, updatedBy: actor.id, updatedAt: new Date() },
            });
      }

      const shortfall = await shortfallMessage(tx, [departmentId], month);
      if (shortfall) throw new Refused(shortfall);
    });
  } catch (e) {
    if (e instanceof Refused) return { ok: false, message: e.message };
    throw e;
  }
  return { ok: true };
}
