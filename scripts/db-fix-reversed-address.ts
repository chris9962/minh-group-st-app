import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { bankAccounts, channels, customers, hamlets, provinces, wards } from "../src/server/db/schema";

/**
 * Đảo địa chỉ ghi ngược "Tỉnh, Xã, Ấp" về "Ấp, Xã, Tỉnh" (chốt 2026-10-27).
 *
 * Ô gợi ý địa chỉ ghép ngược trước 2026-09-03, nên hồ sơ lập ngày đó mang chuỗi
 * ngược ở `customers.address`, `customers.channel_detail` và
 * `bank_accounts.channel_detail`. Script:
 *   - Có ấp trong danh mục: đảo thành "Ấp, Xã, Tỉnh".
 *   - Chỉ có xã: đảo thành "Xã, Tỉnh", giữ mức xã. Tài khoản chỉ có xã mà hồ
 *     sơ cùng xã đã có ấp vẫn giữ mức xã.
 *   - Tài khoản ghi khác ấp với hồ sơ (kênh Ấp): đổi theo hồ sơ sau khi đảo.
 *   - Chuỗi gõ tay không tách được: giữ nguyên, in ra để người xử lý.
 *
 * Mọi giá trị ghi phải khớp danh mục, không thì dừng và không ghi gì.
 *
 * Chạy khô:  bun --env-file=.env.local scripts/db-fix-reversed-address.ts
 * Ghi thật:  bun --env-file=.env.local scripts/db-fix-reversed-address.ts --apply
 */

const REVERSED = /^(Tỉnh|Thành phố) /;

/** Chuỗi gõ tay đã chốt từng dòng. */
const MANUAL: Record<string, string> = {
  "Tỉnh Đồng Tháp, Xã Tân Long,Tân Hội B": "Tân Hội B, Xã Tân Long, Tỉnh Đồng Tháp",
  "Tỉnh Đồng Tháp, Xã Tân Long tân hội b": "Tân Hội B, Xã Tân Long, Tỉnh Đồng Tháp",
};

async function main() {
  const apply = process.argv.includes("--apply");

  const catalog = await db
    .select({ province: provinces.name, ward: wards.name, hamlet: hamlets.name })
    .from(wards)
    .innerJoin(provinces, eq(provinces.id, wards.provinceId))
    .leftJoin(hamlets, eq(hamlets.wardId, wards.id));
  const valid = new Set<string>();
  for (const c of catalog) {
    valid.add(`${c.ward}, ${c.province}`);
    if (c.hamlet) valid.add(`${c.hamlet}, ${c.ward}, ${c.province}`);
  }

  const fix = (v: string): string | null => {
    if (MANUAL[v]) return MANUAL[v];
    const out = v.split(", ").reverse().join(", ");
    return valid.has(out) ? out : null;
  };

  const isReversed = sql`~ '^(Tỉnh|Thành phố) '`;
  const custRows = await db
    .select({
      id: customers.id,
      address: customers.address,
      channelDetail: customers.channelDetail,
      inputKind: channels.inputKind,
    })
    .from(customers)
    .leftJoin(channels, eq(channels.id, customers.channelId))
    .where(or(sql`${customers.address} ${isReversed}`, sql`${customers.channelDetail} ${isReversed}`));

  const unclear = new Set<string>();
  const custMoves: { id: string; set: { address?: string; channelDetail?: string } }[] = [];
  const profileAfter = new Map<string, string | null>();
  for (const c of custRows) {
    const set: { address?: string; channelDetail?: string } = {};
    if (REVERSED.test(c.address)) {
      const to = fix(c.address);
      if (to) set.address = to;
      else unclear.add(c.address);
    }
    if (REVERSED.test(c.channelDetail)) {
      const to = fix(c.channelDetail);
      if (to) set.channelDetail = to;
      else unclear.add(c.channelDetail);
    }
    if (Object.keys(set).length > 0) custMoves.push({ id: c.id, set });
  }

  const accRows = await db
    .select({
      id: bankAccounts.id,
      channelDetail: bankAccounts.channelDetail,
      customerChannel: customers.channelDetail,
      inputKind: channels.inputKind,
    })
    .from(bankAccounts)
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .leftJoin(channels, eq(channels.id, customers.channelId))
    .where(sql`${bankAccounts.channelDetail} ${isReversed}`);

  for (const c of custRows) {
    profileAfter.set(c.channelDetail, REVERSED.test(c.channelDetail) ? fix(c.channelDetail) : c.channelDetail);
  }
  const profileOf = (current: string) =>
    profileAfter.has(current) ? profileAfter.get(current)! : REVERSED.test(current) ? fix(current) : current;

  const accMoves: { id: string; from: string; to: string; kind: string }[] = [];
  for (const a of accRows) {
    const fixed = fix(a.channelDetail);
    const profile = a.inputKind === "ward-hamlet" ? profileOf(a.customerChannel) : null;
    let to: string | null;
    let kind: string;
    if (fixed && (!profile || fixed === profile)) [to, kind] = [fixed, "đảo"];
    else if (fixed && profile?.endsWith(`, ${fixed}`)) [to, kind] = [fixed, "đảo, giữ mức xã"];
    else if (profile && valid.has(profile)) [to, kind] = [profile, "theo hồ sơ"];
    else [to, kind] = [null, ""];
    if (to) accMoves.push({ id: a.id, from: a.channelDetail, to, kind });
    else unclear.add(a.channelDetail);
  }

  const bad = [
    ...custMoves.flatMap((m) => Object.values(m.set)),
    ...accMoves.map((m) => m.to),
  ].filter((v) => !valid.has(v!));
  if (bad.length > 0) {
    console.log(`DỪNG, ${bad.length} giá trị không khớp danh mục:\n  ${[...new Set(bad)].join("\n  ")}`);
    process.exit(1);
  }

  const addrCount = custMoves.filter((m) => m.set.address).length;
  const chanCount = custMoves.filter((m) => m.set.channelDetail).length;
  console.log(`Hồ sơ: ${custRows.length} ghi ngược, ${custMoves.length} sẽ đổi (địa chỉ ${addrCount}, kênh ${chanCount}).`);
  const byKind = new Map<string, number>();
  for (const m of accMoves) byKind.set(m.kind, (byKind.get(m.kind) ?? 0) + 1);
  console.log(`Tài khoản: ${accRows.length} ghi ngược, ${accMoves.length} sẽ đổi.`);
  for (const [k, n] of byKind) console.log(`  ${k}: ${n}`);
  for (const m of accMoves.filter((m) => m.kind === "theo hồ sơ")) console.log(`    "${m.from}" -> "${m.to}"`);
  const keptCust = custRows.filter((c) => unclear.has(c.address) || unclear.has(c.channelDetail)).length;
  const keptAcc = accRows.length - accMoves.length;
  console.log(`Giữ nguyên vì chưa rõ: ${keptCust} hồ sơ, ${keptAcc} tài khoản.`);
  for (const u of unclear) console.log(`  "${u}"`);

  if (!apply) {
    console.log("CHẠY KHÔ, không ghi gì. Thêm --apply để ghi.");
    process.exit(0);
  }

  const before = new Map(custRows.map((c) => [c.id, c]));
  await db.transaction(async (tx) => {
    for (const m of custMoves) {
      const old = before.get(m.id)!;
      await tx
        .update(customers)
        .set(m.set)
        .where(
          and(
            eq(customers.id, m.id),
            eq(customers.address, old.address),
            eq(customers.channelDetail, old.channelDetail),
          ),
        );
    }
    for (const m of accMoves) {
      await tx
        .update(bankAccounts)
        .set({ channelDetail: m.to })
        .where(and(eq(bankAccounts.id, m.id), eq(bankAccounts.channelDetail, m.from)));
    }
  });
  console.log("Đã ghi.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
