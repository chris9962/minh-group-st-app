import { z } from 'zod';

export const SalaryAdjustmentKind = z.enum(['advance', 'bonus', 'deduction']);
export type SalaryAdjustmentKind = z.infer<typeof SalaryAdjustmentKind>;

export const SALARY_ADJUSTMENT_LABEL: Record<SalaryAdjustmentKind, string> = {
  advance: 'Lương ứng trước',
  bonus: 'Lương thưởng',
  deduction: 'Lương trừ',
};

/** Nhãn nút thêm một lần ghi, theo loại. */
export const SALARY_ADJUSTMENT_ADD_LABEL: Record<SalaryAdjustmentKind, string> = {
  advance: 'Ứng lương',
  bonus: 'Thưởng',
  deduction: 'Trừ lương',
};

export const SalaryAdjustment = z.object({
  id: z.string(),
  kind: SalaryAdjustmentKind,
  /** Đồng, luôn dương. */
  amount: z.number(),
  note: z.string(),
  /** Ngày ghi, YYYY-MM-DD theo giờ Việt Nam. */
  date: z.string(),
  createdByName: z.string(),
  /** Khoản ứng trước sinh ra từ yêu cầu tạm ứng đã chi: không xoá được. Bản chụp chốt trước 2026-11-01 không có trường này. */
  linked: z.boolean().optional(),
});
export type SalaryAdjustment = z.infer<typeof SalaryAdjustment>;

export const adjustmentTotals = (list: SalaryAdjustment[]): Record<SalaryAdjustmentKind, number> => {
  const totals = { advance: 0, bonus: 0, deduction: 0 };
  for (const r of list) totals[r.kind] += r.amount;
  return totals;
};

/** Lương cuối cùng: lương theo điểm + thưởng - trừ - ứng trước. */
export const finalSalaryOf = (salary: number, list: SalaryAdjustment[]): number => {
  const totals = adjustmentTotals(list);
  return salary + totals.bonus - totals.deduction - totals.advance;
};

export const SalaryAdjustmentForm = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  kind: SalaryAdjustmentKind,
  amount: z.number().int().positive().max(1_000_000_000),
  note: z.string().trim().max(500),
});
export type SalaryAdjustmentForm = z.infer<typeof SalaryAdjustmentForm>;

const base = (userId: string) => `/api/people/${encodeURIComponent(userId)}/salary-adjustments`;

async function failMessage(res: Response, fallback: string): Promise<never> {
  const data = (await res.json().catch(() => null)) as { message?: string } | null;
  throw new Error(data?.message?.trim() || fallback);
}

/** Mọi lần ứng, thưởng, trừ của một người trong tháng, cũ trước mới sau. */
export async function fetchSalaryAdjustments(userId: string, month: string): Promise<SalaryAdjustment[]> {
  const res = await fetch(`${base(userId)}?month=${encodeURIComponent(month)}`);
  if (!res.ok) await failMessage(res, 'Không tải được các khoản lương');
  return z.array(SalaryAdjustment).parse(await res.json());
}

export async function createSalaryAdjustment(
  userId: string,
  form: SalaryAdjustmentForm,
): Promise<SalaryAdjustment> {
  const res = await fetch(base(userId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) await failMessage(res, 'Không lưu được');
  return SalaryAdjustment.parse(await res.json());
}

export async function deleteSalaryAdjustment(userId: string, adjustmentId: string): Promise<void> {
  const res = await fetch(`${base(userId)}/${encodeURIComponent(adjustmentId)}`, { method: 'DELETE' });
  if (!res.ok) await failMessage(res, 'Không xoá được');
}
