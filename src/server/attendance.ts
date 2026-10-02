import { and, asc, between, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  ATTENDANCE_SLOTS,
  type AttendanceCheck,
  type AttendanceDay,
  type AttendanceForm,
  type MyAttendance,
} from "@/lib/api/attendance";
import { BUSINESS_TIMEZONE, businessDay, monthRange } from "@/lib/format";
import { recordVisibility, type RecordVisibility } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { db, uniqueViolationOf } from "./db/client";
import { attendanceChecks, staffRoster, users } from "./db/schema";
import { placeName } from "./placeName";
import { imageKeyOf, imageUrl } from "./storage";

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
};

type CheckRow = Pick<typeof attendanceChecks.$inferSelect, keyof typeof checkColumns>;

/** Cột giữ KHOÁ ảnh trong kho, giao diện cần URL đọc ảnh. */
const toCheck = (row: CheckRow): AttendanceCheck => ({
  id: row.id,
  workDate: row.workDate,
  slot: row.slot,
  checkedAt: row.checkedAt.toISOString(),
  photoUrl: imageUrl(row.photoUrl),
  latitude: row.latitude,
  longitude: row.longitude,
  accuracy: row.accuracy,
  place: row.place,
});

export const canCheckIn = (actor: User): boolean => actor.salaryScheme === "atm";

export async function myAttendance(actor: User, month: string): Promise<MyAttendance> {
  const { from, to } = monthRange(month);
  const rows = await db
    .select(checkColumns)
    .from(attendanceChecks)
    .where(and(eq(attendanceChecks.userId, actor.id), between(attendanceChecks.workDate, from, to)))
    .orderBy(asc(attendanceChecks.checkedAt));
  return { month, today: businessDay(), checks: rows.map(toCheck) };
}

export type AttendanceOutcome = { ok: true; check: AttendanceCheck } | { ok: false; message: string };

/** Chỉ nhận khoá trong thư mục `attendance/`: khoá thư mục khác là ảnh CCCD, ảnh tài khoản ngân hàng. */
function photoKeyOf(url: string): string | null {
  const key = imageKeyOf(url);
  return key?.replace(/^demo\//, "").startsWith("attendance/") ? key : null;
}

/**
 * Giờ và ngày lấy từ đồng hồ database, không nhận từ client. `now()` đứng yên
 * trong một transaction nên ngày dùng để kiểm lượt trước và ngày ghi là một.
 *
 * Bốn lượt đi đúng thứ tự: lượt trước chưa chấm thì không chấm được lượt sau.
 */
export async function createAttendanceCheck(
  actor: User,
  form: AttendanceForm,
): Promise<AttendanceOutcome> {
  const photoKey = photoKeyOf(form.photoUrl);
  if (!photoKey) return { ok: false, message: "Ảnh không hợp lệ" };

  const index = ATTENDANCE_SLOTS.findIndex((s) => s.key === form.slot);
  const previous = index > 0 ? ATTENDANCE_SLOTS[index - 1] : null;
  // Tra trước khi mở transaction để không giữ kết nối trong lúc chờ dịch vụ ngoài.
  const place = await placeName(form.latitude, form.longitude);

  try {
    return await db.transaction(async (tx): Promise<AttendanceOutcome> => {
      const workDate = sql`(now() at time zone ${BUSINESS_TIMEZONE})::date`;
      if (previous) {
        const [done] = await tx
          .select({ id: attendanceChecks.id })
          .from(attendanceChecks)
          .where(
            and(
              eq(attendanceChecks.userId, actor.id),
              eq(attendanceChecks.workDate, workDate),
              eq(attendanceChecks.slot, previous.key),
            ),
          )
          .limit(1);
        if (!done) return { ok: false, message: `Bạn phải chấm ${previous.label} trước.` };
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
 * Bảng một ngày: mọi nhân viên Điểm ATM trong phạm vi theo nhân sự của tháng
 * chứa ngày đó, cộng người đã chấm công ngày đó mà nay không còn ở nhóm ATM.
 */
export async function attendanceDay(actor: User, workDate: string): Promise<AttendanceDay> {
  const visible = recordVisibility(actor, "attendance", "view-detail");
  if (visible.kind === "none") return { workDate, rows: [] };

  const checks = await db
    .select(checkColumns)
    .from(attendanceChecks)
    .where(and(eq(attendanceChecks.workDate, workDate), checkScope(visible)))
    .orderBy(asc(attendanceChecks.checkedAt));
  const checkedUserIds = [...new Set(checks.map((c) => c.userId))];

  const people = await db
    .select({ userId: users.id, fullName: users.fullName, staffCode: users.staffCode })
    .from(users)
    .leftJoin(
      staffRoster,
      and(eq(staffRoster.userId, users.id), eq(staffRoster.yearMonth, workDate.slice(0, 7))),
    )
    .where(
      or(
        and(
          eq(staffRoster.salaryScheme, "atm"),
          eq(staffRoster.active, true),
          rosterScope(visible),
        ),
        checkedUserIds.length > 0 ? inArray(users.id, checkedUserIds) : undefined,
      ),
    );

  return {
    workDate,
    rows: people
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "vi"))
      .map((p) => ({
        ...p,
        checks: checks.filter((c) => c.userId === p.userId).map(toCheck),
      })),
  };
}
