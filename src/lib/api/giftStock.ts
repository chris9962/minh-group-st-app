import { z } from 'zod';

/**
 * Kho quà (chốt thử 2026-10-24). Mỗi lần hàng về, quản lý nhập một dòng. Số còn lại
 * của một món bằng tổng số đã nhập trừ số đã phát kể từ lần nhập đầu tiên. Món chưa
 * nhập quà lần nào thì không giới hạn.
 */

export const GiftStockItem = z.object({
  giftItemId: z.string(),
  name: z.string(),
  /** Món đã ngừng cấp ở màn Danh mục quà: không phát được dù còn hàng. */
  active: z.boolean(),
  openingStock: z.number(),
  entryCount: z.number(),
  entryQuantity: z.number(),
  issued: z.number(),
  closingStock: z.number(),
  /** Số còn lại lúc tải màn, khác `closingStock` khi đang xem tháng cũ. */
  remaining: z.number(),
});
export type GiftStockItem = z.infer<typeof GiftStockItem>;

export const GiftStockEntry = z.object({
  id: z.string(),
  giftItemId: z.string(),
  itemName: z.string(),
  quantity: z.number(),
  note: z.string(),
  createdAt: z.string(),
  /** Khác `createdAt` khi dòng đã được sửa. */
  updatedAt: z.string(),
  createdByName: z.string(),
  createdByStaffCode: z.string(),
  createdByDepartmentName: z.string(),
});
export type GiftStockEntry = z.infer<typeof GiftStockEntry>;

export const GiftStockMonth = z.object({
  month: z.string(),
  items: z.array(GiftStockItem),
  entries: z.array(GiftStockEntry),
});
export type GiftStockMonth = z.infer<typeof GiftStockMonth>;

/** Trần một lần nhập quà, chủ dự án chốt 2026-10-24. Form và máy chủ cùng đọc schema này. */
export const GIFT_STOCK_MAX_QUANTITY = 1_000_000;

const quantity = z
  .int('Số lượng phải là số nguyên')
  .min(1, 'Số lượng phải lớn hơn 0')
  .max(GIFT_STOCK_MAX_QUANTITY, 'Số lượng tối đa 1.000.000');
const note = z.string().trim().max(200, 'Ghi chú tối đa 200 ký tự');

export const GiftStockEntryForm = z.object({
  giftItemId: z.guid('Chưa chọn món quà'),
  quantity,
  note,
});
export type GiftStockEntryForm = z.infer<typeof GiftStockEntryForm>;

export const GiftStockEntryUpdate = z.object({ quantity, note });
export type GiftStockEntryUpdate = z.infer<typeof GiftStockEntryUpdate>;

export async function fetchGiftStockMonth(month: string): Promise<GiftStockMonth> {
  const res = await fetch(`/api/settings/gift-stock?month=${month}`);
  if (!res.ok) throw new Error('Không đọc được kho quà');
  return GiftStockMonth.parse(await res.json());
}

async function send(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<GiftStockEntry> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? 'Không lưu được lần nhập quà');
  return GiftStockEntry.parse(data);
}

export const createGiftStockEntry = (form: GiftStockEntryForm) =>
  send('/api/settings/gift-stock/entries', 'POST', form);

export const updateGiftStockEntry = (id: string, form: GiftStockEntryUpdate) =>
  send(`/api/settings/gift-stock/entries/${id}`, 'PATCH', form);
