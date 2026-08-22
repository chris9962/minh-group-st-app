import { z } from 'zod';
import { DepartmentRanking } from './dashboard';
import { Department, DepartmentType } from '@/lib/types';

/**
 * Tổ chức — P-91.
 *
 * Đi đường riêng với `api/departments.ts`: đường kia là danh sách rút gọn để đổ
 * vào ô lọc và ô chọn đơn vị, chỉ cần id + tên và chỉ trả phòng đang hoạt động.
 * Màn quản lý cần thêm số người và phải thấy cả phòng đã ngừng, nên nhồi vào
 * cùng một kiểu thì mọi chỗ dùng ô lọc phải mang theo dữ liệu chúng không dùng.
 */

export const DepartmentRow = Department.extend({
  /** Gồm cả người đã khoá — họ vẫn thuộc phòng này. */
  headcount: z.number(),
  /** Loại phòng — quyết định công thức tính điểm KPI (spec §7.0). */
  type: DepartmentType,
});
export type DepartmentRow = z.infer<typeof DepartmentRow>;

export const DepartmentList = z.object({
  summary: z.object({
    total: z.number(),
    active: z.number(),
    stopped: z.number(),
  }),
  departments: z.array(DepartmentRow),
});
export type DepartmentList = z.infer<typeof DepartmentList>;

export const DepartmentManager = z.object({
  id: z.string(),
  fullName: z.string(),
  title: z.string(),
});
export type DepartmentManager = z.infer<typeof DepartmentManager>;

export const DepartmentDetail = z.object({
  department: DepartmentRow,
  managers: z.array(DepartmentManager),
  /** true = không ai ở cấp Phó GĐ quản, đang hiện Giám đốc theo mặc định. */
  managedByDefault: z.boolean(),
});
export type DepartmentDetail = z.infer<typeof DepartmentDetail>;

/**
 * Biểu mẫu lập / đổi tên phòng.
 *
 * Không có `.default()` — zod v4 làm kiểu vào/ra lệch nhau và react-hook-form
 * báo lỗi kiểu. Giá trị mặc định đặt ở `defaultValues`.
 */
export const DepartmentForm = z.object({
  name: z.string().trim().min(2, 'Chưa nhập tên phòng'),
  /**
   * Người lập phòng PHẢI chọn, không có mặc định ở form.
   *
   * Cột trong database mặc định `office` để dữ liệu cũ và mọi đường ghi khác
   * không hỏng. Nhưng ở P-91 thì để người dùng bỏ qua là cấp nhầm công thức
   * tính lương mà không ai bấm gì — nên form bắt chọn.
   */
  type: DepartmentType,
});
export type DepartmentForm = z.infer<typeof DepartmentForm>;

export const ORG_ERROR = {
  NAME_TAKEN: 'name-taken',
  NOT_EMPTY: 'department-not-empty',
} as const;

export type OrgErrorCode = (typeof ORG_ERROR)[keyof typeof ORG_ERROR];

export const OrgError = z.object({
  code: z.enum([ORG_ERROR.NAME_TAKEN, ORG_ERROR.NOT_EMPTY]),
  message: z.string(),
});
export type OrgError = z.infer<typeof OrgError>;

export const isOrgError = (e: unknown): e is OrgError =>
  typeof e === 'object' && e !== null && 'code' in e;

export async function fetchDepartmentRows(search: string): Promise<DepartmentList> {
  const params = new URLSearchParams({ search });
  const res = await fetch(`/api/org/departments?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách phòng ban');
  return DepartmentList.parse(await res.json());
}

/**
 * Số liệu nghiệp vụ (TK mở, App cài, Tỉ lệ cài, Khách hàng) theo phòng —
 * cùng hình dạng `DepartmentRanking` với P-80, tách endpoint riêng vì trang
 * P-91 không có scope 'own'/'managed' như dashboard, luôn xem phạm vi công ty.
 */
export const DepartmentStats = z.object({
  departments: z.array(DepartmentRanking),
});
export type DepartmentStats = z.infer<typeof DepartmentStats>;

export async function fetchDepartmentStats(periodKey: string): Promise<DepartmentStats> {
  const res = await fetch(`/api/org/departments/stats?period=${encodeURIComponent(periodKey)}`);
  if (!res.ok) throw new Error('Không tải được số liệu phòng ban');
  return DepartmentStats.parse(await res.json());
}

export async function fetchDepartmentDetail(id: string): Promise<DepartmentDetail> {
  const res = await fetch(`/api/org/departments/${id}`);
  if (!res.ok) throw new Error('Không tải được phòng ban này');
  return DepartmentDetail.parse(await res.json());
}

/** Lỗi nghiệp vụ ném ra dạng OrgError để form gắn được vào đúng ô nhập. */
async function send(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = OrgError.safeParse(await res.json().catch(() => null));
    throw parsed.success ? parsed.data : new Error('Không lưu được');
  }
  return res.json();
}

export const createDepartment = (form: DepartmentForm) =>
  send('/api/org/departments', form).then(DepartmentRow.parse);

export const updateDepartment = (id: string, form: DepartmentForm) =>
  send(`/api/org/departments/${id}`, form).then(DepartmentRow.parse);

export const setDepartmentActive = (id: string, active: boolean) =>
  send(`/api/org/departments/${id}/active`, { active }).then(DepartmentRow.parse);
