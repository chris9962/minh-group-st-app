import { z } from 'zod';
import { AccountType } from './bankAccounts';
import { INT_MAX } from './limits';

/**
 * Chỉ tiêu tháng theo QĐ 145 (chốt với chủ dự án 2026-09-25).
 *
 * Công thức cộng trừ điểm nằm ở `src/rules/salary/<kỳ>.ts`. Màn này chỉ giữ số
 * chỉ tiêu và danh sách tài khoản tính vào HKD và tài khoản định hướng.
 */

export const QuotaKindItem = z.object({ bankId: z.string(), accountType: AccountType });
export type QuotaKindItem = z.infer<typeof QuotaKindItem>;

export const DepartmentQuota = z.object({
  departmentId: z.string(),
  departmentName: z.string(),
  hkd: z.number().nullable(),
  directed: z.number().nullable(),
  casa: z.number().nullable(),
});
export type DepartmentQuota = z.infer<typeof DepartmentQuota>;

export const QuotaMonth = z.object({
  month: z.string(),
  /** Tháng này chưa lưu lần nào; số liệu là bản chép từ tháng này. `null` = đã lưu, hoặc chưa có tháng nào. */
  copiedFrom: z.string().nullable(),
  /** Lương tháng đã chốt thì không sửa chỉ tiêu tháng đó. */
  locked: z.boolean(),
  staffHkd: z.number().nullable(),
  staffDirected: z.number().nullable(),
  staffCasa: z.number().nullable(),
  departments: z.array(DepartmentQuota),
  hkdKinds: z.array(QuotaKindItem),
  directedKinds: z.array(QuotaKindItem),
});
export type QuotaMonth = z.infer<typeof QuotaMonth>;

const target = z.number().int().min(1).max(INT_MAX).nullable();

export const QuotaMonthForm = z.object({
  staffHkd: target,
  staffDirected: target,
  staffCasa: target,
  departments: z.array(
    z.object({ departmentId: z.guid(), hkd: target, directed: target, casa: target }),
  ),
  hkdKinds: z.array(z.object({ bankId: z.guid(), accountType: AccountType })),
  directedKinds: z.array(z.object({ bankId: z.guid(), accountType: AccountType })),
});
export type QuotaMonthForm = z.infer<typeof QuotaMonthForm>;

export async function fetchQuotaMonth(month: string): Promise<QuotaMonth> {
  const res = await fetch(`/api/settings/quota?month=${month}`);
  if (!res.ok) throw new Error('Không đọc được chỉ tiêu tháng');
  return QuotaMonth.parse(await res.json());
}

export async function saveQuotaMonth(month: string, form: QuotaMonthForm): Promise<QuotaMonth> {
  const res = await fetch(`/api/settings/quota?month=${month}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? 'Không lưu được chỉ tiêu tháng');
  return QuotaMonth.parse(data);
}
