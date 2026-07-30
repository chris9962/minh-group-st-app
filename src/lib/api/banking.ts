import { z } from 'zod';
import { Scope } from '@/lib/types';
import { AccountType } from './bankAccounts';

/**
 * P-21 · Danh sách tài khoản ngân hàng · P-22 · Chi tiết (chỉ xem)
 * (mgst-feature-list.md P-21 · mgst-platform-spec.md §4.2, §4.3).
 *
 * Một tài khoản = một bản ghi độc lập — không gom nhiều ngân hàng của cùng
 * một khách vào chung một dòng ở đây (khác với xuất Excel, gộp theo khách).
 */

export const BankAccountRow = z.object({
  id: z.string(),
  customerName: z.string(),
  bankCode: z.string(),
  accountNumber: z.string(),
  referralCode: z.string(),
  channel: z.string(),
  appInstalled: z.boolean(),
  date: z.string(),
  createdById: z.string().nullable(),
  createdByName: z.string().nullable(),
});
export type BankAccountRow = z.infer<typeof BankAccountRow>;

/**
 * P-22 · Chỉ xem — không có nút sửa/huỷ dù §10.1 cấp quyền `sửa · huỷ` cho
 * quản lý, vì feature-list không spec nút đó ở màn này.
 */
export const BankAccountDetail = BankAccountRow.extend({
  channelDetail: z.string(),
  accountType: AccountType,
  note: z.string(),
  createdByDepartmentId: z.string().nullable(),
});
export type BankAccountDetail = z.infer<typeof BankAccountDetail>;

export const BankAccountQuery = z.object({
  scope: Scope,
  bankCode: z.string(),
  from: z.string(),
  to: z.string(),
  referralCode: z.string(),
  channel: z.string(),
  staffId: z.string(),
});
export type BankAccountQuery = z.infer<typeof BankAccountQuery>;

export const BankAccountList = z.object({
  rows: z.array(BankAccountRow),
  summary: z.object({ total: z.number() }),
});
export type BankAccountList = z.infer<typeof BankAccountList>;

export async function fetchBankAccounts(
  query: BankAccountQuery & { actorId: string },
): Promise<BankAccountList> {
  const params = new URLSearchParams({
    actorId: query.actorId,
    scope: query.scope,
    bankCode: query.bankCode,
    from: query.from,
    to: query.to,
    referralCode: query.referralCode,
    channel: query.channel,
    staffId: query.staffId,
  });
  const res = await fetch(`/api/bank-account-list?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách tài khoản ngân hàng');
  return BankAccountList.parse(await res.json());
}

export async function fetchBankAccountDetail(
  id: string,
  actorId: string,
): Promise<BankAccountDetail> {
  const params = new URLSearchParams({ actorId });
  const res = await fetch(`/api/bank-account-list/${id}?${params}`);
  if (res.status === 404) throw new Error('Không tìm thấy tài khoản này');
  if (!res.ok) throw new Error('Không tải được chi tiết tài khoản');
  return BankAccountDetail.parse(await res.json());
}
