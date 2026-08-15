import { z } from 'zod';

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
