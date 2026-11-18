import { and, asc, desc, eq, gte, inArray, isNotNull, lt, max, or, sql, type SQL } from "drizzle-orm";
import {
  GiftCategory,
  type GiftChoices,
  type GiftShop,
  type GiftShopForm,
  type GiftShopOption,
  type GiftShopProduct,
  type GiftShopProductForm,
} from "@/lib/api/giftShops";
import { BUSINESS_TIMEZONE, businessDay } from "@/lib/format";
import { db, uniqueViolationOf } from "./db/client";
import { bankAccounts, giftShopProducts, giftShops } from "./db/schema";
import { imageKeyOf, imageUrl } from "./storage";

export type GiftShopWrite<T> = { ok: true; item: T } | { ok: false; reason: "name-taken" };

async function giftShopWrite<T>(run: () => Promise<T>): Promise<GiftShopWrite<T>> {
  try {
    return { ok: true, item: await run() };
  } catch (e) {
    if (uniqueViolationOf(e) === null) throw e;
    return { ok: false, reason: "name-taken" };
  }
}

// So `finished_at` với hai mốc giờ thay vì đổi cột sang ngày, để câu đếm dùng được index.
const finishedToday = (): SQL => {
  const day = businessDay();
  const start = sql`(${day}::date)::timestamp at time zone ${BUSINESS_TIMEZONE}`;
  const end = sql`(${day}::date + 1)::timestamp at time zone ${BUSINESS_TIMEZONE}`;
  return and(gte(bankAccounts.finishedAt, start), lt(bankAccounts.finishedAt, end))!;
};

/* ── Màn quản lý ──────────────────────────────────────────────────────── */

function selectShops(where?: SQL) {
  const usage = db
    .select({
      shopId: bankAccounts.giftShopId,
      today: sql<number>`(count(*) filter (where ${finishedToday()}))::int`.as("today"),
      total: sql<number>`count(*)::int`.as("total"),
    })
    .from(bankAccounts)
    .where(isNotNull(bankAccounts.giftShopId))
    .groupBy(bankAccounts.giftShopId)
    .as("usage");

  const products = db
    .select({ shopId: giftShopProducts.shopId, n: sql<number>`count(*)::int`.as("n") })
    .from(giftShopProducts)
    .groupBy(giftShopProducts.shopId)
    .as("products");

  return db
    .select({
      id: giftShops.id,
      name: giftShops.name,
      link: giftShops.link,
      active: giftShops.active,
      todayCount: sql<number>`coalesce(${usage.today}, 0)`,
      totalCount: sql<number>`coalesce(${usage.total}, 0)`,
      productCount: sql<number>`coalesce(${products.n}, 0)`,
    })
    .from(giftShops)
    .leftJoin(usage, eq(usage.shopId, giftShops.id))
    .leftJoin(products, eq(products.shopId, giftShops.id))
    .where(where)
    .orderBy(desc(giftShops.active), asc(giftShops.name));
}

export async function listGiftShops(): Promise<GiftShop[]> {
  return selectShops();
}

export async function giftShopById(id: string): Promise<GiftShop | null> {
  return (await selectShops(eq(giftShops.id, id)))[0] ?? null;
}

export async function createGiftShop(form: GiftShopForm): Promise<GiftShopWrite<GiftShop>> {
  return giftShopWrite(async () => {
    const [row] = await db.insert(giftShops).values(form).returning({ id: giftShops.id });
    return (await giftShopById(row.id))!;
  });
}

/** Ngừng shop thay cho xoá: dòng ShopeePay cũ vẫn trỏ vào id của shop. */
export async function updateGiftShop(id: string, form: GiftShopForm): Promise<GiftShopWrite<GiftShop | null>> {
  return giftShopWrite(async () => {
    const [row] = await db
      .update(giftShops)
      .set(form)
      .where(eq(giftShops.id, id))
      .returning({ id: giftShops.id });
    return row ? giftShopById(row.id) : null;
  });
}

const toProduct = (r: typeof giftShopProducts.$inferSelect): GiftShopProduct => ({
  id: r.id,
  shopId: r.shopId,
  name: r.name,
  price: r.price,
  link: r.link,
  imageUrl: r.image ? imageUrl(r.image) : "",
  category: GiftCategory.catch("other").parse(r.category),
  active: r.active,
});

// Chuỗi không phải khoá của kho ảnh thì ghi null, không ghi link lạ vào database.
const productColumns = ({ imageUrl: url, ...rest }: GiftShopProductForm) => ({
  ...rest,
  image: url ? imageKeyOf(url) : null,
});

/** Danh mục đóng do người gõ tay, vài chục dòng mỗi shop, nên trả trọn danh sách của shop. */
export async function listGiftShopProducts(shopId: string): Promise<GiftShopProduct[]> {
  const rows = await db
    .select()
    .from(giftShopProducts)
    .where(eq(giftShopProducts.shopId, shopId))
    .orderBy(desc(giftShopProducts.active), asc(giftShopProducts.name));
  return rows.map(toProduct);
}

export async function giftShopExists(id: string): Promise<boolean> {
  const [row] = await db.select({ id: giftShops.id }).from(giftShops).where(eq(giftShops.id, id));
  return Boolean(row);
}

export async function createGiftShopProduct(
  shopId: string,
  form: GiftShopProductForm,
): Promise<GiftShopWrite<GiftShopProduct>> {
  return giftShopWrite(async () => {
    const [row] = await db
      .insert(giftShopProducts)
      .values({ ...productColumns(form), shopId })
      .returning();
    return toProduct(row);
  });
}

export async function updateGiftShopProduct(
  shopId: string,
  productId: string,
  form: GiftShopProductForm,
): Promise<GiftShopWrite<GiftShopProduct | null>> {
  return giftShopWrite(async () => {
    const [row] = await db
      .update(giftShopProducts)
      .set(productColumns(form))
      .where(and(eq(giftShopProducts.id, productId), eq(giftShopProducts.shopId, shopId)))
      .returning();
    return row ? toProduct(row) : null;
  });
}

/* ── Modal chọn quà của dòng ShopeePay ────────────────────────────────── */

/**
 * Sản phẩm đang bán của mọi shop đang dùng, shop ít đơn trong ngày đứng trước.
 *
 * Ẩn sản phẩm của shop có nhiều đơn nhất trong ngày (chủ dự án chốt 2026-11-18).
 * Mọi shop bằng số đơn thì không ẩn shop nào, vì ẩn lúc đó là ẩn hết.
 *
 * Truyền `shopId` khi dòng đã ghi shop: chỉ trả quà của shop đó và không ẩn,
 * vì shop đó có thể đang nhiều đơn nhất do chính dòng này.
 */
export async function listGiftChoices(shopId?: string): Promise<GiftChoices> {
  const shops = await selectShops(shopId ? eq(giftShops.id, shopId) : eq(giftShops.active, true));
  const counts = shops.map((s) => s.todayCount);
  const most = Math.max(...counts);
  const hidden = !shopId && most > Math.min(...counts) ? shops.filter((s) => s.todayCount === most) : [];
  const shown = new Map(shops.filter((s) => !hidden.includes(s)).map((s) => [s.id, s]));
  if (shown.size === 0) return { items: [], hiddenShops: [] };

  const rows = await db
    .select()
    .from(giftShopProducts)
    .where(and(eq(giftShopProducts.active, true), inArray(giftShopProducts.shopId, [...shown.keys()])))
    .orderBy(asc(giftShopProducts.name));

  const items = rows
    .map((r) => {
      const shop = shown.get(r.shopId)!;
      return { ...toProduct(r), shopName: shop.name, shopTodayCount: shop.todayCount };
    })
    .sort((a, b) => a.shopTodayCount - b.shopTodayCount);
  return { items, hiddenShops: hidden.map((s) => s.name) };
}

/* ── Bước 2 của dòng ShopeePay ────────────────────────────────────────── */

/**
 * Shop cho ô chọn ở bước 2, shop ít đơn trong ngày nhất đứng đầu. Bằng số đơn thì
 * shop có đơn cuối cũ hơn đứng trước, để đầu ngày các shop không cùng dồn về shop
 * đứng đầu bảng chữ cái.
 *
 * Shop đã ngừng chỉ có mặt khi chính là shop đang gắn trên dòng, để màn sửa vẫn
 * hiện đúng tên.
 */
export async function giftShopOptions(currentShopId: string | null): Promise<GiftShopOption[]> {
  const usage = db
    .select({
      shopId: bankAccounts.giftShopId,
      today: sql<number>`(count(*) filter (where ${finishedToday()}))::int`.as("today"),
      lastAt: max(bankAccounts.finishedAt).as("last_at"),
    })
    .from(bankAccounts)
    .where(isNotNull(bankAccounts.giftShopId))
    .groupBy(bankAccounts.giftShopId)
    .as("usage");

  return db
    .select({
      id: giftShops.id,
      name: giftShops.name,
      link: giftShops.link,
      active: giftShops.active,
      todayCount: sql<number>`coalesce(${usage.today}, 0)`,
    })
    .from(giftShops)
    .leftJoin(usage, eq(usage.shopId, giftShops.id))
    .where(currentShopId ? or(eq(giftShops.active, true), eq(giftShops.id, currentShopId)) : eq(giftShops.active, true))
    .orderBy(sql`coalesce(${usage.today}, 0)`, sql`${usage.lastAt} asc nulls first`, asc(giftShops.name));
}

/**
 * Lỗi khi khai shop ở bước 2 hoặc khi sửa dòng đã hoàn thành; `null` = hợp lệ.
 *
 * Để trống là hợp lệ: nhân viên có lúc mua quà ở shop ngoài danh sách (chủ dự
 * án chốt 2026-11-18). Sửa dòng cũ thì cho giữ shop đã ngừng.
 */
export async function giftShopRejection(picked: string, current: string | null): Promise<string | null> {
  if (!picked || picked === current) return null;
  const [row] = await db
    .select({ active: giftShops.active })
    .from(giftShops)
    .where(eq(giftShops.id, picked));
  if (!row) return "Shop mua quà không có trong danh sách.";
  return row.active ? null : "Shop mua quà này đã ngừng, chọn shop khác.";
}
