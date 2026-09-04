import { z } from 'zod';
import { pageOf, pageParams, type Page, type PageQuery } from './pagination';

/**
 * P-44 · Danh sách quà ĐÃ PHÁT — nhìn ngang qua mọi khách, khác P-43 là thao
 * tác phát quà cho MỘT khách trong hồ sơ của họ.
 *
 * Màn chỉ ĐỌC. Sửa hay đổi quà vẫn nằm ở hồ sơ khách, nơi người bấm thấy đủ rổ
 * quà, số app đã cài và lịch sử đổi món.
 */

export const GiftGrantRow = z.object({
  id: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  /** Ngày phát, đã quy về giờ làm việc. */
  date: z.string(),
  /** Tổng tiền mặt đã chi, đồng. */
  cashTotal: z.number(),
  /** Tên món LÚC PHÁT, hoặc câu mô tả việc từ chối. */
  item: z.string(),
  /** Khách từ chối nhận quà — nhãn hiện khác món quà thật. */
  declined: z.boolean(),
  grantedByName: z.string().nullable(),
  grantedByStaffCode: z.string(),
  grantedByDepartmentName: z.string().nullable(),
});
export type GiftGrantRow = z.infer<typeof GiftGrantRow>;

/** Khoá sắp xếp — DANH SÁCH TRẮNG, đi thẳng vào `ORDER BY` của máy chủ. */
export const GIFT_GRANT_SORT = ['date'] as const;
export type GiftGrantSort = (typeof GIFT_GRANT_SORT)[number];

/**
 * Trần một lượt xuất Excel. Chạm trần thì `total` nói ra sự thật và nơi gọi
 * BẮT BUỘC so hai số — file thiếu 5.000 dòng trông y hệt file đủ.
 */
export const GIFT_EXPORT_LIMIT = 20_000;

export type GiftGrantQuery = PageQuery<GiftGrantSort> & {
  /** Tìm theo TÊN KHÁCH — không dấu, không phụ thuộc thứ tự từ. */
  search: string;
  /** Khoảng NGÀY PHÁT, YYYY-MM-DD. Rỗng = không giới hạn. */
  from: string;
  to: string;
  /** Phòng của người phát. Rỗng = mọi phòng. */
  departmentId: string;
  staffId: string;
};

const GiftGrantPage = pageOf(GiftGrantRow);

const listParams = (query: Omit<GiftGrantQuery, keyof PageQuery>) => ({
  search: query.search,
  from: query.from,
  to: query.to,
  departmentId: query.departmentId,
  staffId: query.staffId,
});

/** MỘT trang quà đã phát, đã lọc/tìm/sắp sẵn ở máy chủ (AGENTS.md §5.1). */
export async function fetchGiftGrants(query: GiftGrantQuery): Promise<Page<GiftGrantRow>> {
  const res = await fetch(`/api/gift-grants?${pageParams(query, listParams(query))}`);
  if (!res.ok) throw new Error('Không tải được danh sách quà đã phát');
  return GiftGrantPage.parse(await res.json());
}

/**
 * TRỌN danh sách khớp bộ lọc, CHỈ cho việc xuất Excel — đường riêng chứ không
 * mở tham số "lấy hết" trên route đã phân trang (AGENTS.md §5.1, điều 4).
 */
export async function fetchGiftGrantsForExport(
  query: Omit<GiftGrantQuery, keyof PageQuery>,
): Promise<Page<GiftGrantRow>> {
  const res = await fetch(`/api/gift-grants/export?${new URLSearchParams(listParams(query))}`);
  if (!res.ok) throw new Error('Không tải được danh sách quà đã phát');
  return GiftGrantPage.parse(await res.json());
}
