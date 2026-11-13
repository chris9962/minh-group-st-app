import { z } from 'zod';

/** Tài khoản nhận lương của một nhân viên, ở `staff_profiles`. */
export const StaffPayment = z.object({
  bankAccountNumber: z.string().nullable(),
  bankName: z.string().nullable(),
  bankCode: z.string().nullable(),
});
export type StaffPayment = z.infer<typeof StaffPayment>;

/** Ô để trống thì lưu null. Máy chủ bỏ khoảng trắng trong số tài khoản và mã ngân hàng. */
export const StaffPaymentForm = z.object({
  bankAccountNumber: z
    .string()
    .trim()
    .max(30, 'Số tài khoản tối đa 30 ký tự')
    .regex(/^[\d\s]*$/, 'Số tài khoản chỉ gồm chữ số'),
  bankName: z.string().trim().max(100, 'Tên ngân hàng tối đa 100 ký tự'),
  bankCode: z
    .string()
    .trim()
    .max(20, 'Mã ngân hàng tối đa 20 ký tự')
    .regex(/^[\d\s]*$/, 'Mã ngân hàng chỉ gồm chữ số'),
});
export type StaffPaymentForm = z.infer<typeof StaffPaymentForm>;

const base = (userId: string) => `/api/people/${encodeURIComponent(userId)}/payment`;

async function failMessage(res: Response, fallback: string): Promise<never> {
  const data = (await res.json().catch(() => null)) as { message?: string } | null;
  throw new Error(data?.message?.trim() || fallback);
}

export async function fetchStaffPayment(userId: string): Promise<StaffPayment> {
  const res = await fetch(base(userId));
  if (!res.ok) await failMessage(res, 'Không tải được thông tin thanh toán');
  return StaffPayment.parse(await res.json());
}

export async function saveStaffPayment(userId: string, form: StaffPaymentForm): Promise<StaffPayment> {
  const res = await fetch(base(userId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) await failMessage(res, 'Không lưu được thông tin thanh toán');
  return StaffPayment.parse(await res.json());
}

/** Màn Cá nhân: thông tin thanh toán của chính người đang đăng nhập, chỉ xem. */
export async function fetchMyPayment(): Promise<StaffPayment> {
  const res = await fetch('/api/profile/payment');
  if (!res.ok) await failMessage(res, 'Không tải được thông tin thanh toán');
  return StaffPayment.parse(await res.json());
}
