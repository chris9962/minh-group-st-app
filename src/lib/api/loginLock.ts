import { z } from 'zod';

/** Khoá đăng nhập 15 phút của một nhân viên. `lockedUntil` rỗng = không bị khoá. */
export const LoginLock = z.object({ lockedUntil: z.string() });
export type LoginLock = z.infer<typeof LoginLock>;

export async function fetchLoginLock(staffId: string): Promise<LoginLock> {
  const res = await fetch(`/api/staff/${staffId}/login-lock`);
  if (!res.ok) throw new Error('Không đọc được trạng thái khoá đăng nhập');
  return LoginLock.parse(await res.json());
}

export async function clearLoginLock(staffId: string): Promise<LoginLock> {
  const res = await fetch(`/api/staff/${staffId}/login-lock`, { method: 'DELETE' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? 'Không mở khoá đăng nhập được');
  return LoginLock.parse(data);
}
