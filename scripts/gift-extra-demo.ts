/**
 * Khách THỬ cho rổ quà phụ HKD (chốt 2026-09-17) — chạy trên DB local:
 *
 *   bun --env-file=.env.local scripts/gift-extra-demo.ts
 *   bun --env-file=.env.local scripts/gift-extra-demo.ts --clean
 *
 * Không chạy trên máy chủ thật. Mọi khách mang địa chỉ `MARKER` để dọn.
 */
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { businessDay } from "../src/lib/format";
import { db } from "../src/server/db/client";
import { giftForCustomer, recomputeGiftCase } from "../src/server/gift";
import { recomputeKpiForCustomer } from "../src/server/kpi";
import {
  bankAccounts,
  banks,
  channels,
  customerChanges,
  customerPhones,
  customers,
  departments,
  giftGrants,
  referralCodes,
  users,
} from "../src/server/db/schema";

const MARKER = "THỬ QUÀ PHỤ - 1 Lê Lợi, Phường Bến Nghé";
const CODE_PREFIX = "THUQP";
const OWNER = "231haonv";

type Acc = { bank: string; type?: "CNKD" | "HKD"; app?: boolean };
type Case = { name: string; note: string; accounts: Acc[]; granted?: { item: string } };

const CASES: Case[] = [
  { name: "Thử Quà Phụ Một", note: "VPa + dòng HKD → TH8: không có quà chính, rổ phụ Loa/Mica", accounts: [{ bank: "VPa" }, { bank: "VPa", type: "HKD" }] },
  { name: "Thử Quà Phụ Hai", note: "MB + VPa + dòng HKD → TH1: gói BH 1 năm + rổ phụ", accounts: [{ bank: "MB" }, { bank: "VPa" }, { bank: "VPa", type: "HKD" }] },
  { name: "Thử Quà Phụ Ba", note: "MB + VPa + LPB + dòng HKD → TH5: gói BH 2 năm + rổ phụ", accounts: [{ bank: "MB" }, { bank: "VPa" }, { bank: "LPB" }, { bank: "VPa", type: "HKD" }] },
  { name: "Thử Quà Phụ Bốn", note: "chỉ dòng HKD → không có quà chính, rổ phụ Loa/Mica", accounts: [{ bank: "VPa", type: "HKD" }] },
  { name: "Thử Quà Phụ Năm", note: "MB + VPa + dòng HKD, ĐÃ phát BH 1 năm trước ngày tách rổ → nút Chọn quà phụ", accounts: [{ bank: "MB" }, { bank: "VPa" }, { bank: "VPa", type: "HKD" }], granted: { item: "BH-1N-XEMAY" } },
  { name: "Thử Quà Phụ Sáu", note: "MB + VPa CNKD → TH1, KHÔNG có rổ phụ (đối chứng)", accounts: [{ bank: "MB" }, { bank: "VPa", type: "CNKD" }] },
];

async function clean() {
  const rows = await db.select({ id: customers.id }).from(customers).where(eq(customers.address, MARKER));
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await db.delete(giftGrants).where(inArray(giftGrants.customerId, ids));
    await db.delete(bankAccounts).where(inArray(bankAccounts.customerId, ids));
    await db.delete(customerPhones).where(inArray(customerPhones.customerId, ids));
    await db.delete(customerChanges).where(or(inArray(customerChanges.customerId, ids), inArray(customerChanges.rootCustomerId, ids)));
    await db.delete(customers).where(inArray(customers.id, ids));
  }
  const codes = await db.select({ id: referralCodes.id }).from(referralCodes).where(like(referralCodes.code, `${CODE_PREFIX}%`));
  for (const c of codes) {
    const [used] = await db.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.referralCodeId, c.id)).limit(1);
    if (!used) await db.delete(referralCodes).where(eq(referralCodes.id, c.id));
  }
  console.log(`Đã dọn ${ids.length} khách thử.`);
}

async function build() {
  const [owner] = await db.select({ id: users.id, departmentId: users.departmentId }).from(users).where(eq(users.username, OWNER)).limit(1);
  if (!owner?.departmentId) throw new Error(`Không thấy ${OWNER}`);
  const [channel] = await db.select({ id: channels.id }).from(channels).where(eq(channels.code, "KENH-TU-DO")).limit(1);
  const bankIdByCode = new Map((await db.select({ id: banks.id, code: banks.code }).from(banks)).map((b) => [b.code, b.id]));
  const [dept] = await db.select({ code: departments.code }).from(departments).where(eq(departments.id, owner.departmentId)).limit(1);

  const codeId = new Map<string, string>();
  for (const [bank, type] of [["MB", "none"], ["VPa", "none"], ["VPa", "HKD"], ["VPa", "CNKD"], ["LPB", "none"]] as const) {
    const code = `${CODE_PREFIX}-${bank}-${type}`;
    const [row] = await db
      .insert(referralCodes)
      .values({ bankId: bankIdByCode.get(bank)!, displayName: code, code, total: 50, accountType: type })
      .onConflictDoNothing({ target: [referralCodes.bankId, referralCodes.accountType, referralCodes.code] })
      .returning({ id: referralCodes.id });
    const id = row?.id ?? (await db.select({ id: referralCodes.id }).from(referralCodes).where(and(eq(referralCodes.bankId, bankIdByCode.get(bank)!), eq(referralCodes.accountType, type), eq(referralCodes.code, code))).limit(1))[0].id;
    codeId.set(`${bank}-${type}`, id);
  }

  const today = businessDay();
  const out: { name: string; id: string; note: string }[] = [];
  for (const [i, c] of CASES.entries()) {
    const customerId = crypto.randomUUID();
    await db.insert(customers).values({
      id: customerId,
      rootCustomerId: customerId,
      fullName: c.name,
      idNumber: `0793019977${String(i).padStart(2, "0")}`,
      address: MARKER,
      channelId: channel.id,
      channelDetail: "Thử rổ quà phụ",
      createdBy: owner.id,
      createdByDepartmentId: owner.departmentId,
    });
    await db.insert(customerPhones).values({ customerId, number: `09889977${String(i).padStart(2, "0")}`, isPrimary: true });
    for (const [k, a] of c.accounts.entries()) {
      await db.insert(bankAccounts).values({
        customerId,
        rootCustomerId: customerId,
        bankId: bankIdByCode.get(a.bank)!,
        referralCodeId: codeId.get(`${a.bank}-${a.type ?? "none"}`)!,
        status: "done",
        accountNumber: `77${String(10_000_000 + i * 100 + k)}`,
        openedDate: today,
        appInstalled: a.app ?? true,
        accountType: a.type ?? "none",
        createdBy: owner.id,
        createdByDepartmentId: owner.departmentId,
      });
    }
    await recomputeGiftCase(customerId);
    await recomputeKpiForCustomer(customerId);

    if (c.granted) {
      // Giả lập đợt phát TRƯỚC 2026-09-17: snapshot không có `extraBasket`,
      // không dòng nào ở `gift_grant_extras` — đúng hình dạng dữ liệu cũ.
      const { extraBasket: _drop, extraSlots: _drop2, ...oldShape } = await giftForCustomer(customerId, c.granted.item);
      await db.insert(giftGrants).values({
        customerId,
        grantedBy: owner.id,
        cashTotal: oldShape.cashTotal,
        chosenItem: c.granted.item,
        snapshot: oldShape,
      });
    }
    out.push({ name: c.name, id: customerId, note: c.note });
  }

  const migrated = await db.execute<{ id: string; chosen_item: string; full_name: string }>(sql`
    select distinct on (g.chosen_item) c.id, g.chosen_item, c.full_name
      from gift_grants g join customers c on c.id = g.customer_id
     where g.chosen_item in ('NONE','UNCHOSEN')
       and exists (select 1 from gift_grant_extras e where e.gift_grant_id = g.id and e.item = 'QUA-LOA')
     order by g.chosen_item, g.granted_at desc`);

  console.log(`Chủ hồ sơ: ${OWNER} · phòng ${dept?.code}\n`);
  for (const o of out) console.log(`${o.name}\n  ${o.note}\n  http://localhost:3002/customers/${o.id}\n`);
  console.log("Đợt cũ đã migration 0095:");
  for (const m of migrated.rows) console.log(`  ${m.chosen_item} · ${m.full_name}\n  http://localhost:3002/customers/${m.id}`);
}

if (process.argv.includes("--clean")) await clean();
else {
  await clean();
  await build();
}
process.exit(0);
