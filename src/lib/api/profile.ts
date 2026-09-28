import { z } from 'zod';
import { User } from '@/lib/types';
import { StaffForm } from './staff';

/** `null` = phiên không còn: hết hạn, bị xoá vì đổi quyền, hoặc tài khoản bị khoá. */
export async function fetchMe(): Promise<User | null> {
  const res = await fetch('/api/profile');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error('Không đọc được phiên đăng nhập');
  return User.parse(await res.json());
}

/**
 * C-02 · Tự đổi mật khẩu: mật khẩu hiện tại → mới → nhập lại.
 *
 * Cố ý KHÔNG đặt luật độ dài, độ phức tạp hay hạn dùng. Đội KD gõ trên điện
 * thoại ngoài trời; mỗi luật thêm vào là thêm một cuộc gọi hỏi hỗ trợ. Ô nhập
 * lại thì giữ: mật khẩu gõ ra dấu chấm, gõ nhầm một ký tự là mất tài khoản.
 *
 * Không có kênh tự phục hồi. Quên mật khẩu thì nhờ quản trị đặt lại ở P-52 —
 * không có email đặt lại, không có câu hỏi bí mật.
 */

export const PasswordForm = z
  .object({
    currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại'),
    newPassword: z.string().min(1, 'Nhập mật khẩu mới'),
    confirmPassword: z.string().min(1, 'Nhập lại mật khẩu mới'),
  })
  .refine((f) => f.newPassword === f.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Hai lần nhập không giống nhau',
  });
export type PasswordForm = z.infer<typeof PasswordForm>;

export const PASSWORD_ERROR = { WRONG_CURRENT: 'wrong-current-password' } as const;

/** Lỗi gắn được vào đúng ô nhập — sai mật khẩu hiện tại thì lỗi thuộc ô đó, không phải toast chung. */
export const PasswordError = z.object({
  code: z.literal(PASSWORD_ERROR.WRONG_CURRENT),
  message: z.string(),
});
export type PasswordError = z.infer<typeof PasswordError>;

export async function changePassword(form: PasswordForm): Promise<void> {
  const res = await fetch('/api/profile/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (res.ok) return;

  const body = await res.json().catch(() => null);
  const parsed = PasswordError.safeParse(body);
  if (parsed.success) throw parsed.data;

  // Giữ câu của máy chủ (401 hết phiên, 400 sai định dạng) thay vì thay bằng
  // câu chung — câu chung không nói được người dùng phải làm gì tiếp.
  const message = (body as { message?: unknown } | null)?.message;
  throw new Error(
    typeof message === 'string' && message.trim() ? message : 'Không đổi được mật khẩu',
  );
}

/**
 * Nhân viên tự sửa họ tên và số điện thoại ở màn Cá nhân. Chỉ hai trường này,
 * cùng luật ô nhập với hộp thoại sửa nhân viên ở màn Nhân sự.
 */
export const ProfileInfoForm = z.object({
  // Lấy từng trường qua `.shape`: `StaffForm` có `superRefine`, và zod v4 ném
  // lỗi khi `.pick()` trên schema có refine, làm hỏng mọi trang nạp file này.
  fullName: StaffForm.shape.fullName,
  phone: StaffForm.shape.phone,
});
export type ProfileInfoForm = z.infer<typeof ProfileInfoForm>;

export async function fetchProfileInfo(): Promise<ProfileInfoForm> {
  const res = await fetch('/api/profile/info');
  if (!res.ok) throw new Error('Không tải được thông tin cá nhân');
  return ProfileInfoForm.parse(await res.json());
}

export async function updateProfileInfo(form: ProfileInfoForm): Promise<ProfileInfoForm> {
  const res = await fetch('/api/profile/info', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (res.ok) return ProfileInfoForm.parse(await res.json());

  const body = await res.json().catch(() => null);
  const message = (body as { message?: unknown } | null)?.message;
  throw new Error(
    typeof message === 'string' && message.trim() ? message : 'Không lưu được thông tin cá nhân',
  );
}
