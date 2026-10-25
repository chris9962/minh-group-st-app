import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type {
  GiftStockEntry,
  GiftStockEntryForm,
  GiftStockEntryUpdate,
  GiftStockMonth,
} from "@/lib/api/giftStock";
import { BUSINESS_TIMEZONE } from "@/lib/format";
import { db } from "./db/client";
import { giftItems, giftStockEntries, users } from "./db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Runner = Tx | typeof db;

/**
 * Số món đã ra khỏi kho từ `from` tới trước `to`: quà chính và quà thêm mà khách
 * ĐANG giữ. Đếm món đang giữ là đủ vì đổi quà chỉ làm được trong ngày phát quà: món
 * đổi đi tự trả về kho, món đổi tới tự trừ, cùng ngày với lượt phát.
 */
const issuedSql = (code: SQL, from: SQL, to?: SQL) => sql`((
    select count(*) from gift_grants g
    where g.chosen_item = ${code} and g.granted_at >= ${from} ${to ? sql`and g.granted_at < ${to}` : sql``}
  ) + (
    select count(*) from gift_grant_extras x
    where x.item = ${code} and x.chosen_at >= ${from} ${to ? sql`and x.chosen_at < ${to}` : sql``}
  ))::int`;

/** Mốc nhập quà đầu tiên và tổng số đã nhập của món ở dòng `gift_items` đang xét. */
const stockOf = sql`(
  select min(e.created_at) as since, sum(e.quantity)::int as total
  from gift_stock_entries e where e.gift_item_id = i.id
) s on s.since is not null`;

/** Số còn lại theo mã món. Món chưa nhập quà lần nào không có trong Map: không giới hạn. */
export async function stockRemaining(codes: string[], runner: Runner = db): Promise<Map<string, number>> {
  if (codes.length === 0) return new Map();
  const rows = await runner.execute<{ code: string; remaining: number }>(sql`
    select i.code, s.total - ${issuedSql(sql`i.code`, sql`s.since`)} as remaining
    from gift_items i
    join lateral ${stockOf}
    where i.code in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
  `);
  return new Map(rows.rows.map((r) => [r.code, Number(r.remaining)]));
}

export class OutOfStock extends Error {
  constructor(readonly itemName: string) {
    super(`"${itemName}" đã hết hàng. Chọn món khác trong rổ.`);
  }
}

/**
 * Giữ chỗ trong kho cho các món sắp phát, gọi TRONG transaction ghi lượt phát. Khoá
 * dòng `gift_items` để hai lượt phát song song lúc còn 1 món chỉ một lượt qua: lượt
 * sau chờ khoá, rồi đếm lại sau khi lượt trước commit.
 *
 * Mã không phải món quà (gói bảo hiểm, từ chối) và món chưa nhập quà thì bỏ qua.
 * Khoá theo thứ tự mã để hai lượt phát hai món không chờ nhau vòng tròn.
 */
export async function reserveStock(tx: Tx, codes: string[]): Promise<void> {
  const need = new Map<string, number>();
  for (const code of codes) need.set(code, (need.get(code) ?? 0) + 1);
  for (const code of [...need.keys()].sort()) {
    const [item] = await tx
      .select({ name: giftItems.name })
      .from(giftItems)
      .where(eq(giftItems.code, code))
      .for("update");
    if (!item) continue;
    const remaining = (await stockRemaining([code], tx)).get(code);
    if (remaining !== undefined && remaining < (need.get(code) ?? 0)) throw new OutOfStock(item.name);
  }
}

/** Đầu tháng và đầu tháng sau theo giờ Việt Nam, kiểu `timestamptz`. */
const monthBounds = (month: string) => ({
  start: sql`(${`${month}-01`}::date)::timestamp at time zone ${BUSINESS_TIMEZONE}`,
  finish: sql`(${`${month}-01`}::date + interval '1 month')::timestamp at time zone ${BUSINESS_TIMEZONE}`,
});

const toEntry = (r: {
  id: string;
  giftItemId: string;
  itemName: string;
  quantity: number;
  note: string;
  createdAt: Date;
  updatedAt: Date;
  createdByName: string | null;
}): GiftStockEntry => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  createdByName: r.createdByName ?? "",
});

const entryColumns = {
  id: giftStockEntries.id,
  giftItemId: giftStockEntries.giftItemId,
  itemName: giftItems.name,
  quantity: giftStockEntries.quantity,
  note: giftStockEntries.note,
  createdAt: giftStockEntries.createdAt,
  updatedAt: giftStockEntries.updatedAt,
  createdByName: users.fullName,
};

/**
 * Bảng tổng và danh sách lần nhập của một tháng. Lần nhập tính theo ngày bấm Nhập
 * hàng, lượt phát theo ngày phát quà. Món chỉ hiện từ tháng có lần nhập đầu tiên.
 */
export async function giftStockMonth(month: string): Promise<GiftStockMonth> {
  const { start, finish } = monthBounds(month);
  const inMonth = sql`e.created_at >= ${start} and e.created_at < ${finish}`;

  const [items, entries] = await Promise.all([
    db.execute<{
      id: string;
      name: string;
      active: boolean;
      entered_before: number;
      entry_count: number;
      entry_quantity: number;
      issued_before: number;
      issued_in_month: number;
      remaining: number;
    }>(sql`
      select i.id, i.name, i.active,
        coalesce((select sum(e.quantity) from gift_stock_entries e
          where e.gift_item_id = i.id and e.created_at < ${start}), 0)::int as entered_before,
        (select count(*) from gift_stock_entries e where e.gift_item_id = i.id and ${inMonth})::int as entry_count,
        coalesce((select sum(e.quantity) from gift_stock_entries e
          where e.gift_item_id = i.id and ${inMonth}), 0)::int as entry_quantity,
        ${issuedSql(sql`i.code`, sql`s.since`, start)} as issued_before,
        ${issuedSql(sql`i.code`, sql`greatest(s.since, ${start})`, finish)} as issued_in_month,
        s.total - ${issuedSql(sql`i.code`, sql`s.since`)} as remaining
      from gift_items i
      join lateral ${stockOf}
      where s.since < ${finish}
      order by i.name
    `),
    db
      .select(entryColumns)
      .from(giftStockEntries)
      .innerJoin(giftItems, eq(giftItems.id, giftStockEntries.giftItemId))
      .leftJoin(users, eq(users.id, giftStockEntries.createdBy))
      .where(
        and(
          sql`${giftStockEntries.createdAt} >= ${start}`,
          sql`${giftStockEntries.createdAt} < ${finish}`,
        ),
      )
      .orderBy(desc(giftStockEntries.createdAt)),
  ]);

  return {
    month,
    items: items.rows.map((r) => {
      const opening = Number(r.entered_before) - Number(r.issued_before);
      const entryQuantity = Number(r.entry_quantity);
      const issued = Number(r.issued_in_month);
      return {
        giftItemId: r.id,
        name: r.name,
        active: r.active,
        openingStock: opening,
        entryCount: Number(r.entry_count),
        entryQuantity,
        issued,
        closingStock: opening + entryQuantity - issued,
        remaining: Number(r.remaining),
      };
    }),
    entries: entries.map(toEntry),
  };
}

async function entryById(id: string, runner: Runner = db): Promise<GiftStockEntry | null> {
  const [row] = await runner
    .select(entryColumns)
    .from(giftStockEntries)
    .innerJoin(giftItems, eq(giftItems.id, giftStockEntries.giftItemId))
    .leftJoin(users, eq(users.id, giftStockEntries.createdBy))
    .where(eq(giftStockEntries.id, id))
    .limit(1);
  return row ? toEntry(row) : null;
}

export async function createGiftStockEntry(
  actorId: string,
  form: GiftStockEntryForm,
): Promise<GiftStockEntry | null> {
  const [item] = await db.select({ id: giftItems.id }).from(giftItems).where(eq(giftItems.id, form.giftItemId));
  if (!item) return null;
  const [row] = await db
    .insert(giftStockEntries)
    .values({ giftItemId: form.giftItemId, quantity: form.quantity, note: form.note, createdBy: actorId })
    .returning({ id: giftStockEntries.id });
  return entryById(row.id);
}

export type UpdateStockOutcome =
  | { ok: true; entry: GiftStockEntry; previousQuantity: number }
  | { ok: false; message: string };

class NegativeStock extends Error {
  constructor(readonly remaining: number) {
    super("negative stock");
  }
}

/**
 * Sửa số lượng hoặc ghi chú của một lần nhập. Sửa xong mà số còn lại âm thì không
 * lưu: số đã phát là việc đã xảy ra, nên số nhập phải đủ cho số đó.
 */
export async function updateGiftStockEntry(
  id: string,
  form: GiftStockEntryUpdate,
): Promise<UpdateStockOutcome | null> {
  const [current] = await db
    .select({ quantity: giftStockEntries.quantity, code: giftItems.code, itemId: giftItems.id })
    .from(giftStockEntries)
    .innerJoin(giftItems, eq(giftItems.id, giftStockEntries.giftItemId))
    .where(eq(giftStockEntries.id, id));
  if (!current) return null;

  try {
    const entry = await db.transaction(async (tx) => {
      // Cùng khoá với lượt phát quà, để số còn lại không đổi giữa lúc sửa và lúc kiểm.
      await tx.select({ id: giftItems.id }).from(giftItems).where(eq(giftItems.id, current.itemId)).for("update");
      await tx
        .update(giftStockEntries)
        .set({ quantity: form.quantity, note: form.note, updatedAt: new Date() })
        .where(eq(giftStockEntries.id, id));
      const remaining = (await stockRemaining([current.code], tx)).get(current.code) ?? 0;
      if (remaining < 0) throw new NegativeStock(remaining);
      return entryById(id, tx);
    });
    if (!entry) return null;
    return { ok: true, entry, previousQuantity: current.quantity };
  } catch (e) {
    if (e instanceof NegativeStock)
      return {
        ok: false,
        message: `Sửa xong thì số còn lại là ${e.remaining}. Số đã phát lớn hơn số nhập, kiểm lại số lượng.`,
      };
    throw e;
  }
}
