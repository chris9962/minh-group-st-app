import { and, asc, count, eq, inArray, like } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { auditLog, bankAccounts, customers, hamlets, provinces, wards } from "../src/server/db/schema";

/**
 * Đưa tên ấp trong hồ sơ khách về tên HIỆN TẠI của ấp, sau khi ấp bị đổi tên.
 *
 * Kênh Ấp lưu chuỗi "Ấp, Xã, Tỉnh" vào `customers.address`,
 * `customers.channel_detail` và `bank_accounts.channel_detail`. Đổi tên ấp ở
 * danh mục không sửa ba cột này (chốt 2026-09-02), nên ấp gõ sai rồi sửa tên thì
 * hồ sơ cũ giữ chuỗi sai: ô Địa chỉ không còn khớp gợi ý nào, và báo cáo gom
 * theo ấp tách ấp đó làm hai nhóm. Ví dụ: ấp "Ấp Tân Tây 4, Tân Đông , Đồng
 * Tháp" đổi thành "Tân Tây 4" ngày 2026-10-26, 269 hồ sơ còn chuỗi cũ.
 *
 * Tên cũ đọc từ dòng "Đổi tên ấp X thành Y" của `audit_log`. Ấp đổi tên nhiều
 * lần thì mọi tên cũ đều về tên hiện tại. Tên cũ đang là tên một ấp khác cùng xã
 * thì bỏ qua: hồ sơ mang chuỗi đó có thể thuộc ấp kia.
 *
 * Chạy khô, in số dòng sẽ đổi:
 *   bun run db:fix-renamed-hamlet
 * Ghi thật:
 *   bun run db:fix-renamed-hamlet -- --apply
 *
 * Không ghi lịch sử sửa của khách. Chạy lại nhiều lần vô hại.
 */

const RENAME_LABEL = /^Đổi tên ấp (.+?) thành .+ \(.+\)$/;

async function main() {
  const apply = process.argv.includes("--apply");

  const renames = await db
    .select({ hamletId: auditLog.targetId, label: auditLog.targetLabel })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.targetTable, "hamlets"),
        eq(auditLog.action, "update"),
        like(auditLog.targetLabel, "Đổi tên ấp %"),
      ),
    )
    .orderBy(asc(auditLog.at));

  const current = await db
    .select({ id: hamlets.id, wardId: hamlets.wardId, name: hamlets.name, ward: wards.name, province: provinces.name })
    .from(hamlets)
    .innerJoin(wards, eq(wards.id, hamlets.wardId))
    .innerJoin(provinces, eq(provinces.id, wards.provinceId));
  const byId = new Map(current.map((h) => [h.id, h]));
  const namesInWard = new Set(current.map((h) => `${h.wardId}|${h.name}`));

  const mapping = new Map<string, string>();
  for (const r of renames) {
    const oldName = RENAME_LABEL.exec(r.label)?.[1];
    const h = r.hamletId ? byId.get(r.hamletId) : undefined;
    if (!oldName || !h || oldName === h.name) continue;
    if (namesInWard.has(`${h.wardId}|${oldName}`)) {
      console.log(`  Bỏ qua "${oldName}" (${h.ward}): xã đang có ấp mang tên này.`);
      continue;
    }
    mapping.set(`${oldName}, ${h.ward}, ${h.province}`, `${h.name}, ${h.ward}, ${h.province}`);
  }

  const froms = [...mapping.keys()];
  if (froms.length === 0) {
    console.log("Không có tên ấp cũ nào.");
    process.exit(0);
  }

  const [addressRows, channelRows, accountRows] = await Promise.all([
    db
      .select({ value: customers.address, n: count() })
      .from(customers)
      .where(inArray(customers.address, froms))
      .groupBy(customers.address),
    db
      .select({ value: customers.channelDetail, n: count() })
      .from(customers)
      .where(inArray(customers.channelDetail, froms))
      .groupBy(customers.channelDetail),
    db
      .select({ value: bankAccounts.channelDetail, n: count() })
      .from(bankAccounts)
      .where(inArray(bankAccounts.channelDetail, froms))
      .groupBy(bankAccounts.channelDetail),
  ]);
  const countOf = (rows: { value: string; n: number }[]) => new Map(rows.map((r) => [r.value, r.n]));
  const addressCount = countOf(addressRows);
  const channelCount = countOf(channelRows);
  const accountCount = countOf(accountRows);

  const todo = froms.filter((f) => addressCount.has(f) || channelCount.has(f) || accountCount.has(f));
  let total = { address: 0, channel: 0, account: 0 };
  for (const from of todo) {
    const a = addressCount.get(from) ?? 0;
    const c = channelCount.get(from) ?? 0;
    const b = accountCount.get(from) ?? 0;
    total = { address: total.address + a, channel: total.channel + c, account: total.account + b };
    console.log(`  "${from}"\n    -> "${mapping.get(from)}"\n    địa chỉ ${a}, kênh ${c}, tài khoản ${b}`);
  }
  console.log(
    `${todo.length} tên ấp cũ: địa chỉ ${total.address} hồ sơ, kênh ${total.channel} hồ sơ, ${total.account} tài khoản` +
      `${apply ? "" : " (CHẠY KHÔ, không ghi gì)"}.`,
  );
  if (!apply) {
    console.log("Thêm --apply để ghi.");
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    for (const from of todo) {
      const to = mapping.get(from)!;
      await tx.update(customers).set({ address: to }).where(eq(customers.address, from));
      await tx.update(customers).set({ channelDetail: to }).where(eq(customers.channelDetail, from));
      await tx.update(bankAccounts).set({ channelDetail: to }).where(eq(bankAccounts.channelDetail, from));
    }
  });
  console.log("Đã ghi.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
