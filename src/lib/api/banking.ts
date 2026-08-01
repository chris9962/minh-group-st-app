import { z } from 'zod';
import { Scope } from '@/lib/types';
import { AccountNumberMethod } from './bankCatalog';
import { AccountType, BankAccountStatus } from './bankAccounts';

/**
 * P-21 · Danh sách tài khoản ngân hàng · P-22 · Chi tiết / hoàn tất tài khoản
 * (mgst-feature-list.md P-21 · mgst-platform-spec.md §4.2, §4.3, §4.5).
 *
 * Một tài khoản = một bản ghi độc lập — không gom nhiều ngân hàng của cùng
 * một khách vào chung một dòng ở đây (khác với xuất Excel, gộp theo khách).
 */

export const BankAccountRow = z.object({
  id: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  bankCode: z.string(),
  accountNumber: z.string(),
  referralCode: z.string(),
  channel: z.string(),
  appInstalled: z.boolean(),
  date: z.string(),
  createdById: z.string().nullable(),
  createdByName: z.string().nullable(),
  /** Đơn vị của người tạo LÚC TẠO — chụp một lần, không tra động (spec §1.1.5). Dùng cho báo cáo xuất theo phòng (P-73 #4). */
  createdByDepartmentName: z.string().nullable(),
  status: BankAccountStatus,
});
export type BankAccountRow = z.infer<typeof BankAccountRow>;

/**
 * P-22 · Xem chi tiết khi `status = done`; khi `status = creating` đây là màn
 * BƯỚC 2 — điền nốt STK/ngày mở/app + đủ ảnh rồi bấm Hoàn thành (spec §4.5).
 * Riêng ẢNH CHỨNG MINH thì luôn xem/thêm/thay được bất kể trạng thái — mỗi
 * ngân hàng yêu cầu số ảnh khác nhau (`requiredPhotos`, P-60).
 */
export const BankAccountDetail = BankAccountRow.extend({
  channelDetail: z.string(),
  accountType: AccountType,
  note: z.string(),
  createdByDepartmentId: z.string().nullable(),
  photoUrls: z.array(z.string()),
  requiredPhotos: z.number(),
  /** Dùng để tự điền/khoá ô số tài khoản ở bước 2, giống lúc chọn ngân hàng ở P-20. */
  accountNumberMethod: AccountNumberMethod,
  /** SĐT chính của khách — nguồn để tự điền số tài khoản khi `accountNumberMethod = phone-match`. */
  customerPrimaryPhone: z.string(),
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
  status: z.union([BankAccountStatus, z.literal('')]),
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
    status: query.status,
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
