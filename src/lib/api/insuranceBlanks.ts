import { z } from 'zod';
import { RoleKey } from '@/lib/types';
import { INT_MAX } from './limits';

/* ── Phôi bảo hiểm theo tháng (chốt 2026-10-29) ───────────────────────────
 * Thiết kế: docs/spec-phan-phoi-bao-hiem-2026-10-29.md. Văn phòng cấp phôi cho
 * phòng, Trưởng phòng nhập số đã phát của từng người. Nhân viên hoặc Trưởng phòng
 * báo số còn lại. Số còn lại cộng dồn qua tháng và không chặn việc tạo đơn.
 */

export const BlankType = z.object({ id: z.string(), code: z.string(), name: z.string() });
export type BlankType = z.infer<typeof BlankType>;

/** Số đơn Hoàn thành trong tháng theo 2 loại bảo hiểm. */
export const MixCount = z.object({ electric: z.number(), motorbike: z.number() });
export type MixCount = z.infer<typeof MixCount>;

/** `fromMonth` khác tháng đang xem là tháng đó chưa đặt mục tiêu riêng. */
export const MixTarget = z.object({
  electricParts: z.number(),
  motorbikeParts: z.number(),
  fromMonth: z.string(),
});
export type MixTarget = z.infer<typeof MixTarget>;

/** Phôi của một phòng, một loại phôi, trong tháng đang xem. */
export const DepartmentBlankCell = z.object({
  blankTypeId: z.string(),
  openingUnallocated: z.number(),
  allocated: z.number(),
  issued: z.number(),
  /** Phôi chưa sử dụng người rời phòng trả về phòng trong tháng. */
  returned: z.number(),
});
export type DepartmentBlankCell = z.infer<typeof DepartmentBlankCell>;

/** Phôi phòng còn chưa phát cho ai, tính với số đã phát `issued`. */
export const departmentLeft = (cell: DepartmentBlankCell, allocated: number, issued: number): number =>
  cell.openingUnallocated + allocated - issued + cell.returned;

export const DepartmentBlankRow = z.object({
  departmentId: z.string(),
  departmentName: z.string(),
  cells: z.array(DepartmentBlankCell),
  mix: MixCount,
});
export type DepartmentBlankRow = z.infer<typeof DepartmentBlankRow>;

export const DepartmentBlanks = z.object({
  month: z.string(),
  editable: z.boolean(),
  types: z.array(BlankType),
  target: MixTarget.nullable(),
  rows: z.array(DepartmentBlankRow),
});
export type DepartmentBlanks = z.infer<typeof DepartmentBlanks>;

const count = z.number().int().min(0).max(INT_MAX);
const parts = z.number().int().min(0).max(100);

export const DepartmentBlanksForm = z.object({
  target: z
    .object({ electricParts: parts, motorbikeParts: parts })
    .refine((t) => t.electricParts + t.motorbikeParts > 0, 'Nhập tỉ lệ điện/xe'),
  rows: z.array(z.object({ departmentId: z.guid(), blankTypeId: z.guid(), quantity: count })),
});
export type DepartmentBlanksForm = z.infer<typeof DepartmentBlanksForm>;

/** Phôi của một người, một loại phôi, trong tháng đang xem. `used` null là chưa ai báo số còn lại. */
export const StaffBlankCell = z.object({
  blankTypeId: z.string(),
  opening: z.number(),
  issued: z.number(),
  used: z.number().nullable(),
  /** Phôi chưa sử dụng trả về phòng trong tháng người này rời phòng. */
  returned: z.number(),
  /** Lần báo số còn lại gần nhất, của nhân viên hoặc Trưởng phòng. */
  reportedAt: z.string().nullable(),
});
export type StaffBlankCell = z.infer<typeof StaffBlankCell>;

type Held = Pick<StaffBlankCell, 'opening' | 'issued' | 'used' | 'returned'>;

/** Tổng đã nhận: tồn tháng trước + đã phát − trả lại. */
export const receivedOf = (cell: Held): number => cell.opening + cell.issued - cell.returned;

/** Số người này đang giữ theo lần báo gần nhất. */
export const remainingOf = (cell: Held): number => receivedOf(cell) - (cell.used ?? 0);

export const StaffBlankRow = z.object({
  userId: z.string(),
  fullName: z.string(),
  role: RoleKey,
  title: z.string(),
  cells: z.array(StaffBlankCell),
  /** Đã chuyển sang phòng khác trong tháng: chỉ sửa được số phòng thực nhận lại. */
  movedOut: z.boolean(),
  mix: MixCount,
});
export type StaffBlankRow = z.infer<typeof StaffBlankRow>;

export const StaffBlanks = z.object({
  month: z.string(),
  editable: z.boolean(),
  departmentId: z.string(),
  departments: z.array(z.object({ id: z.string(), name: z.string() })),
  types: z.array(BlankType),
  target: MixTarget.nullable(),
  departmentCells: z.array(DepartmentBlankCell),
  departmentMix: MixCount,
  rows: z.array(StaffBlankRow),
});
export type StaffBlanks = z.infer<typeof StaffBlanks>;

export const StaffBlanksForm = z.object({
  rows: z.array(
    z.object({
      userId: z.guid(),
      blankTypeId: z.guid(),
      /** null là giữ số đang lưu, để màn mở lâu không ghi đè số người khác vừa phát. */
      issued: count.nullable(),
      /** null là giữ số đã báo. Gửi số chỉ khi Trưởng phòng sửa ô Còn lại. */
      remaining: count.nullable(),
      /** `reportedAt` của ô lúc mở màn, để không ghi đè lần báo mới hơn của nhân viên. */
      reportedAt: z.string().nullable(),
    }),
  ),
});
export type StaffBlanksForm = z.infer<typeof StaffBlanksForm>;

/** Phần trăm đơn điện và đơn xe, làm tròn; null khi chưa có đơn nào. */
export function mixPercent(mix: MixCount): { electric: number; motorbike: number } | null {
  const total = mix.electric + mix.motorbike;
  if (total === 0) return null;
  const electric = Math.round((mix.electric * 100) / total);
  return { electric, motorbike: 100 - electric };
}

/** Cảnh báo khi phần đơn điện thấp hơn mục tiêu; vượt mục tiêu thì không báo. */
export function belowTarget(mix: MixCount, target: MixTarget | null): boolean {
  const total = mix.electric + mix.motorbike;
  if (!target || total === 0) return false;
  return mix.electric * (target.electricParts + target.motorbikeParts) < target.electricParts * total;
}

export const targetPercent = (target: MixTarget) =>
  mixPercent({ electric: target.electricParts, motorbike: target.motorbikeParts })!;

async function read<T>(url: string, schema: z.ZodType<T>, what: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? `Không đọc được ${what}`);
  return schema.parse(data);
}

async function write<T>(url: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? 'Không lưu được');
  return schema.parse(data);
}

export const fetchDepartmentBlanks = (month: string) =>
  read(`/api/insurance/blanks/departments?month=${month}`, DepartmentBlanks, 'phôi của các phòng');

export const saveDepartmentBlanks = (month: string, form: DepartmentBlanksForm) =>
  write(`/api/insurance/blanks/departments?month=${month}`, form, DepartmentBlanks);

export const fetchStaffBlanks = (month: string, departmentId: string | null) =>
  read(
    `/api/insurance/blanks/staff?month=${month}${departmentId ? `&departmentId=${departmentId}` : ''}`,
    StaffBlanks,
    'phôi của nhân viên',
  );

export const saveStaffBlanks = (month: string, departmentId: string, form: StaffBlanksForm) =>
  write(`/api/insurance/blanks/staff?month=${month}&departmentId=${departmentId}`, form, StaffBlanks);
