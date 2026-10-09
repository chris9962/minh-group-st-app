import { z } from 'zod';

/**
 * Lỗi phía trình duyệt gửi về bảng `client_errors` (chốt 2026-10-09).
 *
 * `path` và `detail` là chuỗi trình duyệt gửi lên, máy chủ chỉ ghi lại để tra.
 */
export const ClientErrorBody = z.object({
  /** Nơi phát lỗi, ví dụ `id-card-camera`. */
  source: z.string().trim().min(1).max(50),
  message: z.string().trim().min(1).max(1000),
  detail: z.record(z.string(), z.unknown()),
  path: z.string().max(200),
});
export type ClientErrorBody = z.infer<typeof ClientErrorBody>;

/** Gửi không chờ kết quả: ghi lỗi hỏng thì bỏ qua, màn đang dùng không bị ảnh hưởng. */
export function reportClientError(
  source: string,
  message: string,
  detail: Record<string, unknown> = {},
): void {
  const body: ClientErrorBody = { source, message, detail, path: window.location.pathname };
  void fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}
