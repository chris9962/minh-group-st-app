import { z } from 'zod';
import { BankAccountRow, type BankAccountSort } from './banking';
import { pageOf, pageParams, type Page, type PageQuery } from './pagination';

/**
 * Tab Ảnh của trang chi tiết ngân hàng (P-60, chốt 2026-09-02) — xem và tải
 * hàng loạt ảnh chứng minh của MỘT ngân hàng.
 *
 * Gác bằng quyền quản ngân hàng (`canManageBank`) như tab tài khoản, KHÔNG có
 * quyền riêng: ai quản ngân hàng nào thì tải được ảnh của ngân hàng đó.
 */

export const BankPhoto = z.object({
  id: z.string(),
  url: z.string(),
  kind: z.enum(['opening', 'transaction']),
});
export type BankPhoto = z.infer<typeof BankPhoto>;

/** Một tài khoản kèm TRỌN ảnh của nó — ảnh mở tài khoản trước, ảnh giao dịch sau. */
export const BankPhotoRow = BankAccountRow.extend({
  photos: z.array(BankPhoto),
});
export type BankPhotoRow = z.infer<typeof BankPhotoRow>;

/**
 * Trần MỘT lượt tải zip. Máy chủ đọc từng ảnh vào RAM rồi mới đóng gói —
 * không có trần thì một lượt "chọn hết" kéo cả kho ảnh vào bộ nhớ tiến trình.
 */
export const PHOTO_DOWNLOAD_LIMIT = 200;

/**
 * Cỡ trang RIÊNG của lưới ảnh (chốt 2026-09-02) — 50 tài khoản ≈ 150 ảnh một
 * trang, ảnh lazy-load nên trang nặng hơn bảng 15 dòng vẫn cuộn được. Route và
 * component phải cùng đọc hằng này, lệch nhau là số trang tính sai.
 */
export const BANK_PHOTOS_PAGE_SIZE = 50;

export const PhotoDownloadForm = z.object({
  photoIds: z.array(z.guid()).min(1).max(PHOTO_DOWNLOAD_LIMIT),
});
export type PhotoDownloadForm = z.infer<typeof PhotoDownloadForm>;

/** Cùng bộ lọc với bảng tài khoản của trang — hai tab dùng chung ô lọc. */
export type BankPhotosQuery = PageQuery<BankAccountSort> & {
  from: string;
  to: string;
  status: string;
  referralCodeId: string;
  departmentId: string;
};

const BankPhotoPage = pageOf(BankPhotoRow);

export async function fetchBankPhotos(
  bankId: string,
  query: BankPhotosQuery,
): Promise<Page<BankPhotoRow>> {
  const res = await fetch(
    `/api/settings/banks/${bankId}/photos?${pageParams(query, {
      from: query.from,
      to: query.to,
      status: query.status,
      referralCodeId: query.referralCodeId,
      departmentId: query.departmentId,
    })}`,
  );
  if (!res.ok) throw new Error('Không tải được ảnh của ngân hàng này');
  return BankPhotoPage.parse(await res.json());
}

/** Gửi danh sách ảnh đã chọn, nhận về MỘT file zip và lưu xuống máy. */
export async function downloadBankPhotoZip(
  bankId: string,
  bankCode: string,
  photoIds: string[],
): Promise<void> {
  const res = await fetch(`/api/settings/banks/${bankId}/photos/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoIds }),
  });
  if (!res.ok) throw new Error('Không tải được ảnh về máy');

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `anh-${bankCode || 'ngan-hang'}-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
