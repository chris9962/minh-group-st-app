import { z } from 'zod';
import { RoleKey } from '@/lib/types';
import { BlankType, DepartmentBlankCell, StaffBlanksForm } from './insuranceBlanks';
import { INT_MAX } from './limits';

/* ── Phiếu thông tin ngân hàng theo tháng (chốt 2026-10-31) ────────────────
 * Cùng luật phôi bảo hiểm: văn phòng cấp phiếu cho phòng, Trưởng phòng và Phó
 * phòng nhập số đã phát và đã sử dụng của từng người, số còn lại cộng dồn qua
 * tháng. Mỗi ngân hàng là một loại phiếu, nên `blankTypeId` ở đây là id ngân hàng.
 */

export const BankDepartmentBlankRow = z.object({
  departmentId: z.string(),
  departmentName: z.string(),
  cells: z.array(DepartmentBlankCell),
});
export type BankDepartmentBlankRow = z.infer<typeof BankDepartmentBlankRow>;

export const BankDepartmentBlanks = z.object({
  month: z.string(),
  editable: z.boolean(),
  types: z.array(BlankType),
  rows: z.array(BankDepartmentBlankRow),
});
export type BankDepartmentBlanks = z.infer<typeof BankDepartmentBlanks>;

export const BankDepartmentBlanksForm = z.object({
  rows: z.array(
    z.object({ departmentId: z.guid(), blankTypeId: z.guid(), quantity: z.number().int().min(0).max(INT_MAX) }),
  ),
});
export type BankDepartmentBlanksForm = z.infer<typeof BankDepartmentBlanksForm>;

/** Phiếu của một người, một ngân hàng, trong tháng đang xem. `used` null là dùng `usedAccounts`. */
export const BankStaffBlankCell = z.object({
  blankTypeId: z.string(),
  opening: z.number(),
  issued: z.number(),
  used: z.number().nullable(),
  usedAccounts: z.number(),
});
export type BankStaffBlankCell = z.infer<typeof BankStaffBlankCell>;

export const BankStaffBlankRow = z.object({
  userId: z.string(),
  fullName: z.string(),
  role: RoleKey,
  cells: z.array(BankStaffBlankCell),
});
export type BankStaffBlankRow = z.infer<typeof BankStaffBlankRow>;

/** `types` chỉ gồm ngân hàng phòng có phiếu trong tháng: ngân hàng 0 phiếu không hiện. */
export const BankStaffBlanks = z.object({
  month: z.string(),
  editable: z.boolean(),
  departmentId: z.string(),
  departments: z.array(z.object({ id: z.string(), name: z.string() })),
  types: z.array(BlankType),
  departmentCells: z.array(DepartmentBlankCell),
  rows: z.array(BankStaffBlankRow),
});
export type BankStaffBlanks = z.infer<typeof BankStaffBlanks>;

export const BankStaffBlanksForm = StaffBlanksForm;
export type BankStaffBlanksForm = z.infer<typeof BankStaffBlanksForm>;

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

export const fetchBankDepartmentBlanks = (month: string) =>
  read(`/api/banking/blanks/departments?month=${month}`, BankDepartmentBlanks, 'phiếu của các phòng');

export const saveBankDepartmentBlanks = (month: string, form: BankDepartmentBlanksForm) =>
  write(`/api/banking/blanks/departments?month=${month}`, form, BankDepartmentBlanks);

export const fetchBankStaffBlanks = (month: string, departmentId: string | null) =>
  read(
    `/api/banking/blanks/staff?month=${month}${departmentId ? `&departmentId=${departmentId}` : ''}`,
    BankStaffBlanks,
    'phiếu của nhân viên',
  );

export const saveBankStaffBlanks = (month: string, departmentId: string, form: BankStaffBlanksForm) =>
  write(`/api/banking/blanks/staff?month=${month}&departmentId=${departmentId}`, form, BankStaffBlanks);
