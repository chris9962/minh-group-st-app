import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray, isNull } from "drizzle-orm";
import { db } from "../src/server/db/client";
import type { GiftCategory } from "../src/lib/api/giftShops";
import { giftShopProducts, giftShops } from "../src/server/db/schema";
import { putImage } from "../src/server/storage";

/**
 * Nạp shop mua quà ShopeePay và sản phẩm từ `scripts/data/gift-shops.json`.
 *
 * Shop trùng tên, sản phẩm trùng tên trong cùng shop thì giữ nguyên, nên chạy
 * lại không đổi gì. Sản phẩm còn loại `other` thì nhận loại trong file. Sản
 * phẩm chưa có ảnh thì lấy ảnh theo thứ tự:
 * - `image`: khoá đã nằm trong kho ảnh, ghi thẳng vào database.
 * - `imageSource`: link ảnh trên CDN Shopee, script tải về rồi đưa qua `putImage`.
 *
 * ⚠️ `putImage` ghi vào kho ảnh mà `.env.local` trỏ tới. Máy local đang dùng
 * chung bucket `mgst-images` với production.
 *
 *   bun run db:seed-gift-shops
 */
type SeedProduct = {
  name: string;
  category: GiftCategory;
  price: string;
  link: string;
  image?: string;
  imageSource?: string;
};
type SeedShop = { name: string; link: string; products: SeedProduct[] };

const DATA_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "data/gift-shops.json");

async function uploadFrom(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "image/jpeg";
  const result = await putImage(new File([await res.arrayBuffer()], "shopee.jpg", { type }), "gift-shops");
  if (!result.ok) throw new Error(result.message);
  return result.key;
}

async function main() {
  const shops: SeedShop[] = JSON.parse(await readFile(DATA_FILE, "utf8"));

  const addedShops = await db
    .insert(giftShops)
    .values(shops.map(({ name, link }) => ({ name, link })))
    .onConflictDoNothing({ target: giftShops.name })
    .returning({ id: giftShops.id });

  const shopRows = await db
    .select({ id: giftShops.id, name: giftShops.name })
    .from(giftShops)
    .where(inArray(giftShops.name, shops.map((s) => s.name)));
  const shopIdOf = new Map(shopRows.map((r) => [r.name, r.id]));

  const addedProducts = await db
    .insert(giftShopProducts)
    .values(
      shops.flatMap((s) =>
        s.products.map((p) => ({
          shopId: shopIdOf.get(s.name)!,
          name: p.name,
          category: p.category,
          price: p.price,
          link: p.link,
        })),
      ),
    )
    .onConflictDoNothing({ target: [giftShopProducts.shopId, giftShopProducts.name] })
    .returning({ id: giftShopProducts.id });

  const seedOf = new Map(
    shops.flatMap((s) => s.products.map((p) => [`${shopIdOf.get(s.name)}/${p.name}`, p] as const)),
  );
  const uncategorized = await db
    .select({ id: giftShopProducts.id, shopId: giftShopProducts.shopId, name: giftShopProducts.name })
    .from(giftShopProducts)
    .where(eq(giftShopProducts.category, "other"));

  let categorized = 0;
  for (const row of uncategorized) {
    const category = seedOf.get(`${row.shopId}/${row.name}`)?.category;
    if (!category || category === "other") continue;
    await db.update(giftShopProducts).set({ category }).where(eq(giftShopProducts.id, row.id));
    categorized++;
  }

  const missing = await db
    .select({ id: giftShopProducts.id, shopId: giftShopProducts.shopId, name: giftShopProducts.name })
    .from(giftShopProducts)
    .where(isNull(giftShopProducts.image));

  let images = 0;
  const failed: string[] = [];
  for (const row of missing) {
    const seed = seedOf.get(`${row.shopId}/${row.name}`);
    if (!seed?.image && !seed?.imageSource) continue;
    try {
      const key = seed.image ?? (await uploadFrom(seed.imageSource!));
      await db.update(giftShopProducts).set({ image: key }).where(eq(giftShopProducts.id, row.id));
      images++;
    } catch (e) {
      failed.push(`${row.name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`Shop: thêm ${addedShops.length}, giữ nguyên ${shops.length - addedShops.length}.`);
  console.log(`Sản phẩm: thêm ${addedProducts.length}, ghi loại quà ${categorized}.`);
  console.log(`Ảnh: nạp ${images}, lỗi ${failed.length}.`);
  if (failed.length > 0) console.log(failed.join("\n"));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
