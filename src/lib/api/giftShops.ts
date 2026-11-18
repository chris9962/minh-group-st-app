import { z } from 'zod';

/**
 * Shop mua quà ShopeePay và sản phẩm của từng shop (chủ dự án chốt 2026-11-18).
 *
 * Bước 2 của dòng ShopeePay bắt khai shop đã mua quà. Bước 2 xếp shop theo số
 * đơn trong ngày, ít đơn đứng đầu, để Shopee không thấy một shop nhận quá nhiều
 * đơn từ ví mới.
 */

const linkField = z
  .string()
  .trim()
  .max(2000, 'Link dài quá')
  .refine((v) => v === '' || /^https?:\/\/\S+$/.test(v), 'Link phải bắt đầu bằng http:// hoặc https://');

export const GiftShop = z.object({
  id: z.string(),
  name: z.string(),
  link: z.string(),
  active: z.boolean(),
  /** Số dòng ShopeePay khai shop này và hoàn thành trong ngày, theo giờ Việt Nam. */
  todayCount: z.number(),
  totalCount: z.number(),
  productCount: z.number(),
});
export type GiftShop = z.infer<typeof GiftShop>;

export const GiftShopForm = z.object({
  name: z.string().trim().min(1, 'Chưa nhập tên shop').max(200, 'Tên shop dài quá'),
  link: linkField,
  active: z.boolean(),
});
export type GiftShopForm = z.infer<typeof GiftShopForm>;

/** Loại quà để lọc ở modal chọn quà. Thứ tự ở đây là thứ tự hiện trên modal. */
export const GiftCategory = z.enum(['seasoning', 'cooking-oil', 'food', 'snacks', 'drinks', 'household', 'other']);
export type GiftCategory = z.infer<typeof GiftCategory>;

export const GIFT_CATEGORY_LABEL: Record<GiftCategory, string> = {
  seasoning: 'Gia vị & nước chấm',
  'cooking-oil': 'Dầu ăn & bơ',
  food: 'Mì, cháo & thực phẩm',
  snacks: 'Bánh kẹo & ăn vặt',
  drinks: 'Đồ uống',
  household: 'Giặt giũ & tẩy rửa',
  other: 'Khác',
};

export const GiftShopProduct = z.object({
  id: z.string(),
  shopId: z.string(),
  name: z.string(),
  price: z.string(),
  link: z.string(),
  /** `''` = chưa có ảnh. */
  imageUrl: z.string(),
  category: GiftCategory,
  active: z.boolean(),
});
export type GiftShopProduct = z.infer<typeof GiftShopProduct>;

/** Một món trong modal "Chọn quà tặng từ Shopee" của dòng ShopeePay. */
export const GiftChoice = GiftShopProduct.extend({
  shopName: z.string(),
  shopTodayCount: z.number(),
});
export type GiftChoice = z.infer<typeof GiftChoice>;

export const GiftChoices = z.object({
  items: z.array(GiftChoice),
  /** Tên shop có nhiều đơn nhất trong ngày. Sản phẩm của các shop này không nằm trong `items`. */
  hiddenShops: z.array(z.string()),
});
export type GiftChoices = z.infer<typeof GiftChoices>;

export const GiftShopProductForm = z.object({
  name: z.string().trim().min(1, 'Chưa nhập tên sản phẩm').max(300, 'Tên sản phẩm dài quá'),
  price: z.string().trim().max(50, 'Giá dài quá'),
  link: linkField,
  /** URL do `/api/uploads` trả về, máy chủ cắt lại thành khoá; `''` = không có ảnh. */
  imageUrl: z.string(),
  category: GiftCategory,
  active: z.boolean(),
});
export type GiftShopProductForm = z.infer<typeof GiftShopProductForm>;

/** Một shop trong ô chọn ở bước 2 của dòng ShopeePay. */
export const GiftShopOption = z.object({
  id: z.string(),
  name: z.string(),
  link: z.string(),
  /** `false` chỉ xảy ra với shop đang gắn trên dòng đã hoàn thành rồi bị ngừng. */
  active: z.boolean(),
  todayCount: z.number(),
});
export type GiftShopOption = z.infer<typeof GiftShopOption>;

export const giftShopOptionLabel = (o: GiftShopOption) =>
  `${o.name} · ${o.todayCount} đơn trong ngày${o.active ? '' : ' · đã ngừng'}`;

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return new Error(body?.message?.trim() || fallback);
}

async function send<T>(url: string, method: string, body: unknown, schema: z.ZodType<T>, fallback: string) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res, fallback);
  return schema.parse(await res.json());
}

export async function fetchGiftShops(): Promise<GiftShop[]> {
  const res = await fetch('/api/settings/gift-shops');
  if (!res.ok) throw await failure(res, 'Không tải được danh sách shop');
  return z.array(GiftShop).parse(await res.json());
}

export async function fetchGiftShop(id: string): Promise<GiftShop> {
  const res = await fetch(`/api/settings/gift-shops/${id}`);
  if (!res.ok) throw await failure(res, 'Không tải được shop này');
  return GiftShop.parse(await res.json());
}

export const createGiftShop = (form: GiftShopForm) =>
  send('/api/settings/gift-shops', 'POST', form, GiftShop, 'Không lưu được shop này');

export const updateGiftShop = (id: string, form: GiftShopForm) =>
  send(`/api/settings/gift-shops/${id}`, 'PATCH', form, GiftShop, 'Không lưu được shop này');

export async function fetchGiftShopProducts(shopId: string): Promise<GiftShopProduct[]> {
  const res = await fetch(`/api/settings/gift-shops/${shopId}/products`);
  if (!res.ok) throw await failure(res, 'Không tải được danh sách sản phẩm');
  return z.array(GiftShopProduct).parse(await res.json());
}

/** `shopId` = dòng đã ghi shop: chỉ lấy quà của shop đó. */
export async function fetchGiftChoices(shopId?: string): Promise<GiftChoices> {
  const res = await fetch(`/api/reference/gift-choices${shopId ? `?shopId=${shopId}` : ''}`);
  if (!res.ok) throw await failure(res, 'Không tải được danh sách quà');
  return GiftChoices.parse(await res.json());
}

export const createGiftShopProduct = (shopId: string, form: GiftShopProductForm) =>
  send(
    `/api/settings/gift-shops/${shopId}/products`,
    'POST',
    form,
    GiftShopProduct,
    'Không lưu được sản phẩm này',
  );

export const updateGiftShopProduct = (shopId: string, productId: string, form: GiftShopProductForm) =>
  send(
    `/api/settings/gift-shops/${shopId}/products/${productId}`,
    'PATCH',
    form,
    GiftShopProduct,
    'Không lưu được sản phẩm này',
  );
