import { and, eq, inArray } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { db } from "../src/server/db/client";
import { bankAccounts, channels, customers, hamlets, provinces, users, wards } from "../src/server/db/schema";

/**
 * Đổi ấp của khách theo một danh sách đã chuẩn (chốt 2026-10-27).
 *
 * Danh sách là file JSON, mỗi dòng `{ cccd, staffCode, address }` với `address`
 * dạng "Ấp, Xã, Tỉnh". Nguồn là file Excel của kế toán; file chứa CCCD nên không
 * nằm trong repo. Script:
 *   1. Tách ấp, xã, tỉnh. Xã chưa có ấp mang tên đó thì thêm ấp.
 *   2. Tìm hồ sơ theo CCCD. CCCD có nhiều hồ sơ thì chọn theo mã nhân viên lập.
 *   3. Ghi `address` vào `customers.address`, `customers.channel_detail` (kênh
 *      ấp) và `bank_accounts.channel_detail` của tài khoản đang mang chuỗi cũ
 *      của hồ sơ hoặc một ấp khác cùng xã. Tài khoản mang kênh khác giữ nguyên.
 *
 * Chạy khô, in số dòng sẽ đổi:
 *   bun --env-file=.env.local scripts/db-fix-hamlet-from-list.ts <file.json>
 * Ghi thật:
 *   bun --env-file=.env.local scripts/db-fix-hamlet-from-list.ts <file.json> --apply
 *
 * Không ghi lịch sử sửa của khách và không ghi audit_log. Chạy lại vô hại.
 */

type Row = { cccd: string; staffCode: string; address: string };

const hamletNameKey = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();

async function main() {
  const path = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!path || path.startsWith("--")) throw new Error("Thiếu đường dẫn file JSON.");
  const rows: Row[] = JSON.parse(readFileSync(path, "utf8"));

  const errors: string[] = [];
  const parsed = rows.map((r) => {
    const parts = r.address.split(", ");
    if (parts.length !== 3) errors.push(`${r.cccd}: địa chỉ không đủ 3 phần "${r.address}"`);
    const [hamlet, ward, province] = parts;
    return { ...r, hamlet, ward, province };
  });

  const wardRows = await db
    .select({ id: wards.id, name: wards.name, province: provinces.name })
    .from(wards)
    .innerJoin(provinces, eq(provinces.id, wards.provinceId));
  const wardOf = new Map(wardRows.map((w) => [`${w.name}|${w.province}`, w.id]));

  const hamletRows = await db.select({ wardId: hamlets.wardId, name: hamlets.name }).from(hamlets);
  const existing = new Map(hamletRows.map((h) => [`${h.wardId}|${hamletNameKey(h.name)}`, h.name]));

  const toCreate = new Map<string, { wardId: string; name: string }>();
  for (const r of parsed) {
    const wardId = wardOf.get(`${r.ward}|${r.province}`);
    if (!wardId) {
      errors.push(`${r.cccd}: không có xã "${r.ward}, ${r.province}"`);
      continue;
    }
    const key = `${wardId}|${hamletNameKey(r.hamlet)}`;
    const found = existing.get(key);
    if (found !== undefined && found !== r.hamlet) {
      errors.push(`${r.cccd}: xã đang có ấp "${found}", khác chữ với "${r.hamlet}"`);
    } else if (found === undefined) {
      toCreate.set(key, { wardId, name: r.hamlet });
    }
  }

  const found = await db
    .select({
      id: customers.id,
      cccd: customers.idNumber,
      address: customers.address,
      channelDetail: customers.channelDetail,
      inputKind: channels.inputKind,
      staffCode: users.username,
    })
    .from(customers)
    .leftJoin(channels, eq(channels.id, customers.channelId))
    .leftJoin(users, eq(users.id, customers.createdBy))
    .where(inArray(customers.idNumber, [...new Set(parsed.map((r) => r.cccd))]));

  const targets = parsed.flatMap((r) => {
    const same = found.filter((c) => c.cccd === r.cccd);
    const picked =
      same.length > 1 ? same.filter((c) => c.staffCode?.toLowerCase() === r.staffCode.toLowerCase()) : same;
    if (picked.length !== 1) {
      errors.push(`${r.cccd}: tìm ra ${picked.length} hồ sơ (mã nhân viên ${r.staffCode})`);
      return [];
    }
    return [{ ...picked[0], to: r.address, sameWard: `, ${r.ward}, ${r.province}` }];
  });
  if (new Set(targets.map((t) => t.id)).size !== targets.length) errors.push("Có hồ sơ xuất hiện hai lần.");

  if (errors.length > 0) {
    console.log(`DỪNG, ${errors.length} lỗi:\n  ${errors.join("\n  ")}`);
    process.exit(1);
  }

  const changed = targets.filter(
    (t) => t.address !== t.to || (t.inputKind === "ward-hamlet" && t.channelDetail !== t.to),
  );
  const accounts = await db
    .select({ id: bankAccounts.id, customerId: bankAccounts.customerId, channelDetail: bankAccounts.channelDetail })
    .from(bankAccounts)
    .where(inArray(bankAccounts.customerId, targets.map((t) => t.id)));
  const byId = new Map(targets.map((t) => [t.id, t]));
  const accountMoves = accounts.flatMap((a) => {
    const t = byId.get(a.customerId)!;
    const old = a.channelDetail;
    // Tài khoản mở lúc hồ sơ còn ghi ấp khác cùng xã, ví dụ "Trường THPT Tân Hiệp" trước khi sửa thành lớp.
    const moves = old === t.address || old === t.channelDetail || old.endsWith(t.sameWard);
    return old !== t.to && moves ? [{ id: a.id, from: old, to: t.to }] : [];
  });

  console.log(`Ấp sẽ thêm: ${toCreate.size}`);
  for (const h of toCreate.values()) console.log(`  + ${h.name}`);
  console.log(`Hồ sơ: ${targets.length} trong danh sách, ${changed.length} sẽ đổi, ${targets.length - changed.length} đã đúng.`);
  console.log(`Tài khoản ngân hàng: ${accountMoves.length} sẽ đổi, ${accounts.length - accountMoves.length} giữ nguyên.`);
  const kept = new Map<string, number>();
  for (const a of accounts) {
    if (accountMoves.some((m) => m.id === a.id) || a.channelDetail === byId.get(a.customerId)!.to) continue;
    kept.set(a.channelDetail, (kept.get(a.channelDetail) ?? 0) + 1);
  }
  for (const [value, n] of kept) console.log(`  giữ nguyên ${n} tài khoản kênh "${value}"`);

  if (!apply) {
    console.log("CHẠY KHÔ, không ghi gì. Thêm --apply để ghi.");
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    if (toCreate.size > 0) await tx.insert(hamlets).values([...toCreate.values()]);
    for (const t of changed) {
      await tx
        .update(customers)
        .set(t.inputKind === "ward-hamlet" ? { address: t.to, channelDetail: t.to } : { address: t.to })
        .where(eq(customers.id, t.id));
    }
    for (const m of accountMoves) {
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
