import { z } from 'zod';

/**
 * Schema zod là NGUỒN SỰ THẬT DUY NHẤT cho kiểu dữ liệu.
 * Kiểu TypeScript suy ra từ đây, không khai báo song song.
 * Khi thiết kế database xong, sửa schema ở file này là cả FE đổi theo.
 */

/* ── Phân quyền: ba trục (spec mục 1.1) ─────────────────────────────── */

export const ModuleKey = z.enum(['insurance', 'banking', 'services', 'system', '*']);
export type ModuleKey = z.infer<typeof ModuleKey>;

export const Action = z.enum([
  'view-stats',
  'view-detail',
  'create',
  'update',
  'cancel',
  'download',
  'export-excel',
  'handle-fallback',
  'manage-codes',
  'grant-gift',
  'configure-catalog',
  'configure-gift-rules',
  'manage-users',
  'grant-permission',
]);
export type Action = z.infer<typeof Action>;

/** Thứ tự từ hẹp đến rộng — dùng để so sánh, đừng đổi thứ tự. */
export const SCOPES = ['own', 'team', 'department', 'branch', 'company'] as const;
export const Scope = z.enum(SCOPES);
export type Scope = z.infer<typeof Scope>;

export const Permission = z.object({
  module: ModuleKey,
  action: Action,
  scope: Scope,
});
export type Permission = z.infer<typeof Permission>;

/* ── Tổ chức: bảng tự trỏ về chính nó, không cứng hoá số cấp ────────── */

export const OrgUnitType = z.enum(['company', 'branch', 'department', 'team']);
export type OrgUnitType = z.infer<typeof OrgUnitType>;

export const OrgUnit = z.object({
  id: z.string(),
  name: z.string(),
  type: OrgUnitType,
  parentId: z.string().nullable(),
  active: z.boolean(),
});
export type OrgUnit = z.infer<typeof OrgUnit>;

/* ── Người dùng ─────────────────────────────────────────────────────── */

export const User = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string(),
  orgUnitId: z.string(),
  /** Chỉ nhân viên phòng Dự án mới có. */
  wardId: z.string().nullable(),
  roleName: z.string(),
  permissions: z.array(Permission),
  active: z.boolean(),
});
export type User = z.infer<typeof User>;

/* ── Đăng nhập ──────────────────────────────────────────────────────── */

export const LoginForm = z.object({
  username: z.string().min(1, 'Chưa nhập tên đăng nhập'),
  password: z.string().min(1, 'Chưa nhập mật khẩu'),
  /**
   * Không tích: phiên 1 tháng. Có tích: 1 năm.
   * Cố ý KHÔNG dùng .default() — zod v4 làm kiểu vào/ra lệch nhau và
   * react-hook-form sẽ báo lỗi kiểu. Giá trị mặc định đặt ở defaultValues.
   */
  remember: z.boolean(),
});
export type LoginForm = z.infer<typeof LoginForm>;

export const LoginResult = z.object({
  user: User,
  expiresAt: z.string(),
});
export type LoginResult = z.infer<typeof LoginResult>;

/** Sai 5 lần liên tiếp → khoá 15 phút, quản trị hệ thống mở lại. */
export const LOGIN_ERROR = {
  BAD_CREDENTIALS: 'bad-credentials',
  LOCKED: 'locked',
} as const;

export const LoginError = z.object({
  code: z.enum([LOGIN_ERROR.BAD_CREDENTIALS, LOGIN_ERROR.LOCKED]),
  message: z.string(),
  attemptsLeft: z.number().optional(),
  lockedUntil: z.string().optional(),
});
export type LoginError = z.infer<typeof LoginError>;
