import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import {
  ADVANCE_DAY,
  ADVANCE_HEAD_CLOSE_HOUR,
  ADVANCE_MAX,
  ADVANCE_SORTS,
  ADVANCE_SUBMIT_CLOSE_HOUR,
  AdvanceStatus,
  type AdvanceActionForm,
  type AdvanceDetail,
  type AdvanceEvent,
  type AdvanceEventKind,
  type AdvanceExportRow,
  type AdvanceList,
  type AdvanceListMode,
  type AdvancePhase,
  type AdvanceRow,
  type MyAdvance,
} from "@/lib/api/salaryAdvances";
import { BUSINESS_TIMEZONE, businessDay, businessMonth } from "@/lib/format";
import { can, recordVisibility } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { isMonthClosed, lockSalaryMonth } from "./closedMonths";
import { db } from "./db/client";
import {
  departments,
  salaryAdjustments,
  salaryAdvanceEvents,
  salaryAdvanceRequests,
  staffRoster,
  users,
} from "./db/schema";
import { pageArgsFrom } from "./pagination";
import { staffSearchWhere } from "./people";
import { salaryForUsers } from "./salary";

/**
 * Tạm ứng lương (chủ dự án chốt 2026-11-01, tờ trình ở
 * `docs/quy-trinh-tam-ung-luong-2026-11-01.html`):
 *
 *   ngày 10 trước 12:00   nhân viên gửi và sửa yêu cầu, tối đa `ADVANCE_MAX`
 *   ngày 10 trước 13:00   Trưởng phòng sửa số tiền, duyệt hoặc từ chối
 *   13:00 ngày 10         yêu cầu Trưởng phòng chưa duyệt thành "Hết hạn duyệt"
 *   từ 13:00 ngày 10      kế toán sửa, duyệt, từ chối, xuất Excel, bấm Đã chi tạm ứng
 *
 * Mốc giờ đổi 2026-11-10; trước đó là 22:00, 23:59 và 00:00 ngày 11.
 * Không có job chạy lúc 13:00: mọi đường đọc và ghi gọi `expireOverdue` trước,
 * nên yêu cầu quá hạn đổi trạng thái ngay lần đầu có người mở sau mốc đó.
 */

/** Trạng thái kế toán thấy: từ lúc Trưởng phòng đã duyệt trở đi. */
const ACCOUNTING_STATUSES: AdvanceStatus[] = ["head-approved", "approved", "rejected", "processing", "paid"];

/**
 * Giờ hiện tại của luồng tạm ứng, dùng cho cả mốc giờ lẫn mọi cột thời gian ghi
 * xuống. `SALARY_ADVANCE_NOW` (chuỗi ISO) đặt giờ giả để thử luồng ngoài ngày
 * 10; chỉ đặt ở máy local và testapp.
 */
export function advanceNow(): Date {
  const fake = process.env.SALARY_ADVANCE_NOW;
  const at = fake ? new Date(fake) : null;
  return at && !Number.isNaN(at.getTime()) ? at : new Date();
}

const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIMEZONE, hour: "2-digit", hourCycle: "h23" });

export function advancePhaseOf(month: string, now: Date): AdvancePhase {
  const today = businessDay(now);
  const current = today.slice(0, 7);
  if (month < current) return "accounting";
  if (month > current) return "before";
  const day = Number(today.slice(8, 10));
  if (day < ADVANCE_DAY) return "before";
  if (day > ADVANCE_DAY) return "accounting";
  const hour = Number(hourFormat.format(now));
  if (hour < ADVANCE_SUBMIT_CLOSE_HOUR) return "submit";
  return hour < ADVANCE_HEAD_CLOSE_HOUR ? "head-review" : "accounting";
}

/** Yêu cầu chưa được Trưởng phòng duyệt khi đã qua 13:00 ngày 10 thì thành "Hết hạn duyệt". */
async function expireOverdue(now: Date): Promise<void> {
  const current = businessMonth(now);
  const month = salaryAdvanceRequests.yearMonth;
  const overdue = advancePhaseOf(current, now) === "accounting" ? sql`${month} <= ${current}` : sql`${month} < ${current}`;
  await db.transaction(async (tx) => {
    const expired = await tx
      .update(salaryAdvanceRequests)
      .set({ status: "expired", updatedAt: now })
      .where(and(eq(salaryAdvanceRequests.status, "pending"), overdue))
      .returning({
        id: salaryAdvanceRequests.id,
        departmentId: salaryAdvanceRequests.departmentId,
        yearMonth: salaryAdvanceRequests.yearMonth,
      });
    if (expired.length === 0) return;

    // Trưởng phòng của đúng tháng đó (AGENTS.md §5.3), không phải người đang giữ chức lúc có người mở trang.
    const departmentIds = [...new Set(expired.flatMap((r) => (r.departmentId ? [r.departmentId] : [])))];
    const months = [...new Set(expired.map((r) => r.yearMonth))];
    const heads =
      departmentIds.length > 0
        ? await tx
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
    await tx.insert(salaryAdvanceEvents).values(
      expired.map((r) => {
        const names = heads
          .filter((h) => h.departmentId === r.departmentId && h.yearMonth === r.yearMonth)
          .map((h) => h.fullName);
        return {
          requestId: r.id,
          kind: "expire" as const,
          note: names.length > 0 ? `Trưởng phòng phụ trách: ${names.join(", ")}` : "",
          createdAt: headDeadlineOf(r.yearMonth),
        };
      }),
    );
  });
}

/** 13:00 ngày 10 giờ Việt Nam của tháng: mốc yêu cầu chưa duyệt thành Hết hạn duyệt. */
const headDeadlineOf = (month: string): Date =>
  new Date(`${month}-${String(ADVANCE_DAY).padStart(2, "0")}T${String(ADVANCE_HEAD_CLOSE_HOUR).padStart(2, "0")}:00:00+07:00`);

const HEAD_CLOSE_LABEL = `${ADVANCE_HEAD_CLOSE_HOUR}:00 ngày ${ADVANCE_DAY}`;

/** Trưởng phòng duyệt yêu cầu của phòng này được. Phạm vi `own` hiểu là phòng của chính họ, như màn Phát phôi. */
function headCovers(actor: User, departmentId: string | null): boolean {
  if (!departmentId) return false;
  const visibility = recordVisibility(actor, "staff", "approve-advance");
  if (visibility.kind === "all") return true;
  if (visibility.kind === "departments") return visibility.departmentIds.includes(departmentId);
  if (visibility.kind === "creator") return departmentId === actor.departmentId;
  return false;
}

/** Không ai tự duyệt yêu cầu của mình: Trưởng phòng và người không thuộc phòng nào gửi thì đi thẳng tới kế toán. */
const skipsHeadStep = (actor: User): boolean => !actor.departmentId || headCovers(actor, actor.departmentId);

type RequestRow = typeof salaryAdvanceRequests.$inferSelect;

type Permitted = { as: "head" | "accounting"; approve: boolean } | null;

function permitted(actor: User, row: RequestRow, phase: AdvancePhase, monthClosed: boolean): Permitted {
  if (
    row.status === "pending" &&
    (phase === "submit" || phase === "head-review") &&
    row.userId !== actor.id &&
    headCovers(actor, row.departmentId)
  )
    return { as: "head", approve: true };
  if (
    (row.status === "head-approved" || row.status === "approved") &&
    phase === "accounting" &&
    !monthClosed &&
    row.userId !== actor.id &&
    can(actor, "system", "close-salary")
  )
    return { as: "accounting", approve: row.status === "head-approved" };
  return null;
}

function refusal(row: RequestRow, phase: AdvancePhase, monthClosed: boolean): string {
  if (monthClosed) return "Tháng này đã chốt lương, không đổi được yêu cầu tạm ứng.";
  if (row.status === "pending" && phase === "accounting") return `Yêu cầu đã hết hạn duyệt lúc ${HEAD_CLOSE_LABEL}.`;
  if (row.status === "head-approved" && phase !== "accounting") return `Kế toán xử lý yêu cầu từ ${HEAD_CLOSE_LABEL}.`;
  return "Yêu cầu vừa đổi trạng thái. Bạn tải lại danh sách.";
}

async function eventsOf(requestIds: string[]): Promise<Map<string, AdvanceEvent[]>> {
  const out = new Map<string, AdvanceEvent[]>(requestIds.map((id) => [id, []]));
  if (requestIds.length === 0) return out;
  const rows = await db
    .select({
      id: salaryAdvanceEvents.id,
      requestId: salaryAdvanceEvents.requestId,
      kind: salaryAdvanceEvents.kind,
      at: salaryAdvanceEvents.createdAt,
      actorName: users.fullName,
      actorTitle: users.title,
      fromAmount: salaryAdvanceEvents.fromAmount,
      toAmount: salaryAdvanceEvents.toAmount,
      note: salaryAdvanceEvents.note,
    })
    .from(salaryAdvanceEvents)
    .leftJoin(users, eq(users.id, salaryAdvanceEvents.actorId))
    .where(inArray(salaryAdvanceEvents.requestId, requestIds))
    // Enum `kind` khai theo thứ tự các bước, nên hai dòng cùng thời điểm vẫn đứng đúng thứ tự gửi, duyệt, chi.
    .orderBy(asc(salaryAdvanceEvents.createdAt), asc(salaryAdvanceEvents.kind), asc(salaryAdvanceEvents.id));
  for (const { requestId, at, actorName, actorTitle, ...r } of rows)
    out.get(requestId)?.push({
      ...r,
      at: at.toISOString(),
      actorName: actorName ?? "",
      actorTitle: actorTitle ?? "",
    });
  return out;
}

async function detailOf(row: RequestRow, fullName: string): Promise<AdvanceDetail> {
  return {
    id: row.id,
    month: row.yearMonth,
    fullName,
    amount: row.amount,
    status: row.status,
    rejectReason: row.rejectReason,
    events: (await eventsOf([row.id])).get(row.id) ?? [],
  };
}

const addEvent = (
  conn: Pick<typeof db, "insert">,
  requestId: string,
  kind: AdvanceEventKind,
  actorId: string | null,
  extra: { fromAmount?: number; toAmount?: number; note?: string } = {},
) => conn.insert(salaryAdvanceEvents).values({ requestId, kind, actorId, createdAt: advanceNow(), ...extra });

/* ── Nhân viên ─────────────────────────────────────────────────────────── */

async function ownRequest(actor: User, month: string): Promise<RequestRow | null> {
  const [row] = await db
    .select()
    .from(salaryAdvanceRequests)
    .where(and(eq(salaryAdvanceRequests.userId, actor.id), eq(salaryAdvanceRequests.yearMonth, month)))
    .limit(1);
  return row ?? null;
}

const ownEditable = (actor: User, row: RequestRow, phase: AdvancePhase): boolean =>
  phase === "submit" && (row.status === "pending" || (row.status === "head-approved" && skipsHeadStep(actor)));

export async function myAdvance(actor: User): Promise<MyAdvance> {
  const now = advanceNow();
  await expireOverdue(now);
  const month = businessMonth(now);
  const phase = advancePhaseOf(month, now);
  const row = await ownRequest(actor, month);
  return {
    month,
    phase,
    canCreate: phase === "submit" && !row,
    canEdit: row !== null && ownEditable(actor, row, phase),
    request: row ? await detailOf(row, actor.fullName) : null,
  };
}

type Outcome = { ok: true } | { ok: false; message: string };

export async function createMyAdvance(actor: User, amount: number): Promise<Outcome> {
  const now = advanceNow();
  const month = businessMonth(now);
  if (advancePhaseOf(month, now) !== "submit")
    return { ok: false, message: `Bạn gửi yêu cầu tạm ứng trong ngày ${ADVANCE_DAY}, trước ${ADVANCE_SUBMIT_CLOSE_HOUR}:00.` };
  if (amount > ADVANCE_MAX) return { ok: false, message: `Tối đa ${ADVANCE_MAX.toLocaleString("vi-VN")} đ.` };

  const skip = skipsHeadStep(actor);
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(salaryAdvanceRequests)
      .values({
        userId: actor.id,
        yearMonth: month,
        departmentId: actor.departmentId,
        amount,
        status: skip ? "head-approved" : "pending",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: salaryAdvanceRequests.id });
    if (!inserted) return { ok: false, message: "Bạn đã gửi yêu cầu tạm ứng của tháng này." };
    await addEvent(tx, inserted.id, "create", actor.id, {
      toAmount: amount,
      note: skip ? "Không qua bước Trưởng phòng duyệt." : "",
    });
    return { ok: true };
  });
}

export async function editMyAdvance(actor: User, amount: number): Promise<Outcome> {
  const now = advanceNow();
  await expireOverdue(now);
  const month = businessMonth(now);
  const row = await ownRequest(actor, month);
  if (!row) return { ok: false, message: "Bạn chưa gửi yêu cầu tạm ứng của tháng này." };
  if (!ownEditable(actor, row, advancePhaseOf(month, now)))
    return { ok: false, message: "Yêu cầu đã được xử lý hoặc đã quá giờ sửa." };
  if (amount > ADVANCE_MAX) return { ok: false, message: `Tối đa ${ADVANCE_MAX.toLocaleString("vi-VN")} đ.` };
  if (amount === row.amount) return { ok: true };
  return changeAmount(actor, row, amount);
}

/** Ghi chỉ khi trạng thái VÀ số tiền còn y như lúc đọc: hai người cùng sửa thì người sau nhận lỗi, không đè lên nhau. */
const sameAsRead = (row: RequestRow) =>
  and(
    eq(salaryAdvanceRequests.id, row.id),
    eq(salaryAdvanceRequests.status, row.status),
    eq(salaryAdvanceRequests.amount, row.amount),
  );

async function changeAmount(actor: User, row: RequestRow, amount: number): Promise<Outcome> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(salaryAdvanceRequests)
      .set({ amount, updatedAt: advanceNow() })
      .where(sameAsRead(row))
      .returning({ id: salaryAdvanceRequests.id });
    if (!updated) return { ok: false, message: "Yêu cầu vừa đổi. Bạn tải lại trang." };
    await addEvent(tx, row.id, "edit", actor.id, { fromAmount: row.amount, toAmount: amount });
    return { ok: true };
  });
}

/* ── Danh sách của Trưởng phòng và kế toán ────────────────────────────── */

function headScopeWhere(actor: User): SQL | undefined | false {
  const visibility = recordVisibility(actor, "staff", "approve-advance");
  if (visibility.kind === "all") return undefined;
  if (visibility.kind === "departments") return inArray(salaryAdvanceRequests.departmentId, visibility.departmentIds);
  if (visibility.kind === "creator")
    return actor.departmentId ? eq(salaryAdvanceRequests.departmentId, actor.departmentId) : false;
  return false;
}

const SORT_COLUMN = {
  createdAt: salaryAdvanceRequests.createdAt,
  name: users.fullName,
  department: departments.name,
  amount: salaryAdvanceRequests.amount,
} as const;

const zeroCounts = { headApproved: 0, approved: 0, processing: 0 };

export async function listAdvances(
  actor: User,
  url: URL,
): Promise<{ ok: true; data: AdvanceList } | { ok: false; status: 400 | 403; message: string }> {
  const params = url.searchParams;
  const month = params.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, status: 400, message: "Tháng không hợp lệ." };

  const now = advanceNow();
  await expireOverdue(now);
  const phase = advancePhaseOf(month, now);
  const canAccount = can(actor, "system", "close-salary");
  const headWhere = headScopeWhere(actor);
  const mode: AdvanceListMode | null =
    canAccount && phase === "accounting" ? "accounting" : headWhere !== false ? "head" : canAccount ? "waiting" : null;
  if (!mode) return { ok: false, status: 403, message: "Bạn không có quyền xem yêu cầu tạm ứng." };

  const monthClosed = await isMonthClosed(month);
  const companyWide = mode !== "head" || headWhere === undefined;
  const empty: AdvanceList = {
    month,
    phase,
    mode,
    companyWide,
    monthClosed,
    page: { rows: [], total: 0 },
    counts: zeroCounts,
  };
  if (mode === "waiting") return { ok: true, data: empty };

  const scope = and(
    eq(salaryAdvanceRequests.yearMonth, month),
    mode === "accounting" ? inArray(salaryAdvanceRequests.status, ACCOUNTING_STATUSES) : (headWhere as SQL | undefined),
  );
  const status = AdvanceStatus.safeParse(params.get("status"));
  const departmentId = params.get("departmentId") ?? "";
  const where = and(
    scope,
    status.success ? eq(salaryAdvanceRequests.status, status.data) : undefined,
    /^[0-9a-f-]{36}$/i.test(departmentId) ? eq(salaryAdvanceRequests.departmentId, departmentId) : undefined,
    staffSearchWhere(params.get("search") ?? ""),
  );
  const { limit, offset, sort, dir } = pageArgsFrom(url, ADVANCE_SORTS, "createdAt");
  const order = dir === "asc" ? asc : desc;

  const base = () =>
    db
      .select({
        request: salaryAdvanceRequests,
        fullName: users.fullName,
        staffCode: users.staffCode,
        departmentName: departments.name,
      })
      .from(salaryAdvanceRequests)
      .innerJoin(users, eq(users.id, salaryAdvanceRequests.userId))
      .leftJoin(departments, eq(departments.id, salaryAdvanceRequests.departmentId));

  const [rows, [{ total }], counts] = await Promise.all([
    base()
      .where(where)
      .orderBy(order(SORT_COLUMN[sort]), asc(salaryAdvanceRequests.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(salaryAdvanceRequests)
      .innerJoin(users, eq(users.id, salaryAdvanceRequests.userId))
      .leftJoin(departments, eq(departments.id, salaryAdvanceRequests.departmentId))
      .where(where),
    countsOf(actor, scope),
  ]);

  const salaries = await salaryForUsers(
    rows.map((r) => r.request.userId),
    month,
  );

  return {
    ok: true,
    data: {
      ...empty,
      page: {
        total,
        rows: rows.map(({ request, fullName, staffCode, departmentName }): AdvanceRow => {
          const allowed = permitted(actor, request, phase, monthClosed);
          return {
            id: request.id,
            userId: request.userId,
            fullName,
            staffCode: staffCode ?? "",
            departmentName: departmentName ?? "",
            amount: request.amount,
            currentSalary: salaries.get(request.userId)?.amount ?? 0,
            status: request.status,
            rejectReason: request.rejectReason,
            createdAt: request.createdAt.toISOString(),
            canEdit: allowed !== null,
            canApprove: allowed?.approve ?? false,
            canReject: allowed !== null,
          };
        }),
      },
      counts,
    },
  };
}

/**
 * Số yêu cầu cho ba nút của kế toán. `headApproved` bỏ yêu cầu của chính người
 * xem: họ không tự duyệt được, nên dòng đó không được tính là việc của họ.
 */
async function countsOf(actor: User, scope: SQL | undefined): Promise<AdvanceList["counts"]> {
  const status = salaryAdvanceRequests.status;
  const [row] = await db
    .select({
      headApproved: sql<number>`(count(*) filter (where ${status} = 'head-approved' and ${salaryAdvanceRequests.userId} <> ${actor.id}))::int`,
      approved: sql<number>`(count(*) filter (where ${status} = 'approved'))::int`,
      processing: sql<number>`(count(*) filter (where ${status} = 'processing'))::int`,
    })
    .from(salaryAdvanceRequests)
    .where(scope);
  return row ?? zeroCounts;
}

/* ── Một yêu cầu ───────────────────────────────────────────────────────── */

async function requestWithName(id: string): Promise<{ row: RequestRow; fullName: string } | null> {
  const [found] = await db
    .select({ row: salaryAdvanceRequests, fullName: users.fullName })
    .from(salaryAdvanceRequests)
    .innerJoin(users, eq(users.id, salaryAdvanceRequests.userId))
    .where(eq(salaryAdvanceRequests.id, id))
    .limit(1);
  return found ?? null;
}

/** Người gửi, Trưởng phòng của phòng đó và kế toán (từ 13:00 ngày 10) đọc được lịch sử của yêu cầu. */
const canRead = (actor: User, row: RequestRow, phase: AdvancePhase): boolean =>
  row.userId === actor.id ||
  headCovers(actor, row.departmentId) ||
  (phase === "accounting" && can(actor, "system", "close-salary") && ACCOUNTING_STATUSES.includes(row.status));

export async function advanceDetail(actor: User, id: string): Promise<AdvanceDetail | null> {
  const now = advanceNow();
  await expireOverdue(now);
  const found = await requestWithName(id);
  if (!found || !canRead(actor, found.row, advancePhaseOf(found.row.yearMonth, now))) return null;
  return detailOf(found.row, found.fullName);
}

type ActResult =
  | { ok: true; as: "head" | "accounting"; fullName: string; month: string }
  | { ok: false; status: 404 | 409; message: string };

async function loadForAction(actor: User, id: string) {
  const now = advanceNow();
  await expireOverdue(now);
  const found = await requestWithName(id);
  if (!found) return null;
  const phase = advancePhaseOf(found.row.yearMonth, now);
  if (!canRead(actor, found.row, phase)) return null;
  const monthClosed = await isMonthClosed(found.row.yearMonth);
  return { ...found, phase, monthClosed, allowed: permitted(actor, found.row, phase, monthClosed) };
}

export async function updateAdvanceAmount(actor: User, id: string, amount: number): Promise<ActResult> {
  const loaded = await loadForAction(actor, id);
  if (!loaded) return { ok: false, status: 404, message: "Không tìm thấy yêu cầu tạm ứng." };
  const { row, fullName, phase, monthClosed, allowed } = loaded;
  if (!allowed) return { ok: false, status: 409, message: refusal(row, phase, monthClosed) };
  if (amount > ADVANCE_MAX) return { ok: false, status: 409, message: `Tối đa ${ADVANCE_MAX.toLocaleString("vi-VN")} đ.` };
  if (amount !== row.amount) {
    const changed = await changeAmount(actor, row, amount);
    if (!changed.ok) return { ok: false, status: 409, message: changed.message };
  }
  return { ok: true, as: allowed.as, fullName, month: row.yearMonth };
}

export async function actOnAdvance(actor: User, id: string, form: AdvanceActionForm): Promise<ActResult> {
  const loaded = await loadForAction(actor, id);
  if (!loaded) return { ok: false, status: 404, message: "Không tìm thấy yêu cầu tạm ứng." };
  const { row, fullName, phase, monthClosed, allowed } = loaded;
  if (!allowed) return { ok: false, status: 409, message: refusal(row, phase, monthClosed) };

  const head = allowed.as === "head";
  if (form.action === "approve") {
    if (!allowed.approve) return { ok: false, status: 409, message: "Yêu cầu này đã được duyệt." };
    // Người duyệt chịu trách nhiệm về đúng số tiền họ thấy; nhân viên vừa sửa thì phải xem lại.
    if (form.amount !== row.amount)
      return { ok: false, status: 409, message: "Số tiền vừa đổi. Bạn tải lại danh sách rồi duyệt lại." };
  }

  const next: AdvanceStatus =
    form.action === "approve" ? (head ? "head-approved" : "approved") : head ? "head-rejected" : "rejected";
  const kind: AdvanceEventKind =
    form.action === "approve" ? (head ? "head-approve" : "approve") : head ? "head-reject" : "reject";
  const reason = form.action === "reject" ? form.reason : "";

  const done = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(salaryAdvanceRequests)
      .set({ status: next, rejectReason: reason, updatedAt: advanceNow() })
      .where(sameAsRead(row))
      .returning({ id: salaryAdvanceRequests.id });
    if (!updated) return false;
    await addEvent(tx, row.id, kind, actor.id, { toAmount: row.amount, note: reason });
    return true;
  });
  if (!done) return { ok: false, status: 409, message: "Yêu cầu vừa đổi. Bạn tải lại danh sách." };
  return { ok: true, as: allowed.as, fullName, month: row.yearMonth };
}

/* ── Các nút của kế toán ────────────────────────────────────────────────── */

type BatchResult = { ok: true; count: number } | { ok: false; message: string };

async function accountingOpen(month: string): Promise<string | null> {
  const now = advanceNow();
  await expireOverdue(now);
  if (advancePhaseOf(month, now) !== "accounting") return `Kế toán xử lý yêu cầu từ ${HEAD_CLOSE_LABEL}.`;
  if (await isMonthClosed(month)) return "Tháng này đã chốt lương, không đổi được yêu cầu tạm ứng.";
  return null;
}

/**
 * Duyệt tất cả: mọi yêu cầu Trưởng phòng đã duyệt, trừ yêu cầu kế toán đã từ
 * chối và trừ yêu cầu của chính người bấm (không ai tự duyệt yêu cầu của mình).
 */
export async function approveAllAdvances(actor: User, month: string): Promise<BatchResult> {
  const closed = await accountingOpen(month);
  if (closed) return { ok: false, message: closed };
  const count = await db.transaction(async (tx) => {
    const moved = await tx
      .update(salaryAdvanceRequests)
      .set({ status: "approved", updatedAt: advanceNow() })
      .where(
        and(
          eq(salaryAdvanceRequests.yearMonth, month),
          eq(salaryAdvanceRequests.status, "head-approved"),
          ne(salaryAdvanceRequests.userId, actor.id),
        ),
      )
      .returning({ id: salaryAdvanceRequests.id, amount: salaryAdvanceRequests.amount });
    if (moved.length > 0)
      await tx.insert(salaryAdvanceEvents).values(
        moved.map((r) => ({
          requestId: r.id,
          kind: "approve" as const,
          actorId: actor.id,
          toAmount: r.amount,
          createdAt: advanceNow(),
        })),
      );
    return moved.length;
  });
  return { ok: true, count };
}

/**
 * Chuyển mọi yêu cầu Đã duyệt của tháng sang Đang xử lý. Nút riêng, không gắn
 * với Xuất Excel (chủ dự án chốt 2026-11-10).
 */
export async function markAdvancesProcessing(actor: User, month: string): Promise<BatchResult> {
  const closed = await accountingOpen(month);
  if (closed) return { ok: false, message: closed };
  const count = await db.transaction(async (tx) => {
    const moved = await tx
      .update(salaryAdvanceRequests)
      .set({ status: "processing", updatedAt: advanceNow() })
      .where(and(eq(salaryAdvanceRequests.yearMonth, month), eq(salaryAdvanceRequests.status, "approved")))
      .returning({ id: salaryAdvanceRequests.id, amount: salaryAdvanceRequests.amount });
    if (moved.length > 0)
      await tx.insert(salaryAdvanceEvents).values(
        moved.map((r) => ({
          requestId: r.id,
          kind: "processing" as const,
          actorId: actor.id,
          toAmount: r.amount,
          createdAt: advanceNow(),
        })),
      );
    return moved.length;
  });
  return { ok: true, count };
}

/** Đã chi tạm ứng: ghi mỗi yêu cầu một dòng ứng trước vào bảng lương, lương cuối cùng trừ số này. */
export async function markAdvancesPaid(actor: User, month: string): Promise<BatchResult> {
  const closed = await accountingOpen(month);
  if (closed) return { ok: false, message: closed };
  const count = await db.transaction(async (tx) => {
    // Cùng khoá với Chốt lương, rồi kiểm lại tháng đã chốt bên trong khoá.
    await lockSalaryMonth(tx, month);
    if (await isMonthClosed(month, tx)) return null;
    const rows = await tx
      .select({ id: salaryAdvanceRequests.id, userId: salaryAdvanceRequests.userId, amount: salaryAdvanceRequests.amount })
      .from(salaryAdvanceRequests)
      .where(and(eq(salaryAdvanceRequests.yearMonth, month), eq(salaryAdvanceRequests.status, "processing")))
      .for("update");
    for (const r of rows) {
      const [adjustment] = await tx
        .insert(salaryAdjustments)
        .values({
          userId: r.userId,
          yearMonth: month,
          kind: "advance",
          amount: r.amount,
          note: "Tạm ứng lương",
          createdBy: actor.id,
          createdAt: advanceNow(),
        })
        .returning({ id: salaryAdjustments.id });
      await tx
        .update(salaryAdvanceRequests)
        .set({ status: "paid", adjustmentId: adjustment.id, updatedAt: advanceNow() })
        .where(eq(salaryAdvanceRequests.id, r.id));
      await addEvent(tx, r.id, "paid", actor.id, { toAmount: r.amount });
    }
    return rows.length;
  });
  if (count === null) return { ok: false, message: "Tháng này đã chốt lương, không đổi được yêu cầu tạm ứng." };
  return { ok: true, count };
}

/**
 * File Excel của kế toán: chỉ yêu cầu Đã duyệt, chưa chuyển Đang xử lý, theo bộ
 * lọc phòng và ô tìm đang xem. Xuất file không đổi trạng thái (chốt 2026-11-10).
 * Còn yêu cầu chờ duyệt thì chưa cho xuất (chốt 2026-11-01).
 */
export async function advanceExportRows(
  actor: User,
  month: string,
  filters: URLSearchParams,
): Promise<AdvanceExportRow[] | string> {
  const now = advanceNow();
  await expireOverdue(now);
  if (advancePhaseOf(month, now) !== "accounting") return `Kế toán xử lý yêu cầu từ ${HEAD_CLOSE_LABEL}.`;
  const waiting = (await countsOf(actor, eq(salaryAdvanceRequests.yearMonth, month))).headApproved;
  if (waiting > 0) return `Còn ${waiting} yêu cầu chờ duyệt. Bạn duyệt hoặc từ chối hết rồi mới xuất.`;

  const departmentId = filters.get("departmentId") ?? "";
  const rows = await db
    .select({
      id: salaryAdvanceRequests.id,
      fullName: users.fullName,
      staffCode: users.staffCode,
      title: users.title,
      departmentName: departments.name,
      amount: salaryAdvanceRequests.amount,
      status: salaryAdvanceRequests.status,
      createdAt: salaryAdvanceRequests.createdAt,
    })
    .from(salaryAdvanceRequests)
    .innerJoin(users, eq(users.id, salaryAdvanceRequests.userId))
    .leftJoin(departments, eq(departments.id, salaryAdvanceRequests.departmentId))
    .where(
      and(
        eq(salaryAdvanceRequests.yearMonth, month),
        eq(salaryAdvanceRequests.status, "approved"),
        /^[0-9a-f-]{36}$/i.test(departmentId) ? eq(salaryAdvanceRequests.departmentId, departmentId) : undefined,
        staffSearchWhere(filters.get("search") ?? ""),
      ),
    )
    .orderBy(asc(departments.name), asc(users.fullName));
  return rows.map((r) => ({
    ...r,
    staffCode: r.staffCode ?? "",
    departmentName: r.departmentName ?? "",
    createdAt: r.createdAt.toISOString(),
  }));
}
