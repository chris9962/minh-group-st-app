import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type {
  BankDepartmentBlanks,
  BankDepartmentBlanksForm,
  BankStaffBlankCell,
  BankStaffBlanks,
  BankStaffBlanksForm,
} from "@/lib/api/bankBlanks";
import type { BlankType, DepartmentBlankCell } from "@/lib/api/insuranceBlanks";
import { businessMonth } from "@/lib/format";
import { recordVisibility } from "@/lib/permissions";
import { ROLE_RANK, type RoleKey, type User } from "@/lib/types";
import { db } from "./db/client";
import { bankBlankDepartmentQuotas, bankBlankStaffQuotas, banks, departments, staffRoster, users } from "./db/schema";
import { blankMonthEditable } from "./insuranceBlanks";

/**
 * Phiếu thông tin ngân hàng theo tháng (chốt 2026-10-31). Cùng luật phôi bảo
 * hiểm ở `insuranceBlanks.ts`, khác hai chỗ: loại phiếu là ngân hàng, và số đã
 * sử dụng (`used_orders`) do trigger `mgst_count_bank_blank` đếm tài khoản sang
 * Hoàn thành lần đầu, theo tháng của ngày hồ sơ khách (migration 0161). Lỗi hay
 * Đã sửa lỗi sau đó không đổi số; xoá dòng mới trả phiếu lại.
 */

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type Outcome = { ok: true } | { ok: false; message: string };

const NOT_EDITABLE = "Chỉ sửa được tháng trước, tháng hiện tại và tháng sau.";

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

/** Tháng đầu tiên văn phòng cấp hoặc Trưởng phòng nhập; dòng chỉ do trigger tạo không tính. */
async function firstBlankMonth(conn: Db = db): Promise<string | null> {
  const result = await conn.execute<{ month: string | null }>(sql`
    select min(year_month) as month from (
      select year_month from ${bankBlankDepartmentQuotas}
      union all
      select year_month from ${bankBlankStaffQuotas} where issued > 0 or used is not null
    ) months`);
  return result.rows[0]?.month ?? null;
}

/* ── Sổ phiếu của phòng: cấp thêm và đã phát theo từng tháng ────────────── */

type Movement = { allocated: number; issued: number; returned: number };
/** Khoá `phòng:ngân hàng` → tháng → số cấp thêm, số đã phát cho người và số người rời phòng trả về. */
type Ledger = Map<string, Map<string, Movement>>;

/** Đọc tuần tự, không Promise.all: hàm chạy cả trong transaction, mà một kết nối chỉ chạy một truy vấn một lúc. */
async function departmentLedger(conn: Db, departmentIds: string[]): Promise<Ledger> {
  const ledger: Ledger = new Map();
  if (departmentIds.length === 0) return ledger;
  const allocated = await conn
    .select({
      departmentId: bankBlankDepartmentQuotas.departmentId,
      bankId: bankBlankDepartmentQuotas.bankId,
      month: bankBlankDepartmentQuotas.yearMonth,
      quantity: bankBlankDepartmentQuotas.quantity,
    })
    .from(bankBlankDepartmentQuotas)
    .where(inArray(bankBlankDepartmentQuotas.departmentId, departmentIds));
  const issued = await conn
    .select({
      departmentId: bankBlankStaffQuotas.departmentId,
      bankId: bankBlankStaffQuotas.bankId,
      month: bankBlankStaffQuotas.yearMonth,
      issued: sql<number>`sum(${bankBlankStaffQuotas.issued})::int`,
      returned: sql<number>`sum(${bankBlankStaffQuotas.returned})::int`,
    })
    .from(bankBlankStaffQuotas)
    .where(inArray(bankBlankStaffQuotas.departmentId, departmentIds))
    .groupBy(bankBlankStaffQuotas.departmentId, bankBlankStaffQuotas.bankId, bankBlankStaffQuotas.yearMonth);
  const at = (row: { departmentId: string; bankId: string; month: string }): Movement => {
    const key = `${row.departmentId}:${row.bankId}`;
    const months = ledger.get(key) ?? new Map<string, Movement>();
    const movement = months.get(row.month) ?? { allocated: 0, issued: 0, returned: 0 };
    months.set(row.month, movement);
    ledger.set(key, months);
    return movement;
  };
  for (const row of allocated) at(row).allocated += row.quantity;
  for (const row of issued) {
    const movement = at(row);
    movement.issued += row.issued;
    movement.returned += row.returned;
  }
  return ledger;
}

const unallocated = (m: Movement) => m.allocated - m.issued + m.returned;

function departmentCell(ledger: Ledger, departmentId: string, bankId: string, month: string): DepartmentBlankCell {
  let openingUnallocated = 0;
  let current: Movement = { allocated: 0, issued: 0, returned: 0 };
  for (const [m, movement] of ledger.get(`${departmentId}:${bankId}`) ?? []) {
    if (m < month) openingUnallocated += unallocated(movement);
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
      running += unallocated(movement);
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

type Member = { userId: string; fullName: string; role: RoleKey; title: string };

/** Người của phòng trong tháng theo `staff_roster`, cộng người đã có dòng phiếu của phòng trong tháng đó. */
async function membersOf(departmentId: string, month: string): Promise<Member[]> {
  const rosterMonth = month > businessMonth() ? businessMonth() : month;
  const [roster, extra] = await Promise.all([
    db
      .select({ userId: staffRoster.userId, fullName: users.fullName, role: staffRoster.role, title: users.title })
      .from(staffRoster)
      .innerJoin(users, eq(users.id, staffRoster.userId))
      .where(
        and(eq(staffRoster.departmentId, departmentId), eq(staffRoster.yearMonth, rosterMonth), eq(staffRoster.active, true)),
      ),
    db
      .selectDistinct({ userId: users.id, fullName: users.fullName, role: users.role, title: users.title })
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

type QuotaRow = typeof bankBlankStaffQuotas.$inferSelect;

/** Số Trưởng phòng nhập, không có thì số tài khoản trigger đếm. */
const usedOfRow = (row: QuotaRow) => row.used ?? row.usedOrders;

/** Dòng phiếu của những người này ở MỘT phòng, từ `start` tới `month`. */
const staffRows = (conn: Db, departmentId: string, userIds: string[], start: string, month: string) =>
  conn
    .select()
    .from(bankBlankStaffQuotas)
    .where(
      and(
        eq(bankBlankStaffQuotas.departmentId, departmentId),
        inArray(bankBlankStaffQuotas.userId, userIds),
        gte(bankBlankStaffQuotas.yearMonth, start),
        lte(bankBlankStaffQuotas.yearMonth, month),
      ),
    );

/** Tồn tháng trước cộng các tháng trước ở phòng này: đã phát − đã sử dụng − đã trả về phòng. */
function cellOf(rows: QuotaRow[], userId: string, bankId: string, month: string): BankStaffBlankCell {
  let opening = 0;
  let current: QuotaRow | undefined;
  for (const r of rows) {
    if (r.userId !== userId || r.bankId !== bankId) continue;
    if (r.yearMonth < month) opening += r.issued - usedOfRow(r) - r.returned;
    else if (r.yearMonth === month) current = r;
  }
  return {
    blankTypeId: bankId,
    opening,
    issued: current?.issued ?? 0,
    used: current?.used ?? null,
    usedAccounts: current?.usedOrders ?? 0,
    returned: current?.returned ?? 0,
  };
}

/** Cùng luật `closeStaffBlanks` của `insuranceBlanks.ts`. Trả về số dòng đã khoá. */
export async function closeBankStaffBlanks(tx: Db, userId: string, departmentId: string, at: Date): Promise<number> {
  await lockDepartments(tx, [departmentId]);
  const rows = await tx
    .select()
    .from(bankBlankStaffQuotas)
    .where(
      and(
        eq(bankBlankStaffQuotas.userId, userId),
        eq(bankBlankStaffQuotas.departmentId, departmentId),
        isNull(bankBlankStaffQuotas.closedAt),
      ),
    )
    .orderBy(asc(bankBlankStaffQuotas.yearMonth));
  const first = await firstBlankMonth(tx);
  const now = businessMonth();
  const carry = new Map<string, number>();
  const hasNow = new Set<string>();
  let closed = rows.length;
  // Tồn các tháng trước mà tháng hiện tại chưa có dòng: ghi một dòng khoá mang số trả về, để phòng nhận lại đủ.
  const flush = async (bankId: string) => {
    const left = carry.get(bankId) ?? 0;
    if (left <= 0 || hasNow.has(bankId)) return;
    await tx
      .insert(bankBlankStaffQuotas)
      .values({ yearMonth: now, userId, bankId, departmentId, issued: 0, returned: left, closedAt: at })
      .onConflictDoUpdate({
        target: [bankBlankStaffQuotas.yearMonth, bankBlankStaffQuotas.userId, bankBlankStaffQuotas.bankId, bankBlankStaffQuotas.departmentId],
        set: { returned: sql`${bankBlankStaffQuotas.returned} + ${left}`, closedAt: at, updatedAt: new Date() },
      });
    carry.set(bankId, 0);
    hasNow.add(bankId);
    closed++;
  };
  for (const r of rows) {
    if (r.yearMonth > now) await flush(r.bankId);
    // Tháng trước tháng cấp đầu không tính, cùng luật màn đọc: chỉ khoá.
    const counted = !first || r.yearMonth >= first;
    const balance = counted ? (carry.get(r.bankId) ?? 0) + r.issued - usedOfRow(r) - r.returned : 0;
    const returned = counted && r.yearMonth >= now ? Math.max(balance, 0) : 0;
    if (counted) carry.set(r.bankId, balance - returned);
    if (r.yearMonth === now) hasNow.add(r.bankId);
    await tx
      .update(bankBlankStaffQuotas)
      .set({ returned: r.returned + returned, closedAt: at, updatedAt: new Date() })
      .where(
        and(
          eq(bankBlankStaffQuotas.yearMonth, r.yearMonth),
          eq(bankBlankStaffQuotas.userId, userId),
          eq(bankBlankStaffQuotas.bankId, r.bankId),
          eq(bankBlankStaffQuotas.departmentId, departmentId),
        ),
      );
  }
  for (const key of carry.keys()) await flush(key);
  return closed;
}

/** Cùng luật `reopenStaffBlanks` của `insuranceBlanks.ts`. */
export async function reopenBankStaffBlanks(tx: Db, userId: string, departmentId: string): Promise<number> {
  const rows = await tx
    .update(bankBlankStaffQuotas)
    .set({ closedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(bankBlankStaffQuotas.userId, userId),
        eq(bankBlankStaffQuotas.departmentId, departmentId),
        isNotNull(bankBlankStaffQuotas.closedAt),
        gte(bankBlankStaffQuotas.yearMonth, businessMonth()),
      ),
    )
    .returning({ yearMonth: bankBlankStaffQuotas.yearMonth });
  return rows.length;
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

  const [ledger, rows] = await Promise.all([
    departmentLedger(db, [departmentId]),
    memberIds.length > 0 ? staffRows(db, departmentId, memberIds, start, month) : [],
  ]);

  const departmentCells = allBanks.map((b) => departmentCell(ledger, departmentId, b.id, month));
  const staffRowsOut = members.map((m) => ({
    ...m,
    cells: allBanks.map((b) => cellOf(rows, m.userId, b.id, month)),
    movedOut: rows.some((r) => r.userId === m.userId && r.yearMonth === month && r.closedAt !== null),
  }));
  // Ngân hàng phòng chưa từng có phiếu thì không hiện, để bảng gọn (chốt 2026-10-31).
  const shown = allBanks.filter((b, i) => {
    const d = departmentCells[i];
    if (d.openingUnallocated !== 0 || d.allocated !== 0 || d.issued !== 0 || d.returned !== 0) return true;
    return staffRowsOut.some((r) => r.cells[i].opening !== 0 || r.cells[i].issued !== 0);
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
      rows: staffRowsOut.map((r) => ({ ...r, cells: r.cells.filter((c) => shownIds.has(c.blankTypeId)) })),
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
  if (form.rows.some((r) => !bankIds.has(r.blankTypeId))) return { ok: false, message: "Ngân hàng không hợp lệ" };

  // Người không còn thuộc phòng thì bỏ qua, không từ chối: màn mở từ trước lúc có người chuyển đi vẫn lưu được.
  const rows = form.rows.filter((r) => memberIds.has(r.userId));
  const userIds = [...new Set(rows.map((r) => r.userId))];
  try {
    await db.transaction(async (tx) => {
      await lockDepartments(tx, [departmentId]);
      const existing =
        userIds.length > 0
          ? await tx
              .select()
              .from(bankBlankStaffQuotas)
              .where(
                and(
                  eq(bankBlankStaffQuotas.yearMonth, month),
                  eq(bankBlankStaffQuotas.departmentId, departmentId),
                  inArray(bankBlankStaffQuotas.userId, userIds),
                ),
              )
          : [];

      for (const r of rows) {
        const old = existing.find((e) => e.userId === r.userId && e.bankId === r.blankTypeId);
        // Dòng đã khoá là lịch sử của người đã rời phòng.
        if (old?.closedAt) continue;
        if (old && old.issued === r.issued && old.used === r.used) continue;
        if (!old && r.issued === 0 && r.used === null) continue;
        const key = and(
          eq(bankBlankStaffQuotas.yearMonth, month),
          eq(bankBlankStaffQuotas.userId, r.userId),
          eq(bankBlankStaffQuotas.bankId, r.blankTypeId),
          eq(bankBlankStaffQuotas.departmentId, departmentId),
        );
        // Dòng còn số tài khoản trigger đếm hay số đã trả về phòng thì giữ lại với hai ô trống.
        if (r.issued === 0 && r.used === null && old?.usedOrders === 0 && old.returned === 0)
          await tx.delete(bankBlankStaffQuotas).where(key);
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
              target: [
                bankBlankStaffQuotas.yearMonth,
                bankBlankStaffQuotas.userId,
                bankBlankStaffQuotas.bankId,
                bankBlankStaffQuotas.departmentId,
              ],
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
