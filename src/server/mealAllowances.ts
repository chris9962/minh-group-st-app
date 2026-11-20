import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import {
  MEAL_SORTS,
  MEAL_START_MONTH,
  MealStatus,
  type MealActionForm,
  type MealDetail,
  type MealEvent,
  type MealEventKind,
  type MealExportRow,
  type MealList,
  type MealListMode,
  type MealPhase,
  type MealRow,
} from "@/lib/api/mealAllowances";
import { businessDay, businessMonth, formatPoints } from "@/lib/format";
import { can, recordVisibility } from "@/lib/permissions";
import { shiftMonth } from "@/lib/period";
import type { User } from "@/lib/types";
import { salaryRulesFor } from "@/rules/salary";
import { isMonthClosed, lockSalaryMonth } from "./closedMonths";
import { db } from "./db/client";
import {
  departments,
  mealAllowanceEvents,
  mealAllowanceRows,
  salaryAdjustments,
  staffProfiles,
  staffRoster,
  users,
} from "./db/schema";
import { pageArgsFrom } from "./pagination";
import { staffSearchWhere } from "./people";
import { mealBasisFor, type MealBasis } from "./salary";
import { relationsFor, toUser } from "./users";

/**
 * Lương ăn ca (chủ dự án chốt 2026-11-20, thiết kế ở
 * `docs/thiet-ke-luong-an-ca-2026-11-20.md`):
 *
 *   ngày cuối tháng M        app lập danh sách; Trưởng phòng sửa số ngày, duyệt
 *   00:00 ngày 1 tháng M+1   dòng Trưởng phòng chưa duyệt thành "Trưởng phòng không duyệt"
 *   từ ngày 1 tháng M+1      kế toán sửa, duyệt, khoá số, xuất Excel, bấm Đã chi ăn ca
 *
 * Khoản đã chi ghi vào lương của chính tháng M, không phải tháng bấm nút.
 * Không có job chạy lúc 00:00: mọi đường đọc và ghi gọi `forwardOverdue` trước,
 * như `expireOverdue` của tạm ứng. Danh sách lập ở lần đọc đầu tiên từ ngày cuối
 * tháng, xem `ensureRows`.
 */

/** Dòng chờ kế toán duyệt. */
const WAITING: MealStatus[] = ["head-approved", "forwarded"];

/** `MEAL_ALLOWANCE_NOW` (chuỗi ISO) đặt giờ giả để thử luồng ngoài ngày cuối tháng; chỉ đặt ở máy local và testapp. */
export function mealNow(): Date {
  const fake = process.env.MEAL_ALLOWANCE_NOW;
  const at = fake ? new Date(fake) : null;
  return at && !Number.isNaN(at.getTime()) ? at : new Date();
}

const lastDayOf = (month: string): number => {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
};

export function mealPhaseOf(month: string, now: Date): MealPhase {
  if (month < MEAL_START_MONTH) return "before";
  const today = businessDay(now);
  const current = today.slice(0, 7);
  if (month < current) return "accounting";
  if (month > current) return "before";
  return Number(today.slice(8, 10)) === lastDayOf(month) ? "head-review" : "before";
}

/** 00:00 ngày 1 tháng sau, giờ Việt Nam: hết hạn Trưởng phòng duyệt. */
const forwardAtOf = (month: string): Date => new Date(`${shiftMonth(month, 1)}-01T00:00:00+07:00`);

/** Tên Trưởng phòng của đúng tháng đó theo từng phòng (AGENTS.md §5.3). */
async function headNamesOf(
  conn: Pick<typeof db, "select">,
  departmentIds: string[],
  months: string[],
): Promise<(departmentId: string | null, month: string) => string> {
  const heads =
    departmentIds.length > 0
      ? await conn
          .select({ departmentId: staffRoster.departmentId, yearMonth: staffRoster.yearMonth, fullName: users.fullName })
          .from(staffRoster)
          .innerJoin(users, eq(users.id, staffRoster.userId))
          .where(
            and(
              inArray(staffRoster.departmentId, departmentIds),
              inArray(staffRoster.yearMonth, months),
              eq(staffRoster.role, "head"),
              eq(staffRoster.active, true),
            ),
          )
      : [];
  return (departmentId, month) => {
    const names = heads.filter((h) => h.departmentId === departmentId && h.yearMonth === month).map((h) => h.fullName);
    return names.length > 0 ? `Trưởng phòng phụ trách: ${names.join(", ")}` : "";
  };
}

/** Dòng còn chờ Trưởng phòng khi đã qua 00:00 ngày 1 tháng sau thì chuyển tới kế toán. */
async function forwardOverdue(now: Date): Promise<void> {
  const current = businessMonth(now);
  await db.transaction(async (tx) => {
    const moved = await tx
      .update(mealAllowanceRows)
      .set({ status: "forwarded", updatedAt: now })
      .where(and(eq(mealAllowanceRows.status, "pending"), sql`${mealAllowanceRows.yearMonth} < ${current}`))
      .returning({
        id: mealAllowanceRows.id,
        departmentId: mealAllowanceRows.departmentId,
        yearMonth: mealAllowanceRows.yearMonth,
        editedDays: mealAllowanceRows.editedDays,
      });
    if (moved.length === 0) return;
    const noteOf = await headNamesOf(
      tx,
      [...new Set(moved.flatMap((r) => (r.departmentId ? [r.departmentId] : [])))],
      [...new Set(moved.map((r) => r.yearMonth))],
    );
    await tx.insert(mealAllowanceEvents).values(
      moved.map((r) => ({
        rowId: r.id,
        kind: "forward" as const,
        toDays: r.editedDays,
        note: noteOf(r.departmentId, r.yearMonth),
        createdAt: forwardAtOf(r.yearMonth),
      })),
    );
  });
}

/** Người duyệt dòng của phòng này được. Phạm vi `own` hiểu là phòng của chính họ, như tạm ứng. */
function headCovers(actor: User, departmentId: string | null): boolean {
  if (!departmentId) return false;
  const visibility = recordVisibility(actor, "salary", "approve-meal");
  if (visibility.kind === "all") return true;
  if (visibility.kind === "departments") return visibility.departmentIds.includes(departmentId);
  if (visibility.kind === "creator") return departmentId === actor.departmentId;
  return false;
}

/** Quyền của người có dòng, để biết dòng nào đi thẳng tới kế toán. */
async function usersByIds(ids: string[]): Promise<Map<string, User>> {
  if (ids.length === 0) return new Map();
  const [rows, { permissionsOf, managedOf, managedBanksOf, insuranceDepartmentsOf }] = await Promise.all([
    db.select().from(users).where(inArray(users.id, ids)),
    relationsFor(ids),
  ]);
  return new Map(
    rows.map((row) => [
      row.id,
      toUser(
        row,
        permissionsOf.get(row.id) ?? [],
        managedOf.get(row.id) ?? [],
        managedBanksOf.get(row.id) ?? [],
        insuranceDepartmentsOf.get(row.id) ?? [],
        null,
      ),
    ]),
  );
}

/**
 * Lập dòng cho người có ăn ca trong lương tháng mà chưa có dòng. Người còn làm
 * thì có dòng kể cả 0 ngày; người đã nghỉ chỉ có dòng khi có ngày.
 *
 * Không ai tự duyệt dòng của mình: dòng của người duyệt phủ chính phòng họ, và
 * dòng không thuộc phòng nào, đi thẳng tới kế toán.
 */
async function ensureRows(month: string, now: Date): Promise<void> {
  const phase = mealPhaseOf(month, now);
  if (phase === "before" || (await isMonthClosed(month))) return;

  if (phase === "head-review")
    // Người chuyển phòng trong ngày cuối tháng sang đúng danh sách phòng mới.
    await db.execute(sql`
      update meal_allowance_rows r
      set department_id = s.department_id, updated_at = ${now}
      from staff_roster s
      where s.user_id = r.user_id and s.year_month = r.year_month
        and r.year_month = ${month} and r.status = 'pending'
        and r.department_id is distinct from s.department_id
    `);

  const candidates = await db
    .select({ id: staffRoster.userId })
    .from(staffRoster)
    .leftJoin(
      mealAllowanceRows,
      and(eq(mealAllowanceRows.userId, staffRoster.userId), eq(mealAllowanceRows.yearMonth, month)),
    )
    .where(and(eq(staffRoster.yearMonth, month), isNull(mealAllowanceRows.id)));
  if (candidates.length === 0) return;

  const basis = await mealBasisFor(
    candidates.map((c) => c.id),
    month,
  );
  const fresh = [...basis].filter(([, b]) => b.active || b.appDays > 0);
  if (fresh.length === 0) return;
  const people = await usersByIds(fresh.map(([id]) => id));

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(mealAllowanceRows)
      .values(
        fresh.map(([userId, b]) => {
          const person = people.get(userId);
          const skip = !b.departmentId || (person !== undefined && headCovers(person, b.departmentId));
          return {
            userId,
            yearMonth: month,
            departmentId: b.departmentId,
            status: skip ? ("head-approved" as const) : phase === "head-review" ? ("pending" as const) : ("forwarded" as const),
            createdAt: now,
            updatedAt: now,
          };
        }),
      )
      .onConflictDoNothing()
      .returning({ id: mealAllowanceRows.id, userId: mealAllowanceRows.userId, status: mealAllowanceRows.status });
    if (inserted.length === 0) return;
    await tx.insert(mealAllowanceEvents).values(
      inserted.map((r) => ({
        rowId: r.id,
        kind: "create" as const,
        toDays: basis.get(r.userId)?.appDays ?? 0,
        note:
          r.status === "head-approved"
            ? "Không qua bước Trưởng phòng duyệt."
            : r.status === "forwarded"
              ? "Lập sau hạn Trưởng phòng duyệt."
              : "",
        createdAt: now,
      })),
    );
  });
}

type RowRecord = typeof mealAllowanceRows.$inferSelect;

/** Số ngày đang hiện của dòng. */
const daysOf = (row: RowRecord, basis: MealBasis | undefined): number =>
  row.lockedDays ?? row.editedDays ?? basis?.appDays ?? 0;

const rateOf = (month: string): number => salaryRulesFor(month)?.mealRate ?? 0;

type Permitted = { as: "head" | "accounting"; approve: boolean; reject: boolean } | null;

function permitted(actor: User, row: RowRecord, phase: MealPhase, monthClosed: boolean): Permitted {
  if (monthClosed || row.userId === actor.id) return null;
  if (row.status === "pending" && phase === "head-review" && headCovers(actor, row.departmentId))
    return { as: "head", approve: true, reject: false };
  if (
    (WAITING.includes(row.status) || row.status === "approved") &&
    phase === "accounting" &&
    can(actor, "salary", "pay-meal")
  )
    return { as: "accounting", approve: row.status !== "approved", reject: true };
  return null;
}

function refusal(actor: User, row: RowRecord, phase: MealPhase, monthClosed: boolean): string {
  if (monthClosed) return "Lương tháng này đã chốt, không đổi được dòng ăn ca.";
  if (row.userId === actor.id) return "Bạn không tự sửa hoặc duyệt dòng ăn ca của mình.";
  if (phase !== "head-review" && !can(actor, "salary", "pay-meal"))
    return "Trưởng phòng sửa và duyệt trong ngày cuối tháng.";
  if (WAITING.includes(row.status) && phase !== "accounting") return "Kế toán xử lý từ 00:00 ngày 1 tháng sau.";
  return "Dòng ăn ca vừa đổi trạng thái. Bạn tải lại danh sách.";
}

async function eventsOf(rowId: string): Promise<MealEvent[]> {
  const rows = await db
    .select({
      id: mealAllowanceEvents.id,
      kind: mealAllowanceEvents.kind,
      at: mealAllowanceEvents.createdAt,
      actorName: users.fullName,
      actorTitle: users.title,
      fromDays: mealAllowanceEvents.fromDays,
      toDays: mealAllowanceEvents.toDays,
      note: mealAllowanceEvents.note,
    })
    .from(mealAllowanceEvents)
    .leftJoin(users, eq(users.id, mealAllowanceEvents.actorId))
    .where(eq(mealAllowanceEvents.rowId, rowId))
    // Enum `kind` khai theo thứ tự các bước, nên hai dòng cùng thời điểm vẫn đứng đúng thứ tự.
    .orderBy(asc(mealAllowanceEvents.createdAt), asc(mealAllowanceEvents.kind), asc(mealAllowanceEvents.id));
  return rows.map(({ at, actorName, actorTitle, ...r }) => ({
    ...r,
    at: at.toISOString(),
    actorName: actorName ?? "",
    actorTitle: actorTitle ?? "",
  }));
}

const addEvent = (
  conn: Pick<typeof db, "insert">,
  rowId: string,
  kind: MealEventKind,
  actorId: string,
  extra: { fromDays?: number | null; toDays?: number | null; note?: string } = {},
) => conn.insert(mealAllowanceEvents).values({ rowId, kind, actorId, createdAt: mealNow(), ...extra });

/** Ghi chỉ khi trạng thái và hai cột số ngày còn y như lúc đọc. Hai cột có NULL nên so bằng `is not distinct from`. */
const sameAsRead = (row: RowRecord) =>
  and(
    eq(mealAllowanceRows.id, row.id),
    eq(mealAllowanceRows.status, row.status),
    sql`${mealAllowanceRows.editedDays} is not distinct from ${row.editedDays}`,
    sql`${mealAllowanceRows.lockedDays} is not distinct from ${row.lockedDays}`,
  );

/* ── Danh sách ─────────────────────────────────────────────────────────── */

function headScopeWhere(actor: User): SQL | undefined | false {
  const visibility = recordVisibility(actor, "salary", "approve-meal");
  if (visibility.kind === "all") return undefined;
  if (visibility.kind === "departments") return inArray(mealAllowanceRows.departmentId, visibility.departmentIds);
  if (visibility.kind === "creator")
    return actor.departmentId ? eq(mealAllowanceRows.departmentId, actor.departmentId) : false;
  return false;
}

/** Kế toán xem tháng trước suốt tháng sau; Trưởng phòng xem tháng này trong ngày cuối tháng. */
function defaultMonth(actor: User, now: Date): string {
  const current = businessMonth(now);
  if (!can(actor, "salary", "pay-meal") && mealPhaseOf(current, now) === "head-review") return current;
  return shiftMonth(current, -1);
}

const SORT_COLUMN = { name: users.fullName, department: departments.name } as const;

const zeroCounts = { headPending: 0, waiting: 0, unapproved: 0, approved: 0, processing: 0 };

export async function listMeals(
  actor: User,
  url: URL,
): Promise<{ ok: true; data: MealList } | { ok: false; status: 400 | 403; message: string }> {
  const params = url.searchParams;
  const now = mealNow();
  const month = params.get("month") || defaultMonth(actor, now);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, status: 400, message: "Tháng không hợp lệ." };

  await forwardOverdue(now);
  const phase = mealPhaseOf(month, now);
  const canAccount = can(actor, "salary", "pay-meal");
  const headWhere = headScopeWhere(actor);
  const mode: MealListMode | null =
    canAccount && phase === "accounting" ? "accounting" : headWhere !== false ? "head" : canAccount ? "waiting" : null;
  if (!mode) return { ok: false, status: 403, message: "Bạn không có quyền xem lương ăn ca." };

  await ensureRows(month, now);
  const monthClosed = await isMonthClosed(month);
  const rate = rateOf(month);
  const empty: MealList = {
    month,
    phase,
    mode,
    companyWide: mode !== "head" || headWhere === undefined,
    monthClosed,
    rate,
    page: { rows: [], total: 0 },
    counts: zeroCounts,
  };
  if (mode === "waiting") return { ok: true, data: empty };

  const scope = and(
    eq(mealAllowanceRows.yearMonth, month),
    mode === "accounting" ? undefined : (headWhere as SQL | undefined),
  );
  const status = MealStatus.safeParse(params.get("status"));
  const departmentId = params.get("departmentId") ?? "";
  const where = and(
    scope,
    status.success ? eq(mealAllowanceRows.status, status.data) : undefined,
    /^[0-9a-f-]{36}$/i.test(departmentId) ? eq(mealAllowanceRows.departmentId, departmentId) : undefined,
    staffSearchWhere(params.get("search") ?? ""),
  );
  const { limit, offset, sort, dir } = pageArgsFrom(url, MEAL_SORTS, "name");
  const order = dir === "asc" ? asc : desc;

  const [rows, [{ total }], counts] = await Promise.all([
    db
      .select({
        row: mealAllowanceRows,
        fullName: users.fullName,
        staffCode: users.staffCode,
        title: users.title,
        departmentName: departments.name,
      })
      .from(mealAllowanceRows)
      .innerJoin(users, eq(users.id, mealAllowanceRows.userId))
      .leftJoin(departments, eq(departments.id, mealAllowanceRows.departmentId))
      .where(where)
      .orderBy(order(SORT_COLUMN[sort]), asc(users.fullName), asc(mealAllowanceRows.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(mealAllowanceRows)
      .innerJoin(users, eq(users.id, mealAllowanceRows.userId))
      .leftJoin(departments, eq(departments.id, mealAllowanceRows.departmentId))
      .where(where),
    countsOf(actor, scope),
  ]);

  const basis = await mealBasisFor(
    rows.map((r) => r.row.userId),
    month,
  );

  return {
    ok: true,
    data: {
      ...empty,
      page: {
        total,
        rows: rows.map(({ row, fullName, staffCode, title, departmentName }): MealRow => {
          const allowed = permitted(actor, row, phase, monthClosed);
          const b = basis.get(row.userId);
          const days = daysOf(row, b);
          return {
            id: row.id,
            userId: row.userId,
            fullName,
            staffCode: staffCode ?? "",
            title,
            departmentName: departmentName ?? "",
            left: b ? !b.active : false,
            appDays: b?.appDays ?? null,
            editedDays: row.editedDays,
            days,
            maxDays: b?.maxDays ?? 0,
            amount: Math.round(days * rate),
            status: row.status,
            rejectReason: row.rejectReason,
            canEdit: allowed !== null,
            canApprove: allowed?.approve ?? false,
            canReject: allowed?.reject ?? false,
          };
        }),
      },
      counts,
    },
  };
}

async function countsOf(actor: User, scope: SQL | undefined): Promise<MealList["counts"]> {
  const status = mealAllowanceRows.status;
  const notMine = sql`${mealAllowanceRows.userId} <> ${actor.id}`;
  const [row] = await db
    .select({
      headPending: sql<number>`(count(*) filter (where ${status} = 'pending' and ${notMine}))::int`,
      waiting: sql<number>`(count(*) filter (where ${status} in ('head-approved', 'forwarded') and ${notMine}))::int`,
      unapproved: sql<number>`(count(*) filter (where ${status} in ('head-approved', 'forwarded')))::int`,
      approved: sql<number>`(count(*) filter (where ${status} = 'approved'))::int`,
      processing: sql<number>`(count(*) filter (where ${status} = 'processing'))::int`,
    })
    .from(mealAllowanceRows)
    .where(scope);
  return row ?? zeroCounts;
}

/* ── Một dòng ──────────────────────────────────────────────────────────── */

async function rowWithName(id: string): Promise<{ row: RowRecord; fullName: string } | null> {
  const [found] = await db
    .select({ row: mealAllowanceRows, fullName: users.fullName })
    .from(mealAllowanceRows)
    .innerJoin(users, eq(users.id, mealAllowanceRows.userId))
    .where(eq(mealAllowanceRows.id, id))
    .limit(1);
  return found ?? null;
}

const canRead = (actor: User, row: RowRecord, phase: MealPhase): boolean =>
  row.userId === actor.id ||
  headCovers(actor, row.departmentId) ||
  (phase === "accounting" && can(actor, "salary", "pay-meal"));

async function loadRow(actor: User, id: string) {
  const now = mealNow();
  await forwardOverdue(now);
  const found = await rowWithName(id);
  if (!found) return null;
  const phase = mealPhaseOf(found.row.yearMonth, now);
  if (!canRead(actor, found.row, phase)) return null;
  const monthClosed = await isMonthClosed(found.row.yearMonth);
  const basis = (await mealBasisFor([found.row.userId], found.row.yearMonth)).get(found.row.userId);
  return { ...found, phase, monthClosed, basis, allowed: permitted(actor, found.row, phase, monthClosed) };
}

export async function mealDetail(actor: User, id: string): Promise<MealDetail | null> {
  const loaded = await loadRow(actor, id);
  if (!loaded) return null;
  const { row, fullName, basis } = loaded;
  const days = daysOf(row, basis);
  return {
    id: row.id,
    month: row.yearMonth,
    fullName,
    days,
    amount: Math.round(days * rateOf(row.yearMonth)),
    status: row.status,
    rejectReason: row.rejectReason,
    events: await eventsOf(row.id),
  };
}

type ActResult =
  | { ok: true; as: "head" | "accounting"; fullName: string; month: string }
  | { ok: false; status: 404 | 409; message: string };

export async function updateMealDays(actor: User, id: string, days: number): Promise<ActResult> {
  const loaded = await loadRow(actor, id);
  if (!loaded) return { ok: false, status: 404, message: "Không tìm thấy dòng ăn ca." };
  const { row, fullName, phase, monthClosed, basis, allowed } = loaded;
  if (!allowed) return { ok: false, status: 409, message: refusal(actor, row, phase, monthClosed) };
  const maxDays = basis?.maxDays ?? 0;
  if (days > maxDays) return { ok: false, status: 409, message: `Tối đa ${formatPoints(maxDays)} ngày.` };

  const before = daysOf(row, basis);
  if (row.editedDays !== days) {
    const done = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(mealAllowanceRows)
        .set({ editedDays: days, updatedAt: mealNow() })
        .where(sameAsRead(row))
        .returning({ id: mealAllowanceRows.id });
      if (!updated) return false;
      await addEvent(tx, row.id, "edit", actor.id, { fromDays: before, toDays: days });
      return true;
    });
    if (!done) return { ok: false, status: 409, message: "Dòng ăn ca vừa đổi. Bạn tải lại danh sách." };
  }
  return { ok: true, as: allowed.as, fullName, month: row.yearMonth };
}

export async function actOnMeal(actor: User, id: string, form: MealActionForm): Promise<ActResult> {
  const loaded = await loadRow(actor, id);
  if (!loaded) return { ok: false, status: 404, message: "Không tìm thấy dòng ăn ca." };
  const { row, fullName, phase, monthClosed, basis, allowed } = loaded;
  if (!allowed) return { ok: false, status: 409, message: refusal(actor, row, phase, monthClosed) };
  if (form.action === "approve" && !allowed.approve) return { ok: false, status: 409, message: "Dòng này đã được duyệt." };
  if (form.action === "reject" && !allowed.reject)
    return { ok: false, status: 409, message: "Trưởng phòng sửa số ngày về 0 thay cho không chi." };

  const head = allowed.as === "head";
  const next: MealStatus = form.action === "reject" ? "rejected" : head ? "head-approved" : "approved";
  const kind: MealEventKind = form.action === "reject" ? "reject" : head ? "head-approve" : "approve";
  const reason = form.action === "reject" ? form.reason : "";

  const done = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(mealAllowanceRows)
      .set({ status: next, rejectReason: reason, updatedAt: mealNow() })
      .where(sameAsRead(row))
      .returning({ id: mealAllowanceRows.id });
    if (!updated) return false;
    await addEvent(tx, row.id, kind, actor.id, { toDays: daysOf(row, basis), note: reason });
    return true;
  });
  if (!done) return { ok: false, status: 409, message: "Dòng ăn ca vừa đổi. Bạn tải lại danh sách." };
  return { ok: true, as: allowed.as, fullName, month: row.yearMonth };
}

/* ── Các nút hàng loạt ─────────────────────────────────────────────────── */

type BatchResult = { ok: true; count: number } | { ok: false; message: string };

/** Mốc và khoá tháng của một nút; trả câu báo khi chưa tới lượt hoặc tháng đã chốt. */
async function openFor(month: string, step: "head-review" | "accounting"): Promise<string | null> {
  const now = mealNow();
  await forwardOverdue(now);
  await ensureRows(month, now);
  if (mealPhaseOf(month, now) !== step)
    return step === "head-review"
      ? "Trưởng phòng duyệt trong ngày cuối tháng."
      : "Kế toán xử lý từ 00:00 ngày 1 tháng sau.";
  if (await isMonthClosed(month)) return "Lương tháng này đã chốt, không đổi được dòng ăn ca.";
  return null;
}

/** Duyệt cả phòng: mọi dòng chờ Trưởng phòng trong phạm vi người bấm, trừ dòng của chính họ. */
export async function headApproveAllMeals(actor: User, month: string): Promise<BatchResult> {
  const closed = await openFor(month, "head-review");
  if (closed) return { ok: false, message: closed };
  const headWhere = headScopeWhere(actor);
  if (headWhere === false) return { ok: false, message: "Bạn không có phòng nào để duyệt." };
  return moveAll(actor, and(eq(mealAllowanceRows.yearMonth, month), eq(mealAllowanceRows.status, "pending"), headWhere), "head-approved", "head-approve");
}

/** Duyệt tất cả: mọi dòng chờ kế toán, trừ dòng của chính người bấm. */
export async function approveAllMeals(actor: User, month: string): Promise<BatchResult> {
  const closed = await openFor(month, "accounting");
  if (closed) return { ok: false, message: closed };
  return moveAll(
    actor,
    and(eq(mealAllowanceRows.yearMonth, month), inArray(mealAllowanceRows.status, WAITING)),
    "approved",
    "approve",
  );
}

async function moveAll(actor: User, where: SQL | undefined, next: MealStatus, kind: MealEventKind): Promise<BatchResult> {
  const count = await db.transaction(async (tx) => {
    const moved = await tx
      .update(mealAllowanceRows)
      .set({ status: next, updatedAt: mealNow() })
      .where(and(where, ne(mealAllowanceRows.userId, actor.id)))
      .returning({ id: mealAllowanceRows.id, editedDays: mealAllowanceRows.editedDays });
    if (moved.length > 0)
      await tx
        .insert(mealAllowanceEvents)
        .values(moved.map((r) => ({ rowId: r.id, kind, actorId: actor.id, toDays: r.editedDays, createdAt: mealNow() })));
    return moved.length;
  });
  return { ok: true, count };
}

/**
 * Chuyển Đang xử lý: khoá số ngày đang hiện của mọi dòng Kế toán đã duyệt. Từ
 * đây lương tháng dùng số đã khoá, ngày công đổi sau đó không đổi tiền ăn ca.
 */
export async function markMealsProcessing(actor: User, month: string): Promise<BatchResult> {
  const closed = await openFor(month, "accounting");
  if (closed) return { ok: false, message: closed };
  const scope = eq(mealAllowanceRows.yearMonth, month);
  const { unapproved } = await countsOf(actor, scope);
  if (unapproved > 0)
    return { ok: false, message: `Còn ${unapproved} dòng chờ kế toán duyệt. Bạn duyệt hoặc không chi hết rồi mới chuyển.` };

  const rows = await db
    .select()
    .from(mealAllowanceRows)
    .where(and(scope, eq(mealAllowanceRows.status, "approved")));
  const basis = await mealBasisFor(
    rows.map((r) => r.userId),
    month,
  );
  const count = await db.transaction(async (tx) => {
    let moved = 0;
    for (const row of rows) {
      const days = daysOf(row, basis.get(row.userId));
      const [updated] = await tx
        .update(mealAllowanceRows)
        .set({ status: "processing", lockedDays: days, updatedAt: mealNow() })
        .where(sameAsRead(row))
        .returning({ id: mealAllowanceRows.id });
      if (!updated) continue;
      await addEvent(tx, row.id, "processing", actor.id, { toDays: days });
      moved += 1;
    }
    return moved;
  });
  return { ok: true, count };
}

/** Đã chi ăn ca: ghi mỗi dòng có tiền một khoản `meal` vào lương của chính tháng danh sách. */
export async function markMealsPaid(actor: User, month: string): Promise<BatchResult> {
  const closed = await openFor(month, "accounting");
  if (closed) return { ok: false, message: closed };
  const rate = rateOf(month);
  const count = await db.transaction(async (tx) => {
    // Cùng khoá với Chốt lương, rồi kiểm lại tháng đã chốt bên trong khoá.
    await lockSalaryMonth(tx, month);
    if (await isMonthClosed(month, tx)) return null;
    const rows = await tx
      .select({ id: mealAllowanceRows.id, userId: mealAllowanceRows.userId, lockedDays: mealAllowanceRows.lockedDays })
      .from(mealAllowanceRows)
      .where(and(eq(mealAllowanceRows.yearMonth, month), eq(mealAllowanceRows.status, "processing")))
      .for("update");
    for (const r of rows) {
      const amount = Math.round((r.lockedDays ?? 0) * rate);
      const [adjustment] =
        amount > 0
          ? await tx
              .insert(salaryAdjustments)
              .values({
                userId: r.userId,
                yearMonth: month,
                kind: "meal",
                amount,
                note: `${formatPoints(r.lockedDays ?? 0)} ngày ăn ca`,
                createdBy: actor.id,
                createdAt: mealNow(),
              })
              .returning({ id: salaryAdjustments.id })
          : [null];
      await tx
        .update(mealAllowanceRows)
        .set({ status: "paid", adjustmentId: adjustment?.id ?? null, updatedAt: mealNow() })
        .where(eq(mealAllowanceRows.id, r.id));
      await addEvent(tx, r.id, "paid", actor.id, { toDays: r.lockedDays });
    }
    return rows.length;
  });
  if (count === null) return { ok: false, message: "Lương tháng này đã chốt, không đổi được dòng ăn ca." };
  return { ok: true, count };
}

/**
 * File Excel của kế toán: dòng Đang xử lý có tiền, theo bộ lọc phòng và ô tìm
 * đang xem. Số ngày trong file là số đã khoá, nên file khớp số app ghi lúc Đã chi.
 * Xuất file không đổi trạng thái.
 */
export async function mealExportRows(month: string, filters: URLSearchParams): Promise<MealExportRow[] | string> {
  const now = mealNow();
  await forwardOverdue(now);
  if (mealPhaseOf(month, now) !== "accounting") return "Kế toán xử lý từ 00:00 ngày 1 tháng sau.";
  const rate = rateOf(month);
  const departmentId = filters.get("departmentId") ?? "";
  const rows = await db
    .select({
      id: mealAllowanceRows.id,
      fullName: users.fullName,
      staffCode: users.staffCode,
      title: users.title,
      departmentName: departments.name,
      days: mealAllowanceRows.lockedDays,
      bankAccountNumber: staffProfiles.bankAccountNumber,
      bankName: staffProfiles.bankName,
      bankCode: staffProfiles.bankCode,
    })
    .from(mealAllowanceRows)
    .innerJoin(users, eq(users.id, mealAllowanceRows.userId))
    .leftJoin(departments, eq(departments.id, mealAllowanceRows.departmentId))
    .leftJoin(staffProfiles, eq(staffProfiles.userId, mealAllowanceRows.userId))
    .where(
      and(
        eq(mealAllowanceRows.yearMonth, month),
        eq(mealAllowanceRows.status, "processing"),
        sql`${mealAllowanceRows.lockedDays} > 0`,
        /^[0-9a-f-]{36}$/i.test(departmentId) ? eq(mealAllowanceRows.departmentId, departmentId) : undefined,
        staffSearchWhere(filters.get("search") ?? ""),
      ),
    )
    .orderBy(asc(departments.name), asc(users.fullName));
  return rows.map((r) => {
    const days = r.days ?? 0;
    return {
      ...r,
      staffCode: r.staffCode ?? "",
      departmentName: r.departmentName ?? "",
      days,
      rate,
      amount: Math.round(days * rate),
      bankAccountNumber: r.bankAccountNumber ?? "",
      bankName: r.bankName ?? "",
      bankCode: r.bankCode ?? "",
    };
  });
}
