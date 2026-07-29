import { z } from 'zod';
import { ManageScope, RoleKey } from '@/lib/types';

/** Hồ sơ nhân viên = tài khoản đăng nhập. Một thứ, không tách (spec §2.2). */

export const StaffAccount = z.object({
  id: z.string(),
  fullName: z.string(),
  username: z.string(),
  phone: z.string(),
  /** THUỘC VỀ — đúng một phòng. Rỗng với ban giám đốc. */
  departmentId: z.string().nullable(),
  departmentName: z.string(),
  /** Chưa gán chức vụ thì không đăng nhập làm được gì — màn danh sách đếm số này. */
  role: RoleKey.nullable(),
  title: z.string(),
  manageScope: ManageScope,
  managedDepartmentIds: z.array(z.string()),
  /** Chỉ nhân viên phòng Dự Án mới có. */
  wardId: z.string().nullable(),
  active: z.boolean(),
});
export type StaffAccount = z.infer<typeof StaffAccount>;

export const StaffList = z.object({
  summary: z.object({
    active: z.number(),
    locked: z.number(),
    /** Tạo xong mà quên gán chức vụ — người này đăng nhập vào cũng trắng trơn. */
    withoutRole: z.number(),
  }),
  staff: z.array(StaffAccount),
});
export type StaffList = z.infer<typeof StaffList>;

/**
 * Biểu mẫu tạo / sửa nhân viên.
 *
 * Không có `.default()` — zod v4 làm kiểu vào/ra lệch nhau và react-hook-form
 * báo lỗi kiểu. Giá trị mặc định đặt ở `defaultValues`.
 */
export const StaffForm = z.object({
  fullName: z.string().trim().min(2, 'Chưa nhập họ tên'),
  username: z
    .string()
    .trim()
    .min(3, 'Tên đăng nhập ít nhất 3 ký tự')
    .regex(/^[a-z0-9._-]+$/, 'Chỉ dùng chữ thường không dấu, số và . _ -'),
  phone: z
    .string()
    .trim()
    .regex(/^0\d{9}$/, 'Số điện thoại phải đủ 10 số và bắt đầu bằng 0'),
  /** Chuỗi rỗng = không thuộc phòng nào, đúng với ban giám đốc. */
  departmentId: z.string(),
  role: RoleKey,
  title: z.string().trim().min(2, 'Chưa nhập chức danh'),
  manageScope: ManageScope,
  managedDepartmentIds: z.array(z.string()),
  wardId: z.string(),
});
export type StaffForm = z.infer<typeof StaffForm>;

export const SAVE_ERROR = {
  USERNAME_TAKEN: 'username-taken',
  ROLE_TOO_HIGH: 'role-too-high',
} as const;

export const SaveError = z.object({
  code: z.enum([SAVE_ERROR.USERNAME_TAKEN, SAVE_ERROR.ROLE_TOO_HIGH]),
  message: z.string(),
});
export type SaveError = z.infer<typeof SaveError>;

export type StaffQuery = {
  scope: string;
  departmentId: string;
  search: string;
  /** `all` gồm cả người đã khoá. Mặc định chỉ hiện người đang làm. */
  status: 'active' | 'locked' | 'all';
};

export async function fetchStaff(query: StaffQuery): Promise<StaffList> {
  const params = new URLSearchParams({ ...query });
  const res = await fetch(`/api/staff?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách nhân viên');
  return StaffList.parse(await res.json());
}

/** Lỗi nghiệp vụ ném ra dạng SaveError để form gắn được vào đúng ô nhập. */
async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = SaveError.safeParse(await res.json().catch(() => null));
    throw parsed.success ? parsed.data : new Error('Không lưu được');
  }
  return res.json();
}

export const createStaff = (form: StaffForm, actorId: string) =>
  send('/api/staff', 'POST', { ...form, actorId }).then(StaffAccount.parse);

export const updateStaff = (id: string, form: StaffForm, actorId: string) =>
  send(`/api/staff/${id}`, 'PATCH', { ...form, actorId }).then(StaffAccount.parse);

export const setStaffActive = (id: string, active: boolean) =>
  send(`/api/staff/${id}/active`, 'POST', { active }).then(StaffAccount.parse);

/**
 * Sinh mật khẩu MỚI và trả về đúng một lần.
 *
 * Không có đường nào đọc lại mật khẩu cũ — nó lưu dạng băm một chiều. Muốn xem
 * lại được thì phải lưu dạng đọc được, và khi đó ai lấy được bản sao dữ liệu là
 * có mật khẩu của cả công ty.
 */
export const resetPassword = (id: string): Promise<{ password: string }> =>
  send(`/api/staff/${id}/reset-password`, 'POST').then((r) =>
    z.object({ password: z.string() }).parse(r),
  );
