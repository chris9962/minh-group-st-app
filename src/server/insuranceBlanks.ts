import { and, asc, desc, eq, gte, inArray, lt, lte, sql, type SQL } from "drizzle-orm";
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
 * Không lưu số tồn, số đã dùng hay kết quả cảnh báo: mọi số đó tính lại từ các
 * dòng cấp, dòng phát và đơn Hoàn thành mỗi lần đọc. Nhờ vậy đơn đổi trạng thái
 * hay văn phòng sửa mục tiêu giữa tháng thì số trên màn tự đúng.
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

/** Đơn khớp loại phôi đầu tiên cùng sản phẩm; `sum_insured` null là khớp mọi đơn của sản phẩm đó. */
const typeOfOrder = (types: TypeRow[], product: string, sumInsured: number): string | null =>
  types.find((t) => t.product === product && (t.sumInsured === null || t.sumInsured === sumInsured))?.id ?? null;

const salesDepartments = () =>
  db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(and(eq(departments.type, "sales"), eq(departments.active, true)))
    .orderBy(asc(departments.name));

/** Tháng đầu tiên có số liệu phôi; đơn trước tháng này không trừ phôi. */
async function firstBlankMonth(): Promise<string | null> {
  const result = await db.execute<{ month: string | null }>(sql`
    select min(year_month) as month from (
      select year_month from ${insuranceBlankDepartmentQuotas}
      union all
      select year_month from ${insuranceBlankStaffQuotas}
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

type Movement = { allocated: number; issued: number };
/** Khoá `phòng:loại phôi` → tháng → số cấp thêm và số đã phát cho người. */
type Ledger = Map<string, Map<string, Movement>>;

async function departmentLedger(conn: Db, departmentIds: string[]): Promise<Ledger> {
  const ledger: Ledger = new Map();
  if (departmentIds.length === 0) return ledger;
  const [allocated, issued] = await Promise.all([
    conn
      .select({
        departmentId: insuranceBlankDepartmentQuotas.departmentId,
        blankTypeId: insuranceBlankDepartmentQuotas.blankTypeId,
        month: insuranceBlankDepartmentQuotas.yearMonth,
        quantity: insuranceBlankDepartmentQuotas.quantity,
      })
      .from(insuranceBlankDepartmentQuotas)
      .where(inArray(insuranceBlankDepartmentQuotas.departmentId, departmentIds)),
    conn
      .select({
        departmentId: insuranceBlankStaffQuotas.departmentId,
        blankTypeId: insuranceBlankStaffQuotas.blankTypeId,
        month: insuranceBlankStaffQuotas.yearMonth,
        quantity: sql<number>`sum(${insuranceBlankStaffQuotas.issued})::int`,
      })
      .from(insuranceBlankStaffQuotas)
      .where(inArray(insuranceBlankStaffQuotas.departmentId, departmentIds))
      .groupBy(insuranceBlankStaffQuotas.departmentId, insuranceBlankStaffQuotas.blankTypeId, insuranceBlankStaffQuotas.yearMonth),
  ]);
  const add = (row: { departmentId: string; blankTypeId: string; month: string; quantity: number }, field: keyof Movement) => {
    const key = `${row.departmentId}:${row.blankTypeId}`;
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

function departmentCell(ledger: Ledger, departmentId: string, blankTypeId: string, month: string): DepartmentBlankCell {
  let openingUnallocated = 0;
  let current: Movement = { allocated: 0, issued: 0 };
  for (const [m, movement] of ledger.get(`${departmentId}:${blankTypeId}`) ?? []) {
    if (m < month) openingUnallocated += movement.allocated - movement.issued;
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
      running += movement.allocated - movement.issued;
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

type Member = { userId: string; fullName: string; role: RoleKey };

/**
 * Người của phòng trong tháng theo `staff_roster`, cộng người đã có dòng phôi của phòng trong tháng đó.
 * `staff_roster` chưa có tháng sau, nên tháng sau đọc nhân sự của tháng hiện tại.
 */
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
    memberIds.length > 0
      ? db
          .select()
          .from(insuranceBlankStaffQuotas)
          .where(and(inArray(insuranceBlankStaffQuotas.userId, memberIds), lte(insuranceBlankStaffQuotas.yearMonth, month)))
      : [],
    memberIds.length > 0 ? doneOrders(inArray(insuranceOrders.createdBy, memberIds), start, month) : [],
  ]);

  const months: string[] = [];
  for (let m = start; m < month; m = shiftMonth(m, 1)) months.push(m);
  const rowOf = (userId: string, blankTypeId: string, m: string) =>
    rows.find((r) => r.userId === userId && r.blankTypeId === blankTypeId && r.yearMonth === m);
  const usedByOrders = (userId: string, blankTypeId: string, m: string) =>
    orders
      .filter((o) => o.userId === userId && o.month === m && typeOfOrder(types, o.product, o.sumInsured) === blankTypeId)
      .reduce((s, o) => s + o.count, 0);

  const cellOf = (userId: string, blankTypeId: string): StaffBlankCell => {
    let opening = 0;
    for (const m of months) {
      const row = rowOf(userId, blankTypeId, m);
      opening += (row?.issued ?? 0) - (row?.used ?? usedByOrders(userId, blankTypeId, m));
    }
    const row = rowOf(userId, blankTypeId, month);
    return {
      blankTypeId,
      opening,
      issued: row?.issued ?? 0,
      used: row?.used ?? null,
      usedOrders: usedByOrders(userId, blankTypeId, month),
    };
  };

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
        cells: types.map((t) => cellOf(m.userId, t.id)),
        mix: mixOf(orders.filter((o) => o.userId === m.userId && o.month === month)),
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
  if (form.rows.some((r) => !typeIds.has(r.blankTypeId) || !memberIds.has(r.userId)))
    return { ok: false, message: "Người hoặc loại phôi không thuộc phòng này trong tháng đang chọn." };

  const userIds = [...new Set(form.rows.map((r) => r.userId))];
  try {
    await db.transaction(async (tx) => {
      await lockDepartments(tx, [departmentId]);
      const existing =
        userIds.length > 0
          ? await tx
              .select()
              .from(insuranceBlankStaffQuotas)
              .where(and(eq(insuranceBlankStaffQuotas.yearMonth, month), inArray(insuranceBlankStaffQuotas.userId, userIds)))
          : [];
      const elsewhere = existing.find((r) => r.departmentId !== departmentId);
      if (elsewhere) {
        const name = members.find((m) => m.userId === elsewhere.userId)?.fullName ?? "Một người";
        throw new Refused(`${name} đã được phòng khác nhập phôi trong tháng ${monthText(month)}.`);
      }

      for (const r of form.rows) {
        const old = existing.find((e) => e.userId === r.userId && e.blankTypeId === r.blankTypeId);
        if (old && old.issued === r.issued && old.used === r.used) continue;
        if (!old && r.issued === 0 && r.used === null) continue;
        const key = and(
          eq(insuranceBlankStaffQuotas.yearMonth, month),
          eq(insuranceBlankStaffQuotas.userId, r.userId),
          eq(insuranceBlankStaffQuotas.blankTypeId, r.blankTypeId),
        );
        if (r.issued === 0 && r.used === null) await tx.delete(insuranceBlankStaffQuotas).where(key);
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
              target: [insuranceBlankStaffQuotas.yearMonth, insuranceBlankStaffQuotas.userId, insuranceBlankStaffQuotas.blankTypeId],
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
