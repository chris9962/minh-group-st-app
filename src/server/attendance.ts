import { and, asc, between, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  attendanceModeOf,
  CHECK_IN_SLOT,
  SLOT_REQUIRES,
  slotLabel,
  type AttendanceCheck,
  type AttendanceDay,
  type AttendanceDayGroup,
  type AttendanceForm,
  type AttendanceSlot,
  type MyAttendance,
  type RecordAttendanceForm,
} from "@/lib/api/attendance";
import { BUSINESS_TIMEZONE, businessDay, monthRange } from "@/lib/format";
import { recordVisibility, type RecordVisibility } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { closedMonthMessage, isMonthClosed } from "./closedMonths";
import { db, uniqueViolationOf } from "./db/client";
import { attendanceChecks, departments, staffRoster, users } from "./db/schema";
import { placeName } from "./placeName";
import { imageKeyOf, imageUrl } from "./storage";
import { recomputeEmployeeWorkDay } from "./workDays";

/**
 * Tháng cho chấm bù ngày đã qua trong tháng (spec 4.2). Từ 2026-11-01 không
 * tháng nào khớp nên app tự khoá chấm bù.
 */
const BACKFILL_MONTHS = new Set(["2026-10"]);

const backfillOpen = (today: string) => BACKFILL_MONTHS.has(today.slice(0, 7));

const checkColumns = {
  id: attendanceChecks.id,
  userId: attendanceChecks.userId,
  workDate: attendanceChecks.workDate,
  slot: attendanceChecks.slot,
  checkedAt: attendanceChecks.checkedAt,
  photoUrl: attendanceChecks.photoUrl,
  latitude: attendanceChecks.latitude,
  longitude: attendanceChecks.longitude,
  accuracy: attendanceChecks.accuracy,
  place: attendanceChecks.place,
  checkedOutAt: attendanceChecks.checkedOutAt,
};

type CheckRow = Pick<typeof attendanceChecks.$inferSelect, keyof typeof checkColumns> & {
  recordedByName?: string | null;
};

const recorder = alias(users, "recorder");
/** Cột của lượt chấm kèm tên người ghi công; câu đọc phải `leftJoin(recorder, recorderJoin)`. */
const checkWithRecorder = { ...checkColumns, recordedByName: recorder.fullName };
const recorderJoin = eq(recorder.id, attendanceChecks.recordedBy);

/** Cột giữ KHOÁ ảnh trong kho, giao diện cần URL đọc ảnh. */
const toCheck = (row: CheckRow): AttendanceCheck => ({
  id: row.id,
  workDate: row.workDate,
  slot: row.slot,
  checkedAt: row.checkedAt.toISOString(),
  photoUrl: row.photoUrl ? imageUrl(row.photoUrl) : null,
  latitude: row.latitude,
  longitude: row.longitude,
  accuracy: row.accuracy,
  place: row.place,
  recordedByName: row.recordedByName ?? null,
  checkedOutAt: row.checkedOutAt?.toISOString() ?? null,
});

export const canCheckIn = (actor: User): boolean => attendanceModeOf(actor) !== null;

export async function myAttendance(actor: User, month: string): Promise<MyAttendance> {
  const { from, to } = monthRange(month);
  const rows = await db
    .select(checkWithRecorder)
    .from(attendanceChecks)
    .leftJoin(recorder, recorderJoin)
    .where(and(eq(attendanceChecks.userId, actor.id), between(attendanceChecks.workDate, from, to)))
    .orderBy(asc(attendanceChecks.checkedAt));
  const today = businessDay();
  return { month, today, backfill: backfillOpen(today), checks: rows.map(toCheck) };
}

export type AttendanceOutcome = { ok: true; check: AttendanceCheck } | { ok: false; message: string };

/** Chỉ nhận khoá trong thư mục `attendance/`: khoá thư mục khác là ảnh CCCD, ảnh tài khoản ngân hàng. */
function photoKeyOf(url: string): string | null {
  const key = imageKeyOf(url);
  return key?.replace(/^demo\//, "").startsWith("attendance/") ? key : null;
}

/**
 * Giờ lấy từ đồng hồ database, không nhận từ client. Ngày cũng vậy, trừ lượt
 * chấm bù: ngày đó do người dùng chọn, giờ vẫn là giờ lúc bấm. `now()` đứng yên
 * trong một transaction nên ngày dùng để kiểm lượt trước và ngày ghi là một.
 *
 * Lượt ra của mỗi ca chỉ chấm được sau lượt vào cùng ca (`SLOT_REQUIRES`); hai ca
 * sáng và chiều không phụ thuộc nhau. Phòng chấm kiểu `daily` chỉ có lượt điểm danh, không ảnh.
 */
export async function createAttendanceCheck(
  actor: User,
  form: AttendanceForm,
): Promise<AttendanceOutcome> {
  const mode = attendanceModeOf(actor);
  if (mode === "daily" && form.slot !== CHECK_IN_SLOT.key)
    return { ok: false, message: "Bạn chỉ có lượt điểm danh." };
  if (mode === "slots" && form.slot === CHECK_IN_SLOT.key)
    return { ok: false, message: "Lượt chấm công không hợp lệ." };
  const photoKey = mode === "slots" ? photoKeyOf(form.photoUrl) : null;
  if (mode === "slots" && !photoKey) return { ok: false, message: "Ảnh không hợp lệ" };

  const today = businessDay();
  if (form.workDate && form.workDate !== today) {
    const backfillable =
      backfillOpen(today) && form.workDate.slice(0, 7) === today.slice(0, 7) && form.workDate < today;
    if (!backfillable) return { ok: false, message: "Ngày này không chấm bù được." };
  }

  const previous = SLOT_REQUIRES[form.slot];
  // Tra trước khi mở transaction để không giữ kết nối trong lúc chờ dịch vụ ngoài.
  const place = await placeName(form.latitude, form.longitude);

  try {
    const outcome = await db.transaction(async (tx): Promise<AttendanceOutcome> => {
      const workDate =
        form.workDate && form.workDate !== today
          ? sql`${form.workDate}::date`
          : sql`(now() at time zone ${BUSINESS_TIMEZONE})::date`;
      if (previous) {
        const [done] = await tx
          .select({ id: attendanceChecks.id })
          .from(attendanceChecks)
          .where(
            and(
              eq(attendanceChecks.userId, actor.id),
              eq(attendanceChecks.workDate, workDate),
              eq(attendanceChecks.slot, previous),
            ),
          )
          .limit(1);
        if (!done) return { ok: false, message: `Bạn phải chấm ${slotLabel(previous)} trước.` };
      }

      const [row] = await tx
        .insert(attendanceChecks)
        .values({
          userId: actor.id,
          departmentId: actor.departmentId,
          workDate,
          slot: form.slot,
          photoUrl: photoKey,
          latitude: form.latitude,
          longitude: form.longitude,
          accuracy: form.accuracy,
          place,
        })
        .returning(checkColumns);
      return { ok: true, check: toCheck(row) };
    });
    if (outcome.ok) await recomputeEmployeeWorkDay(actor.id, outcome.check.workDate);
    return outcome;
  } catch (e) {
    if (uniqueViolationOf(e) === "attendance_checks_user_day_slot")
      return { ok: false, message: "Lượt này đã chấm công rồi." };
    throw e;
  }
}

const checkScope = (v: RecordVisibility): SQL | undefined => {
  switch (v.kind) {
    case "all":
      return undefined;
    case "departments":
      return inArray(attendanceChecks.departmentId, v.departmentIds);
    case "creator":
      return eq(attendanceChecks.userId, v.userId);
    default:
      return sql`false`;
  }
};

const rosterScope = (v: RecordVisibility): SQL | undefined => {
  switch (v.kind) {
    case "all":
      return undefined;
    case "departments":
      return inArray(staffRoster.departmentId, v.departmentIds);
    case "creator":
      return eq(staffRoster.userId, v.userId);
    default:
      return sql`false`;
  }
};

/**
 * Bảng một ngày, nhóm theo phòng: người của mọi phòng có bật chấm công trong
 * phạm vi, theo nhân sự của tháng chứa ngày đó, cộng người đã chấm công ngày đó
 * mà phòng của họ tháng đó không chấm công.
 */
export async function attendanceDay(actor: User, workDate: string): Promise<AttendanceDay> {
  const visible = recordVisibility(actor, "attendance", "view-detail");
  if (visible.kind === "none") return { workDate, groups: [] };

  const checks = await db
    .select(checkWithRecorder)
    .from(attendanceChecks)
    .leftJoin(recorder, recorderJoin)
    .where(and(eq(attendanceChecks.workDate, workDate), checkScope(visible)))
    .orderBy(asc(attendanceChecks.checkedAt));
  const checkedUserIds = [...new Set(checks.map((c) => c.userId))];

  const people = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      staffCode: users.staffCode,
      departmentId: staffRoster.departmentId,
      departmentName: departments.name,
      mode: staffRoster.attendanceMode,
    })
    .from(users)
    .leftJoin(
      staffRoster,
      and(eq(staffRoster.userId, users.id), eq(staffRoster.yearMonth, workDate.slice(0, 7))),
    )
    .leftJoin(departments, eq(departments.id, staffRoster.departmentId))
    .where(
      or(
        and(isNotNull(staffRoster.attendanceMode), eq(staffRoster.active, true), rosterScope(visible)),
        checkedUserIds.length > 0 ? inArray(users.id, checkedUserIds) : undefined,
      ),
    );

  type Group = Omit<AttendanceDayGroup, "mode"> & { mode: AttendanceDayGroup["mode"] | null };
  const groups = new Map<string, Group>();
  for (const p of people.sort((a, b) => a.fullName.localeCompare(b.fullName, "vi"))) {
    const key = p.departmentId ?? "";
    const group = groups.get(key) ?? {
      departmentId: p.departmentId ?? null,
      departmentName: p.departmentName ?? "",
      mode: p.mode ?? null,
      rows: [],
    };
    group.rows.push({
      userId: p.userId,
      fullName: p.fullName,
      staffCode: p.staffCode,
      checks: checks.filter((c) => c.userId === p.userId).map(toCheck),
    });
    groups.set(key, group);
  }

  // Phòng không chấm công tháng đó mà có người có lượt: đoán cách chấm theo mọi lượt của nhóm.
  const inferredMode = (g: Group): AttendanceDayGroup["mode"] =>
    g.rows.some((r) => r.checks.some((c) => c.slot !== CHECK_IN_SLOT.key)) ? "slots" : "daily";

  return {
    workDate,
    groups: [...groups.values()]
      .map((g) => ({ ...g, mode: g.mode ?? inferredMode(g) }))
      .sort(
        (a, b) =>
          Number(a.departmentId === null) - Number(b.departmentId === null) ||
          a.departmentName.localeCompare(b.departmentName, "vi"),
      ),
  };
}

export type RecordOutcome =
  | { ok: true; checks: AttendanceCheck[]; fullName: string }
  | { ok: false; message: string };

/**
 * Ghi công thay nhân viên (chốt 2026-10-30). Lượt ghi nằm chung bảng với lượt tự
 * chấm nên ngày công tính cùng luật. Chỉ thêm lượt còn thiếu: lượt nhân viên tự
 * chấm giữ nguyên. Giờ là giờ người ghi nhập, theo giờ Việt Nam của ngày được ghi.
 *
 * Cách chấm và phòng lấy theo nhân sự của tháng chứa ngày đó, cùng nguồn với bảng
 * chấm công theo ngày.
 */
export async function recordAttendance(actor: User, form: RecordAttendanceForm): Promise<RecordOutcome> {
  if (form.workDate > businessDay()) return { ok: false, message: "Không ghi công cho ngày chưa tới." };
  const month = form.workDate.slice(0, 7);
  if (await isMonthClosed(month)) return { ok: false, message: closedMonthMessage(month) };

  const [person] = await db
    .select({ fullName: users.fullName, departmentId: staffRoster.departmentId, mode: staffRoster.attendanceMode })
    .from(users)
    .innerJoin(staffRoster, and(eq(staffRoster.userId, users.id), eq(staffRoster.yearMonth, month)))
    .where(eq(users.id, form.userId))
    .limit(1);
  if (!person?.mode) return { ok: false, message: "Phòng của nhân viên này không chấm công trong tháng đó." };

  const scope = recordVisibility(actor, "attendance", "record-attendance");
  const inScope =
    scope.kind === "all" ||
    (scope.kind === "departments" && person.departmentId !== null && scope.departmentIds.includes(person.departmentId)) ||
    (scope.kind === "creator" && form.userId === actor.id);
  if (!inScope) return { ok: false, message: "Nhân viên này ngoài phạm vi ghi công của bạn." };

  const at = (time: string) => sql`(${form.workDate}::date + ${time}::time) at time zone ${BUSINESS_TIMEZONE}`;
  type Wanted = { slot: AttendanceSlot; time: string; outTime?: string };
  const wanted: Wanted[] =
    person.mode === "daily"
      ? form.day
        ? [{ slot: "check-in", time: form.day.from, outTime: form.day.to }]
        : []
      : [
          ...(form.morning
            ? [
                { slot: "morning-in" as const, time: form.morning.from },
                { slot: "noon-out" as const, time: form.morning.to },
              ]
            : []),
          ...(form.afternoon
            ? [
                { slot: "afternoon-in" as const, time: form.afternoon.from },
                { slot: "afternoon-out" as const, time: form.afternoon.to },
              ]
            : []),
        ];
  if (wanted.length === 0) return { ok: false, message: "Chọn ít nhất một ca để ghi công." };

  const inserted = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ slot: attendanceChecks.slot })
      .from(attendanceChecks)
      .where(and(eq(attendanceChecks.userId, form.userId), eq(attendanceChecks.workDate, form.workDate)));
    const have = new Set(existing.map((e) => e.slot));
    const missing = wanted.filter((w) => !have.has(w.slot));
    if (missing.length === 0) return [];
    return tx
      .insert(attendanceChecks)
      .values(
        missing.map((w) => ({
          userId: form.userId,
          departmentId: person.departmentId,
          workDate: form.workDate,
          slot: w.slot,
          checkedAt: at(w.time),
          checkedOutAt: w.outTime ? at(w.outTime) : null,
          recordedBy: actor.id,
          recordedAt: sql`now()`,
        })),
      )
      .onConflictDoNothing()
      .returning(checkColumns);
  });
  if (inserted.length === 0) return { ok: false, message: "Các ca đã chọn đã đủ lượt chấm." };

  await recomputeEmployeeWorkDay(form.userId, form.workDate);
  return {
    ok: true,
    fullName: person.fullName,
    checks: inserted.map((row) => toCheck({ ...row, recordedByName: actor.fullName })),
  };
}
