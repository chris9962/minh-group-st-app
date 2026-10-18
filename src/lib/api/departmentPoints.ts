import { z } from 'zod';
import { pageOf, pageParams, type PageQuery } from './pagination';

/* ── P-54 · Loại khỏi điểm phòng (chốt 2026-10-18) ──────────────────────── */

export const DEPARTMENT_POINTS_SORT = ['name', 'points', 'excluded'] as const;
export type DepartmentPointsSort = (typeof DEPARTMENT_POINTS_SORT)[number];

export const DepartmentPointsExclusion = z.object({
  note: z.string(),
  byName: z.string(),
  at: z.coerce.date(),
});
export type DepartmentPointsExclusion = z.infer<typeof DepartmentPointsExclusion>;

/** Một nhân viên của phòng kinh doanh trong tháng đang xem. */
export const DepartmentPointsRow = z.object({
  id: z.string(),
  fullName: z.string(),
  staffCode: z.string().nullable(),
  departmentName: z.string(),
  points: z.number(),
  /** `null` = vẫn tính vào điểm phòng. */
  exclusion: DepartmentPointsExclusion.nullable(),
});
export type DepartmentPointsRow = z.infer<typeof DepartmentPointsRow>;

export const DepartmentPointsList = z.object({
  month: z.string(),
  /** Tháng đã chốt lương thì không đánh dấu và không bỏ dấu được nữa. */
  monthClosed: z.boolean(),
  /** Phòng kinh doanh đang hoạt động, cho ô lọc. */
  departments: z.array(z.object({ id: z.string(), name: z.string() })),
  page: pageOf(DepartmentPointsRow),
});
export type DepartmentPointsList = z.infer<typeof DepartmentPointsList>;

export type DepartmentPointsQuery = PageQuery<DepartmentPointsSort> & {
  month: string;
  departmentId: string;
  search: string;
};

export const DepartmentPointsExcludeForm = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  note: z.string().trim().max(500, 'Lý do tối đa 500 ký tự'),
});
export type DepartmentPointsExcludeForm = z.infer<typeof DepartmentPointsExcludeForm>;

export async function fetchDepartmentPoints(query: DepartmentPointsQuery): Promise<DepartmentPointsList> {
  const params = pageParams(query, {
    month: query.month,
    departmentId: query.departmentId,
    search: query.search,
  });
  const res = await fetch(`/api/department-points?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách nhân viên');
  return DepartmentPointsList.parse(await res.json());
}

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
  send(`/api/department-points/${userId}`, 'PUT', form, 'Không loại được nhân viên này');

export const includeInDepartmentPoints = (userId: string, month: string) =>
  send(`/api/department-points/${userId}`, 'DELETE', { month }, 'Không tính lại được nhân viên này');
