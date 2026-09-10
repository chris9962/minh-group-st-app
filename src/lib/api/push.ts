import { z } from 'zod';

/**
 * Thông báo đẩy — hợp đồng giữa trình duyệt và máy chủ.
 *
 * Ba chuỗi dưới đây do TRÌNH DUYỆT sinh ra, không phải người dùng gõ. Vẫn kiểm
 * bằng zod vì đường `/api/push/subscribe` là đường ghi, và mọi đường ghi đều
 * phải tự bảo vệ.
 */

export const PushSubscriptionBody = z.object({
  endpoint: z.string().trim().url().max(2000),
  p256dh: z.string().trim().min(1).max(500),
  auth: z.string().trim().min(1).max(500),
});
export type PushSubscriptionBody = z.infer<typeof PushSubscriptionBody>;

export const PushUnsubscribeBody = z.object({
  endpoint: z.string().trim().url().max(2000),
});
export type PushUnsubscribeBody = z.infer<typeof PushUnsubscribeBody>;

export const PushKey = z.object({ publicKey: z.string() });

/** Kết quả một lượt gửi, dùng cho nút gửi thử. */
export const PushSendResult = z.object({
  sent: z.number().int().nonnegative(),
  /** Số đăng ký đã chết và bị xoá trong lượt gửi này. */
  removed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type PushSendResult = z.infer<typeof PushSendResult>;

/**
 * Khoá công khai hỏi TỪ MÁY CHỦ, không đọc từ `process.env` ở trình duyệt.
 * Lý do viết ở `app/api/push/key/route.ts`.
 */
export async function fetchPushPublicKey(): Promise<string> {
  const res = await fetch('/api/push/key');
  if (!res.ok) throw new Error('Không đọc được khoá thông báo đẩy');
  return PushKey.parse(await res.json()).publicKey;
}

export async function subscribeToPush(body: PushSubscriptionBody): Promise<void> {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Không lưu được đăng ký nhận thông báo');
}

export async function unsubscribeFromPush(body: PushUnsubscribeBody): Promise<void> {
  const res = await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Không xoá được đăng ký nhận thông báo');
}

export async function sendTestPush(): Promise<PushSendResult> {
  const res = await fetch('/api/push/test', { method: 'POST' });
  if (!res.ok) throw new Error('Không gửi được thông báo thử');
  return PushSendResult.parse(await res.json());
}
