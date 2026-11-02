import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql, type SQL } from "drizzle-orm";
import type {
  BlankType,
  DepartmentBlankCell,
  DepartmentBlanks,
  DepartmentBlanksForm,
  MixCount,
  MixTarget,
  StaffBlankCell,
  StaffBlanks,
  StaffBlanksForm,
} from "@/lib/api/insuranceBlanks";
import { businessMonth } from "@/lib/format";
import { shiftMonth } from "@/lib/period";
import { recordVisibility } from "@/lib/permissions";
import { ROLE_RANK, type RoleKey, type User } from "@/lib/types";
import { db } from "./db/client";
import {
  departments,
  insuranceBlankDepartmentQuotas,
  insuranceBlankStaffQuotas,
  insuranceBlankTypes,
  insuranceMixTargets,
  insuranceOrders,
  staffRoster,
  users,
} from "./db/schema";

/**
 * Phôi bảo hiểm theo tháng (chốt 2026-10-29), thiết kế ở
 * `docs/spec-phan-phoi-bao-hiem-2026-10-29.md`.
 *
 * Số tồn, số còn lại và cảnh báo không lưu: tính lại từ dòng cấp và dòng phát mỗi
 * lần đọc. Số đơn Hoàn thành (`used_orders`) là cột đếm do trigger
 * `mgst_count_insurance_blank` giữ (migration 0160), nên màn không đọc lại đơn.
 * Chuyển phòng (chủ dự án chốt 2026-11-02): dòng ở phòng cũ khoá lại làm lịch sử,
 * phôi chưa sử dụng về phòng cũ qua cột `returned`.
 */

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type TypeRow = BlankType & { product: "motorbike" | "electric-accident"; sumInsured: number | null };
type Outcome = { ok: true } | { ok: false; message: string };

const NOT_EDITABLE = "Chỉ sửa được tháng trước, tháng hiện tại và tháng sau.";

/** TP nhập số vào cuối tháng hoặc đầu tháng sau, nên tháng trước vẫn sửa được. */
export function blankMonthEditable(month: string): boolean {
  const now = businessMonth();
  return month >= shiftMonth(now, -1) && month <= shiftMonth(now, 1);
}

const monthText = (month: string) => `${month.slice(5)}/${month.slice(0, 4)}`;

const activeTypes = (): Promise<TypeRow[]> =>
  db
    .select({
      id: insuranceBlankTypes.id,
      code: insuranceBlankTypes.code,
      name: insuranceBlankTypes.name,
      product: insuranceBlankTypes.product,
      sumInsured: insuranceBlankTypes.sumInsured,
    })
    .from(insuranceBlankTypes)
    .where(eq(insuranceBlankTypes.active, true))
    .orderBy(asc(insuranceBlankTypes.sort), asc(insuranceBlankTypes.code));

const publicType = ({ id, code, name }: TypeRow): BlankType => ({ id, code, name });

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
      select year_month from ${insuranceBlankDepartmentQuotas}
      union all
      select year_month from ${insuranceBlankStaffQuotas} where issued > 0 or used is not null
    ) months`);
  return result.rows[0]?.month ?? null;
}

async function mixTargetFor(month: string): Promise<MixTarget | null> {
  const [row] = await db
    .select({
      electricParts: insuranceMixTargets.electricParts,
      motorbikeParts: insuranceMixTargets.motorbikeParts,
      fromMonth: insuranceMixTargets.yearMonth,
    })
    .from(insuranceMixTargets)
    .where(lte(insuranceMixTargets.yearMonth, month))
    .orderBy(desc(insuranceMixTargets.yearMonth))
    .limit(1);
  return row ?? null;
}

/** Đơn Hoàn thành gom theo người tạo, phòng, tháng của ngày tạo đơn, sản phẩm và số tiền bảo hiểm. */
function doneOrders(where: SQL, fromMonth: string, toMonth: string) {
  return db
    .select({
      userId: insuranceOrders.createdBy,
      departmentId: insuranceOrders.createdByDepartmentId,
      month: sql<string>`to_char(${insuranceOrders.orderDate}, 'YYYY-MM')`,
      product: insuranceOrders.product,
      sumInsured: insuranceOrders.sumInsured,
      count: sql<number>`count(*)::int`,
    })
    .from(insuranceOrders)
    .where(
      and(
        eq(insuranceOrders.status, "done"),
        gte(insuranceOrders.orderDate, `${fromMonth}-01`),
        lt(insuranceOrders.orderDate, `${shiftMonth(toMonth, 1)}-01`),
        where,
      ),
    )
    .groupBy(sql`1, 2, 3, 4, 5`);
}

type OrderCount = Awaited<ReturnType<typeof doneOrders>>[number];

const mixOf = (rows: OrderCount[]): MixCount => ({
  electric: rows.filter((r) => r.product === "electric-accident").reduce((s, r) => s + r.count, 0),
  motorbike: rows.filter((r) => r.product === "motorbike").reduce((s, r) => s + r.count, 0),
});

/* ── Sổ phôi của phòng: cấp thêm và đã phát theo từng tháng ─────────────── */

type Movement = { allocated: number; issued: number; returned: number };
/** Khoá `phòng:loại phôi` → tháng → số cấp thêm, số đã phát cho người và số người rời phòng trả về. */
type Ledger = Map<string, Map<string, Movement>>;

/** Đọc tuần tự, không Promise.all: hàm chạy cả trong transaction, mà một kết nối chỉ chạy một truy vấn một lúc. */
async function departmentLedger(conn: Db, departmentIds: string[]): Promise<Ledger> {
  const ledger: Ledger = new Map();
  if (departmentIds.length === 0) return ledger;
  const allocated = await conn
    .select({
      departmentId: insuranceBlankDepartmentQuotas.departmentId,
      blankTypeId: insuranceBlankDepartmentQuotas.blankTypeId,
      month: insuranceBlankDepartmentQuotas.yearMonth,
      quantity: insuranceBlankDepartmentQuotas.quantity,
    })
    .from(insuranceBlankDepartmentQuotas)
    .where(inArray(insuranceBlankDepartmentQuotas.departmentId, departmentIds));
  const issued = await conn
    .select({
      departmentId: insuranceBlankStaffQuotas.departmentId,
      blankTypeId: insuranceBlankStaffQuotas.blankTypeId,
      month: insuranceBlankStaffQuotas.yearMonth,
      issued: sql<number>`sum(${insuranceBlankStaffQuotas.issued})::int`,
      returned: sql<number>`sum(${insuranceBlankStaffQuotas.returned})::int`,
    })
    .from(insuranceBlankStaffQuotas)
    .where(inArray(insuranceBlankStaffQuotas.departmentId, departmentIds))
    .groupBy(insuranceBlankStaffQuotas.departmentId, insuranceBlankStaffQuotas.blankTypeId, insuranceBlankStaffQuotas.yearMonth);
  const at = (row: { departmentId: string; blankTypeId: string; month: string }): Movement => {
    const key = `${row.departmentId}:${row.blankTypeId}`;
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

function departmentCell(ledger: Ledger, departmentId: string, blankTypeId: string, month: string): DepartmentBlankCell {
  let openingUnallocated = 0;
  let current: Movement = { allocated: 0, issued: 0, returned: 0 };
  for (const [m, movement] of ledger.get(`${departmentId}:${blankTypeId}`) ?? []) {
    if (m < month) openingUnallocated += unallocated(movement);
    else if (m === month) current = movement;
  }
  return { blankTypeId, openingUnallocated, ...current };
}

/**
 * Tháng đầu tiên từ `fromMonth` mà phôi chưa chia của phòng bị âm, tức đã phát
 * cho người nhiều hơn số phòng được cấp cộng dồn. Kiểm cả các tháng sau tháng
 * đang sửa: hạ số cấp tháng 11 làm âm cả tháng 12 đã phát xong.
 */
async function shortfallMessage(conn: Db, departmentIds: string[], fromMonth: string): Promise<string | null> {
  const ledger = await departmentLedger(conn, departmentIds);
  for (const [key, months] of ledger) {
    let running = 0;
    for (const [month, movement] of [...months].sort(([a], [b]) => a.localeCompare(b))) {
      running += unallocated(movement);
      if (month < fromMonth || running >= 0) continue;
      const [departmentId, blankTypeId] = key.split(":");
      const [names] = await conn
        .select({ department: departments.name, type: insuranceBlankTypes.name })
        .from(departments)
        .innerJoin(insuranceBlankTypes, eq(insuranceBlankTypes.id, blankTypeId))
        .where(eq(departments.id, departmentId));
      return `${names?.department ?? "Phòng"}, ${names?.type ?? "phôi"}: tháng ${monthText(month)} đã phát cho nhân viên nhiều hơn số phòng được cấp ${-running} phôi.`;
    }
  }
  return null;
}

class Refused extends Error {}

/** Khoá dòng phòng, theo thứ tự id, trước khi đọc sổ phôi. `no key update` để không chặn lượt ghi trỏ khoá ngoại vào phòng. */
async function lockDepartments(conn: Db, departmentIds: string[]) {
  if (departmentIds.length === 0) return;
  await conn
    .select({ id: departments.id })
    .from(departments)
    .where(inArray(departments.id, departmentIds))
    .orderBy(asc(departments.id))
    .for("no key update");
}

/* ── Tab Cấp cho phòng ─────────────────────────────────────────────────── */

export async function departmentBlanks(month: string): Promise<DepartmentBlanks> {
  const [types, depts, target] = await Promise.all([activeTypes(), salesDepartments(), mixTargetFor(month)]);
  const ids = depts.map((d) => d.id);
  const [ledger, orders] = await Promise.all([
    departmentLedger(db, ids),
    ids.length > 0 ? doneOrders(inArray(insuranceOrders.createdByDepartmentId, ids), month, month) : [],
  ]);
  return {
    month,
    editable: blankMonthEditable(month),
    types: types.map(publicType),
    target,
    rows: depts.map((d) => ({
      departmentId: d.id,
      departmentName: d.name,
      cells: types.map((t) => departmentCell(ledger, d.id, t.id, month)),
      mix: mixOf(orders.filter((o) => o.departmentId === d.id)),
    })),
  };
}

export async function saveDepartmentBlanks(actor: User, month: string, form: DepartmentBlanksForm): Promise<Outcome> {
  if (!blankMonthEditable(month)) return { ok: false, message: NOT_EDITABLE };
  const [types, depts, target] = await Promise.all([activeTypes(), salesDepartments(), mixTargetFor(month)]);
  const typeIds = new Set(types.map((t) => t.id));
  const deptIds = new Set(depts.map((d) => d.id));
  if (form.rows.some((r) => !typeIds.has(r.blankTypeId) || !deptIds.has(r.departmentId)))
    return { ok: false, message: "Phòng hoặc loại phôi không hợp lệ" };

  const touched = [...new Set(form.rows.map((r) => r.departmentId))];
  try {
    await db.transaction(async (tx) => {
      await lockDepartments(tx, touched);
      const existing = await tx
        .select()
        .from(insuranceBlankDepartmentQuotas)
        .where(eq(insuranceBlankDepartmentQuotas.yearMonth, month));
      const before = new Map(existing.map((r) => [`${r.departmentId}:${r.blankTypeId}`, r.quantity]));

      for (const r of form.rows) {
        const key = and(
          eq(insuranceBlankDepartmentQuotas.yearMonth, month),
          eq(insuranceBlankDepartmentQuotas.departmentId, r.departmentId),
          eq(insuranceBlankDepartmentQuotas.blankTypeId, r.blankTypeId),
        );
        const old = before.get(`${r.departmentId}:${r.blankTypeId}`) ?? 0;
        if (r.quantity === old) continue;
        if (r.quantity === 0) await tx.delete(insuranceBlankDepartmentQuotas).where(key);
        else
          await tx
            .insert(insuranceBlankDepartmentQuotas)
            .values({ yearMonth: month, departmentId: r.departmentId, blankTypeId: r.blankTypeId, quantity: r.quantity, updatedBy: actor.id })
            .onConflictDoUpdate({
              target: [
                insuranceBlankDepartmentQuotas.yearMonth,
                insuranceBlankDepartmentQuotas.departmentId,
                insuranceBlankDepartmentQuotas.blankTypeId,
              ],
              set: { quantity: r.quantity, updatedBy: actor.id, updatedAt: new Date() },
            });
      }

      // Mục tiêu kế thừa từ tháng trước mà không đổi thì không chép xuống tháng này.
      const sameTarget =
        target?.electricParts === form.target.electricParts && target?.motorbikeParts === form.target.motorbikeParts;
      if (!sameTarget)
        await tx
          .insert(insuranceMixTargets)
          .values({ yearMonth: month, ...form.target, updatedBy: actor.id })
          .onConflictDoUpdate({
            target: insuranceMixTargets.yearMonth,
            set: { ...form.target, updatedBy: actor.id, updatedAt: new Date() },
          });

      const shortfall = await shortfallMessage(tx, touched, month);
      if (shortfall) throw new Refused(shortfall);
    });
  } catch (e) {
    if (e instanceof Refused) return { ok: false, message: e.message };
    throw e;
  }
  return { ok: true };
}

/* ── Tab Chia cho nhân viên ────────────────────────────────────────────── */

/** Phòng người này nhập phôi được. Phạm vi `own` hiểu là phòng của chính họ. */
async function splitDepartments(actor: User): Promise<{ id: string; name: string }[]> {
  const visibility = recordVisibility(actor, "insurance", "split-blanks");
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

/**
 * Người của phòng trong tháng theo `staff_roster`, cộng người đã có dòng phôi của phòng trong tháng đó.
 * `staff_roster` chưa có tháng sau, nên tháng sau đọc nhân sự của tháng hiện tại.
 */
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
      .from(insuranceBlankStaffQuotas)
      .innerJoin(users, eq(users.id, insuranceBlankStaffQuotas.userId))
      .where(
        and(eq(insuranceBlankStaffQuotas.departmentId, departmentId), eq(insuranceBlankStaffQuotas.yearMonth, month)),
      ),
  ]);
  const byId = new Map<string, Member>();
  for (const m of [...roster, ...extra]) if (!byId.has(m.userId)) byId.set(m.userId, m);
  return [...byId.values()].sort(
    (a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.fullName.localeCompare(b.fullName, "vi"),
  );
}

type QuotaRow = typeof insuranceBlankStaffQuotas.$inferSelect;

/** Số Trưởng phòng nhập, không có thì số đơn Hoàn thành trigger đếm. */
const usedOfRow = (row: QuotaRow) => row.used ?? row.usedOrders;

/** Dòng phôi của những người này ở MỘT phòng, từ `start` tới `month`. */
const staffRows = (conn: Db, departmentId: string, userIds: string[], start: string, month: string) =>
  conn
    .select()
    .from(insuranceBlankStaffQuotas)
    .where(
      and(
        eq(insuranceBlankStaffQuotas.departmentId, departmentId),
        inArray(insuranceBlankStaffQuotas.userId, userIds),
        gte(insuranceBlankStaffQuotas.yearMonth, start),
        lte(insuranceBlankStaffQuotas.yearMonth, month),
      ),
    );

/** Tồn tháng trước cộng các tháng trước ở phòng này: đã phát − đã sử dụng − đã trả về phòng. */
function cellOf(rows: QuotaRow[], userId: string, blankTypeId: string, month: string): StaffBlankCell {
  let opening = 0;
  let current: QuotaRow | undefined;
  for (const r of rows) {
    if (r.userId !== userId || r.blankTypeId !== blankTypeId) continue;
    if (r.yearMonth < month) opening += r.issued - usedOfRow(r) - r.returned;
    else if (r.yearMonth === month) current = r;
  }
  return {
    blankTypeId,
    opening,
    issued: current?.issued ?? 0,
    used: current?.used ?? null,
    usedOrders: current?.usedOrders ?? 0,
    returned: current?.returned ?? 0,
  };
}

/**
 * Khoá mọi dòng đang mở của người này ở phòng cũ, chạy trong transaction lưu chuyển
 * phòng (chủ dự án chốt 2026-11-02). Phôi chưa sử dụng của tháng hiện tại và tháng
 * sau về phòng qua `returned`; tồn của các tháng trước gộp vào tháng hiện tại. Số âm
 * không về phòng, ở lại dòng của người đó. Trả về số dòng đã khoá.
 */
export async function closeStaffBlanks(tx: Db, userId: string, departmentId: string, at: Date): Promise<number> {
  await lockDepartments(tx, [departmentId]);
  const rows = await tx
    .select()
    .from(insuranceBlankStaffQuotas)
    .where(
      and(
        eq(insuranceBlankStaffQuotas.userId, userId),
        eq(insuranceBlankStaffQuotas.departmentId, departmentId),
        isNull(insuranceBlankStaffQuotas.closedAt),
      ),
    )
    .orderBy(asc(insuranceBlankStaffQuotas.yearMonth));
  const first = await firstBlankMonth(tx);
  const now = businessMonth();
  const carry = new Map<string, number>();
  const hasNow = new Set<string>();
  let closed = rows.length;
  // Tồn các tháng trước mà tháng hiện tại chưa có dòng: ghi một dòng khoá mang số trả về, để phòng nhận lại đủ.
  const flush = async (blankTypeId: string) => {
    const left = carry.get(blankTypeId) ?? 0;
    if (left <= 0 || hasNow.has(blankTypeId)) return;
    await tx
      .insert(insuranceBlankStaffQuotas)
      .values({ yearMonth: now, userId, blankTypeId, departmentId, issued: 0, returned: left, closedAt: at })
      .onConflictDoUpdate({
        target: [insuranceBlankStaffQuotas.yearMonth, insuranceBlankStaffQuotas.userId, insuranceBlankStaffQuotas.blankTypeId, insuranceBlankStaffQuotas.departmentId],
        set: { returned: sql`${insuranceBlankStaffQuotas.returned} + ${left}`, closedAt: at, updatedAt: new Date() },
      });
    carry.set(blankTypeId, 0);
    hasNow.add(blankTypeId);
    closed++;
  };
  for (const r of rows) {
    if (r.yearMonth > now) await flush(r.blankTypeId);
    // Tháng trước tháng cấp đầu không tính, cùng luật màn đọc: chỉ khoá.
    const counted = !first || r.yearMonth >= first;
    const balance = counted ? (carry.get(r.blankTypeId) ?? 0) + r.issued - usedOfRow(r) - r.returned : 0;
    const returned = counted && r.yearMonth >= now ? Math.max(balance, 0) : 0;
    if (counted) carry.set(r.blankTypeId, balance - returned);
    if (r.yearMonth === now) hasNow.add(r.blankTypeId);
    await tx
      .update(insuranceBlankStaffQuotas)
      .set({ returned: r.returned + returned, closedAt: at, updatedAt: new Date() })
      .where(
        and(
          eq(insuranceBlankStaffQuotas.yearMonth, r.yearMonth),
          eq(insuranceBlankStaffQuotas.userId, userId),
          eq(insuranceBlankStaffQuotas.blankTypeId, r.blankTypeId),
          eq(insuranceBlankStaffQuotas.departmentId, departmentId),
        ),
      );
  }
  for (const key of carry.keys()) await flush(key);
  return closed;
}

/**
 * Người quay lại phòng cũ: mở lại dòng đã khoá từ tháng hiện tại, giữ nguyên
 * `returned` vì phôi đã về phòng lúc đi. Dòng ở phòng vừa rời phải khoá trước, vì
 * mỗi tháng chỉ một dòng đang mở (`insurance_blank_staff_quotas_open`).
 */
export async function reopenStaffBlanks(tx: Db, userId: string, departmentId: string): Promise<number> {
  const rows = await tx
    .update(insuranceBlankStaffQuotas)
    .set({ closedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(insuranceBlankStaffQuotas.userId, userId),
        eq(insuranceBlankStaffQuotas.departmentId, departmentId),
        isNotNull(insuranceBlankStaffQuotas.closedAt),
        gte(insuranceBlankStaffQuotas.yearMonth, businessMonth()),
      ),
    )
    .returning({ yearMonth: insuranceBlankStaffQuotas.yearMonth });
  return rows.length;
}

export type StaffBlanksResult = { ok: true; data: StaffBlanks } | { ok: false; status: 403 | 404; message: string };

export async function staffBlanks(actor: User, month: string, requested: string): Promise<StaffBlanksResult> {
  const allowed = await splitDepartments(actor);
  if (allowed.length === 0) return { ok: false, status: 403, message: "Bạn chưa được giao phòng nào để chia phôi." };
  const departmentId =
    requested || (allowed.some((d) => d.id === actor.departmentId) ? actor.departmentId! : allowed[0].id);
  if (!allowed.some((d) => d.id === departmentId))
    return { ok: false, status: 404, message: "Không tìm thấy phòng này trong phạm vi của bạn." };

  const [types, target, members, first] = await Promise.all([
    activeTypes(),
    mixTargetFor(month),
    membersOf(departmentId, month),
    firstBlankMonth(),
  ]);
  const start = first && first < month ? first : month;
  const memberIds = members.map((m) => m.userId);

  const [ledger, departmentOrders, rows, orders] = await Promise.all([
    departmentLedger(db, [departmentId]),
    doneOrders(eq(insuranceOrders.createdByDepartmentId, departmentId), month, month),
    memberIds.length > 0 ? staffRows(db, departmentId, memberIds, start, month) : [],
    memberIds.length > 0 ? doneOrders(inArray(insuranceOrders.createdBy, memberIds), month, month) : [],
  ]);

  return {
    ok: true,
    data: {
      month,
      editable: blankMonthEditable(month),
      departmentId,
      departments: allowed,
      types: types.map(publicType),
      target,
      departmentCells: types.map((t) => departmentCell(ledger, departmentId, t.id, month)),
      departmentMix: mixOf(departmentOrders),
      rows: members.map((m) => ({
        ...m,
        cells: types.map((t) => cellOf(rows, m.userId, t.id, month)),
        movedOut: rows.some((r) => r.userId === m.userId && r.yearMonth === month && r.closedAt !== null),
        // Tỉ lệ của người đếm mọi đơn của người đó trong tháng, không xét phòng (chốt 2026-11-02).
        mix: mixOf(orders.filter((o) => o.userId === m.userId)),
      })),
    },
  };
}

export async function saveStaffBlanks(
  actor: User,
  month: string,
  departmentId: string,
  form: StaffBlanksForm,
): Promise<Outcome> {
  if (!blankMonthEditable(month)) return { ok: false, message: NOT_EDITABLE };
  const allowed = await splitDepartments(actor);
  if (!allowed.some((d) => d.id === departmentId))
    return { ok: false, message: "Không tìm thấy phòng này trong phạm vi của bạn." };

  const [types, members] = await Promise.all([activeTypes(), membersOf(departmentId, month)]);
  const typeIds = new Set(types.map((t) => t.id));
  const memberIds = new Set(members.map((m) => m.userId));
  if (form.rows.some((r) => !typeIds.has(r.blankTypeId))) return { ok: false, message: "Loại phôi không hợp lệ" };

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
              .from(insuranceBlankStaffQuotas)
              .where(
                and(
                  eq(insuranceBlankStaffQuotas.yearMonth, month),
                  eq(insuranceBlankStaffQuotas.departmentId, departmentId),
                  inArray(insuranceBlankStaffQuotas.userId, userIds),
                ),
              )
          : [];

      for (const r of rows) {
        const old = existing.find((e) => e.userId === r.userId && e.blankTypeId === r.blankTypeId);
        // Dòng đã khoá là lịch sử của người đã rời phòng.
        if (old?.closedAt) continue;
        if (old && old.issued === r.issued && old.used === r.used) continue;
        if (!old && r.issued === 0 && r.used === null) continue;
        const key = and(
          eq(insuranceBlankStaffQuotas.yearMonth, month),
          eq(insuranceBlankStaffQuotas.userId, r.userId),
          eq(insuranceBlankStaffQuotas.blankTypeId, r.blankTypeId),
          eq(insuranceBlankStaffQuotas.departmentId, departmentId),
        );
        // Dòng còn số đơn trigger đếm hay số đã trả về phòng thì giữ lại với hai ô trống.
        if (r.issued === 0 && r.used === null && old?.usedOrders === 0 && old.returned === 0)
          await tx.delete(insuranceBlankStaffQuotas).where(key);
        else
          await tx
            .insert(insuranceBlankStaffQuotas)
            .values({
              yearMonth: month,
              userId: r.userId,
              blankTypeId: r.blankTypeId,
              departmentId,
              issued: r.issued,
              used: r.used,
              updatedBy: actor.id,
            })
            .onConflictDoUpdate({
              target: [
                insuranceBlankStaffQuotas.yearMonth,
                insuranceBlankStaffQuotas.userId,
                insuranceBlankStaffQuotas.blankTypeId,
                insuranceBlankStaffQuotas.departmentId,
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

/** Tên phòng cho dòng nhật ký. */
export async function departmentName(departmentId: string): Promise<string> {
  const [row] = await db.select({ name: departments.name }).from(departments).where(eq(departments.id, departmentId));
  return row?.name ?? "";
}
