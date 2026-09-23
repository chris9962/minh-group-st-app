import { z } from 'zod';

/** Trạng thái chốt lương của một tháng, cho nút Chốt lương trên màn Nhân sự & KPI. */
export const SalaryClosing = z.object({
  month: z.string(),
  closed: z.boolean(),
  closedAt: z.string().nullable(),
  closedByName: z.string().nullable(),
});
export type SalaryClosing = z.infer<typeof SalaryClosing>;

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(data?.message?.trim() || 'Không lưu được');
  }
  return res.json();
}

export async function fetchSalaryClosing(month: string): Promise<SalaryClosing> {
  const res = await fetch(`/api/salary-closings?month=${encodeURIComponent(month)}`);
  if (!res.ok) throw new Error('Không tải được trạng thái chốt lương');
  return SalaryClosing.parse(await res.json());
}

export const closeSalary = (month: string) =>
  send('/api/salary-closings', 'POST', { month }).then(SalaryClosing.parse);

export const reopenSalary = (month: string) =>
  send(`/api/salary-closings/${encodeURIComponent(month)}`, 'DELETE').then(SalaryClosing.parse);
