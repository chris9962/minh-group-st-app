import { z } from 'zod';

/* ── Loại khỏi điểm phòng theo tháng, ở trang chi tiết phòng (chốt 2026-10-18) ── */

export const DepartmentPointsExcludeForm = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  note: z.string().trim().max(500, 'Lý do tối đa 500 ký tự'),
});
export type DepartmentPointsExcludeForm = z.infer<typeof DepartmentPointsExcludeForm>;

async function send(url: string, method: string, body: unknown, fallback: string): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message?.trim() || fallback);
  }
}

export const excludeFromDepartmentPoints = (userId: string, form: DepartmentPointsExcludeForm) =>
  send(`/api/department-points/${userId}`, 'PUT', form, 'Không loại được nhân viên này. Thử lại.');

export const includeInDepartmentPoints = (userId: string, month: string) =>
  send(`/api/department-points/${userId}`, 'DELETE', { month }, 'Không khôi phục được nhân viên này. Thử lại.');
