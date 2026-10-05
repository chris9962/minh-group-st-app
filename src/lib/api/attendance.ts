import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { isRealIsoDate } from '@/lib/types';

/**
 * Chấm công nhân viên Điểm ATM (chốt 2026-10-02): 4 lượt, mỗi lượt một ảnh chụp
 * tại chỗ, tọa độ GPS và giờ máy chủ lúc nhận. Điểm danh Phòng An Sinh (chốt
 * 2026-10-04): 1 lượt, tọa độ GPS và giờ máy chủ, không có ảnh. Từ tháng
 * 2026-10, lượt chấm tạo ngày công.
 */

/** Thứ tự này là thứ tự dòng ở màn nhân viên và cột ở bảng quản lý. */
export const ATTENDANCE_SLOTS = [
  { key: 'morning-in', label: 'Vào ca sáng' },
  { key: 'noon-out', label: 'Ra ca sáng' },
  { key: 'afternoon-in', label: 'Vào ca chiều' },
  { key: 'afternoon-out', label: 'Ra ca chiều' },
] as const;

export const CHECK_IN_SLOT = { key: 'check-in', label: 'Điểm danh' } as const;

export const AttendanceSlot = z.enum(['morning-in', 'noon-out', 'afternoon-in', 'afternoon-out', 'check-in']);
export type AttendanceSlot = z.infer<typeof AttendanceSlot>;

/**
 * Lượt phải chấm trước của mỗi lượt: ca nào cũng vào trước, ra sau. Hai ca không
 * phụ thuộc nhau, nên người chỉ làm ca chiều vẫn chấm được (đổi 2026-10-05).
 */
export const SLOT_REQUIRES: Partial<Record<AttendanceSlot, AttendanceSlot>> = {
  'noon-out': 'morning-in',
  'afternoon-out': 'afternoon-in',
};

export const slotLabel = (slot: AttendanceSlot): string =>
  slot === CHECK_IN_SLOT.key ? CHECK_IN_SLOT.label : (ATTENDANCE_SLOTS.find((s) => s.key === slot)?.label ?? '');

/** `slots`: 4 lượt có ảnh của nhân viên Điểm ATM. `daily`: điểm danh 1 nút của Phòng An Sinh. */
export type AttendanceMode = 'slots' | 'daily';

export const attendanceModeOf = (
  user: { salaryScheme?: string; dailyCheckIn?: boolean } | null,
): AttendanceMode | null => (user?.dailyCheckIn ? 'daily' : user?.salaryScheme === 'atm' ? 'slots' : null);

export const AttendanceCheck = z.object({
  id: z.string(),
  /** `YYYY-MM-DD` theo giờ Việt Nam. */
  workDate: z.string(),
  slot: AttendanceSlot,
  /** Giờ máy chủ, ISO. */
  checkedAt: z.string(),
  /** `/api/images/<key>`. Điểm danh không có ảnh. */
  photoUrl: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  /** Sai số GPS, mét. */
  accuracy: z.number(),
  /** "Xã - Tỉnh" tra từ tọa độ lúc chấm. */
  place: z.string().nullable(),
});
export type AttendanceCheck = z.infer<typeof AttendanceCheck>;

/** Mọi lượt của chính mình trong một tháng `YYYY-MM`. */
export const MyAttendance = z.object({
  month: z.string(),
  /** Ngày của máy chủ, `YYYY-MM-DD`. */
  today: z.string(),
  /** Tháng của `today` cho chấm bù ngày đã qua trong tháng (spec 4.2). */
  backfill: z.boolean(),
  checks: z.array(AttendanceCheck),
});
export type MyAttendance = z.infer<typeof MyAttendance>;

export const AttendanceDayRow = z.object({
  userId: z.string(),
  fullName: z.string(),
  staffCode: z.string().nullable(),
  mode: z.enum(['slots', 'daily']),
  checks: z.array(AttendanceCheck),
});
export type AttendanceDayRow = z.infer<typeof AttendanceDayRow>;

export const AttendanceDay = z.object({
  workDate: z.string(),
  rows: z.array(AttendanceDayRow),
});
export type AttendanceDay = z.infer<typeof AttendanceDay>;

export const AttendanceForm = z.object({
  slot: AttendanceSlot,
  /** Rỗng với điểm danh An Sinh. */
  photoUrl: z.string().trim(),
  /** Ngày chấm bù, `YYYY-MM-DD`. Không gửi là ngày của máy chủ. */
  workDate: z.string().refine(isRealIsoDate).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0),
});
export type AttendanceForm = z.infer<typeof AttendanceForm>;

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return new Error(body?.message?.trim() || fallback);
}

export async function fetchMyAttendance(month: string): Promise<MyAttendance> {
  const res = await fetch(`/api/attendance/mine?${new URLSearchParams({ month })}`);
  if (!res.ok) throw await failure(res, 'Không tải được lượt chấm công');
  return MyAttendance.parse(await res.json());
}

export async function fetchAttendanceDay(workDate: string): Promise<AttendanceDay> {
  const res = await fetch(`/api/attendance?${new URLSearchParams({ date: workDate })}`);
  if (!res.ok) throw await failure(res, 'Không tải được bảng chấm công');
  return AttendanceDay.parse(await res.json());
}

/** Tên xã, tỉnh của tọa độ. `null` khi dịch vụ tra địa danh lỗi. */
export async function fetchPlaceName(latitude: number, longitude: number): Promise<string | null> {
  const res = await fetch(
    `/api/attendance/place?${new URLSearchParams({ lat: String(latitude), lng: String(longitude) })}`,
  );
  if (!res.ok) return null;
  return z.object({ place: z.string().nullable() }).parse(await res.json()).place;
}

/** Ghi lượt vừa chấm vào lịch ngay, không chờ tải lại: nút của lượt đó không hiện lại để bấm lần hai. */
export function addMyCheck(queryClient: QueryClient, check: AttendanceCheck): void {
  queryClient.setQueryData<MyAttendance>(
    ['attendance', 'mine', check.workDate.slice(0, 7)],
    (old) => old && { ...old, checks: [...old.checks, check] },
  );
}

export async function createAttendanceCheck(form: AttendanceForm): Promise<AttendanceCheck> {
  const res = await fetch('/api/attendance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không lưu được lượt chấm công');
  return AttendanceCheck.parse(await res.json());
}
