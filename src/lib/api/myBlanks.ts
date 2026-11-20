import { z } from 'zod';
import { INT_MAX } from './limits';

/* ── Nhân viên tự báo số phôi bảo hiểm và phiếu ngân hàng còn lại (chốt 2026-11-20) ──
 * Kế hoạch: docs/plan-phoi-nhap-con-lai-2026-11-20.md. App ghi đã sử dụng =
 * tổng đã nhận − số còn lại, vào dòng tháng hiện tại ở phòng hiện tại.
 */

/** Một loại phôi hay một ngân hàng mà người này đã nhận trong tháng. */
export const OwnBlank = z.object({
  id: z.string(),
  name: z.string(),
  received: z.number(),
  remaining: z.number(),
  reportedAt: z.string().nullable(),
});
export type OwnBlank = z.infer<typeof OwnBlank>;

/** null là người này không ở phòng kinh doanh nào, không có gì để báo. */
export const MyBlanks = z
  .object({ insurance: z.array(OwnBlank), bank: z.array(OwnBlank) })
  .nullable();
export type MyBlanks = z.infer<typeof MyBlanks>;

const OwnBlankReport = z.object({
  id: z.guid(),
  /** Số đã nhận lúc mở hộp thoại. Trưởng phòng phát thêm giữa chừng thì máy chủ từ chối. */
  received: z.number().int().min(0).max(INT_MAX),
  remaining: z.number().int().min(0).max(INT_MAX),
});
export type OwnBlankReport = z.infer<typeof OwnBlankReport>;

/** Chỉ gửi ô người dùng đã nhập. Ô để trống giữ số cũ (chủ dự án chốt 2026-11-20). */
export const MyBlanksForm = z.object({
  insurance: z.array(OwnBlankReport),
  bank: z.array(OwnBlankReport),
});
export type MyBlanksForm = z.infer<typeof MyBlanksForm>;

export const MY_BLANKS_KEY = ['blanks', 'mine'] as const;

/** Có loại nào đã nhận thì mới có gì để báo. */
export const hasOwnBlanks = (data: MyBlanks | undefined): data is NonNullable<MyBlanks> =>
  !!data && (data.insurance.length > 0 || data.bank.length > 0);

export async function fetchMyBlanks(): Promise<MyBlanks> {
  const res = await fetch('/api/blanks/mine');
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? 'Không đọc được số phôi, phiếu còn lại');
  return MyBlanks.parse(data);
}

export async function saveMyBlanks(form: MyBlanksForm): Promise<MyBlanks> {
  const res = await fetch('/api/blanks/mine', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? 'Không lưu được');
  return MyBlanks.parse(data);
}
