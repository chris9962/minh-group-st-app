import { z } from 'zod';
import { AccountNumberMethod } from './bankCatalog';
import { AccountType, BankAccountStatus } from './bankAccounts';
import { pageOf, pageParams, type Page, type PageQuery } from './pagination';

/**
 * P-21 · Danh sách tài khoản ngân hàng · P-22 · Chi tiết / hoàn tất tài khoản
 * (mgst-feature-list.md P-21 · mgst-platform-spec.md §4.2, §4.3, §4.5).
 *
 * Một tài khoản = một bản ghi độc lập — không gom nhiều ngân hàng của cùng
 * một khách vào chung một dòng ở đây (khác với xuất Excel, gộp theo khách).
 *
 * Phạm vi KHÔNG đi qua đường truyền: máy chủ tự lấy mức rộng nhất người gọi
 * được cấp. Nhận `scope` hay `actorId` từ client là mở hai ô để nặn tay mà
 * không thêm được tính năng nào — phiên đăng nhập đã nói đủ.
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
  /**
   * Bước 3 (spec §4.2) — ngày khách phát sinh giao dịch, `''` = chưa ghi nhận.
   * Nộp muộn sau khi tài khoản đã xong, và trùng ngày mở vẫn hợp lệ.
   */
  transactionAt: z.string(),
  /** Ảnh chuyển khoản. Đếm RIÊNG, không cộng vào `requiredPhotos`. */
  transactionPhotoUrls: z.array(z.string()),
  requiredPhotos: z.number(),
  /** Quyết ô số tài khoản ở bước 2 là ô gõ tay hay ô chọn SĐT. */
  accountNumberMethod: AccountNumberMethod,
  /** Mọi SĐT của khách, số chính đứng đầu — nguồn cho ô chọn khi `phone-match`. */
  customerPhones: z.array(z.string()),
});
export type BankAccountDetail = z.infer<typeof BankAccountDetail>;

/**
 * Khoá sắp xếp — DANH SÁCH TRẮNG, đi thẳng vào `ORDER BY` của máy chủ.
 *
 * Chỉ cột nằm trong chính bảng `bank_accounts`. Sắp theo tên khách hay tên
 * người tạo thì phải nối bảng TRƯỚC khi cắt trang, tức kéo cả kho để lấy 15
 * dòng (AGENTS.md §5.2) — mà `bank_accounts` là bảng lớn nhất hệ thống.
 */
export const BANK_ACCOUNT_SORT = ['date'] as const;
export type BankAccountSort = (typeof BANK_ACCOUNT_SORT)[number];

export type BankAccountQuery = PageQuery<BankAccountSort> & {
  /** Tìm theo TÊN KHÁCH — không dấu, không phụ thuộc thứ tự từ. */
  search: string;
  /** Mã ngân hàng dạng chuỗi ('VPa'), không phải uuid — ô chọn hiện mã. */
  bankCode: string;
  /** Khoảng NGÀY MỞ, YYYY-MM-DD. Rỗng = không giới hạn. */
  from: string;
  to: string;
  referralCode: string;
  /** Lọc theo id kênh, không theo tên: kênh đổi tên thì lọc theo tên bỏ sót dòng cũ. */
  channelId: string;
  staffId: string;
  status: BankAccountStatus | '';
};

const BankAccountPage = pageOf(BankAccountRow);

const listParams = (query: Omit<BankAccountQuery, keyof PageQuery>) => ({
  search: query.search,
  bankCode: query.bankCode,
  from: query.from,
  to: query.to,
  referralCode: query.referralCode,
  channelId: query.channelId,
  staffId: query.staffId,
  status: query.status,
});

/** MỘT trang tài khoản, đã lọc/tìm/sắp sẵn ở máy chủ (AGENTS.md §5.1). */
export async function fetchBankAccounts(query: BankAccountQuery): Promise<Page<BankAccountRow>> {
  const res = await fetch(`/api/bank-account-list?${pageParams(query, listParams(query))}`);
  if (!res.ok) throw new Error('Không tải được danh sách tài khoản ngân hàng');
  return BankAccountPage.parse(await res.json());
}

/**
 * TRỌN danh sách khớp bộ lọc, CHỈ cho việc xuất Excel — đường riêng chứ không
 * mở tham số "lấy hết" trên route đã phân trang (AGENTS.md §5.1, điều 4).
 *
 * `total` có thể lớn hơn `rows.length` khi chạm trần — nơi gọi BẮT BUỘC so hai
 * số rồi dừng, vì file thiếu dòng trông y hệt file đủ.
 */
export async function fetchBankAccountsForExport(
  query: Omit<BankAccountQuery, keyof PageQuery>,
): Promise<Page<BankAccountRow>> {
  const res = await fetch(`/api/bank-account-list/export?${new URLSearchParams(listParams(query))}`);
  if (!res.ok) throw new Error('Không tải được danh sách tài khoản ngân hàng');
  return BankAccountPage.parse(await res.json());
}

export async function fetchBankAccountDetail(id: string): Promise<BankAccountDetail> {
  const res = await fetch(`/api/bank-account-list/${id}`);
  if (res.status === 404) throw new Error('Không tìm thấy tài khoản này');
  if (!res.ok) throw new Error('Không tải được chi tiết tài khoản');
  return BankAccountDetail.parse(await res.json());
}
