import { hashSync } from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import vnAddress from "./data/vnAddress.json";
import * as schema from "../src/server/db/schema";
import {
  ACCOUNTS,
  BANKS,
  CHANNELS,
  DEPARTMENTS,
  GIFT_ITEMS,
  GIFT_RULES,
  HOSPITALS,
  INSURANCE_PACKAGES,
  KPI_TARGET,
  REFERRAL_CODES,
  SERVICE_TYPES,
} from "./seed-data";

/**
 * Seed khởi tạo — CHỈ cấu trúc + danh mục thật (scripts/seed-data.ts), không
 * có dữ liệu nghiệp vụ giả. Idempotent: bảng nào đã có dữ liệu thì bỏ qua
 * nguyên khối, không chèn đè.
 */

const DEMO_PASSWORD_HASH = hashSync("12345678", 10);

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  const count = async (name: string): Promise<number> => {
    const r = await pool.query(`select count(*)::int as n from ${name}`);
    return r.rows[0].n;
  };

  /* Phòng ban */
  if ((await count("departments")) === 0) {
    await db.insert(schema.departments).values(DEPARTMENTS.map((name) => ({ name })));
  }
  const departmentIdByName = new Map(
    (await db.select().from(schema.departments)).map((d) => [d.name, d.id]),
  );

  /* Tài khoản + quyền + phòng quản */
  if ((await count("users")) === 0) {
    for (const a of ACCOUNTS) {
      const [row] = await db
        .insert(schema.users)
        .values({
          username: a.username,
          passwordHash: DEMO_PASSWORD_HASH,
          fullName: a.fullName,
          phone: "0900000000",
          role: a.role,
          title: a.title,
          departmentId: a.departmentName
            ? (departmentIdByName.get(a.departmentName) ?? null)
            : null,
          manageScope: a.manageScope,
        })
        .returning({ id: schema.users.id });

      if (a.permissions.length > 0)
        await db.insert(schema.userPermissions).values(
          a.permissions.map((perm) => ({
            userId: row.id,
            module: perm.module,
            action: perm.action,
            scope: perm.scope,
          })),
        );

      const managed = a.managedDepartmentNames
        .map((name) => departmentIdByName.get(name))
        .filter((x): x is string => Boolean(x));
      if (managed.length > 0)
        await db.insert(schema.userManagedDepartments).values(
          managed.map((departmentId) => ({ userId: row.id, departmentId })),
        );
    }
  }

  /* Danh mục ngân hàng + kho mã */
  if ((await count("banks")) === 0) {
    await db.insert(schema.banks).values(
      BANKS.map((b) => ({
        code: b.code,
        requiredPhotos: b.requiredPhotos,
        accountNumberMethod: b.accountNumberMethod,
        coefficient: b.coefficient,
        countsAsApp: b.countsAsApp,
      })),
    );
  }
  const bankIdByCode = new Map(
    (await db.select().from(schema.banks)).map((b) => [b.code, b.id]),
  );

  if ((await count("referral_codes")) === 0) {
    await db.insert(schema.referralCodes).values(
      REFERRAL_CODES.map((c) => ({
        bankId: bankIdByCode.get(c.bankCode)!,
        code: c.code,
        total: c.total,
      })),
    );
  }

  /* Kênh · bệnh viện · loại dịch vụ · quà · gói BH */
  if ((await count("channels")) === 0)
    await db.insert(schema.channels).values(CHANNELS.map((c) => ({ ...c })));
  if ((await count("hospitals")) === 0)
    await db.insert(schema.hospitals).values(HOSPITALS.map((name) => ({ name })));
  if ((await count("service_types")) === 0)
    await db.insert(schema.serviceTypes).values(SERVICE_TYPES.map((s) => ({ ...s })));
  if ((await count("gift_items")) === 0)
    await db.insert(schema.giftItems).values(GIFT_ITEMS.map((name) => ({ name })));
  if ((await count("insurance_packages")) === 0)
    await db.insert(schema.insurancePackages).values(INSURANCE_PACKAGES.map((x) => ({ ...x })));

  /* Quy tắc quà — tra ngân hàng/kênh/món ra uuid */
  if ((await count("gift_rules")) === 0) {
    const channelIdByName = new Map(
      (await db.select().from(schema.channels)).map((c) => [c.name, c.id]),
    );
    const giftItemIdByName = new Map(
      (await db.select().from(schema.giftItems)).map((g) => [g.name, g.id]),
    );
    const packageIdByName = new Map(
      (await db.select().from(schema.insurancePackages)).map((x) => [x.name, x.id]),
    );

    for (const r of GIFT_RULES) {
      const [rule] = await db
        .insert(schema.giftRules)
        .values({
          sortOrder: r.sortOrder,
          giftGroup: r.giftGroup,
          mode: r.mode,
          requiredBankId: r.requiredBankCode
            ? (bankIdByCode.get(r.requiredBankCode) ?? null)
            : null,
          requiresCnkd: r.requiresCnkd,
          appCountComparator: r.appCountComparator,
          appCountValue: r.appCountValue,
          channelId: r.channelName ? (channelIdByName.get(r.channelName) ?? null) : null,
          cashAmount: r.cashAmount,
          effectiveFrom: r.effectiveFrom,
        })
        .returning({ id: schema.giftRules.id });

      if (r.itemNames.length > 0)
        await db.insert(schema.giftRuleItems).values(
          r.itemNames.map((name) => ({
            ruleId: rule.id,
            giftItemId: giftItemIdByName.get(name) ?? null,
            insurancePackageId: giftItemIdByName.has(name)
              ? null
              : (packageIdByName.get(name) ?? null),
          })),
        );
    }
  }

  /* Chỉ tiêu KPI — mốc chung toàn công ty cho tháng hiện tại */
  if ((await count("kpi_targets")) === 0) {
    const yearMonth = new Date().toISOString().slice(0, 7);
    await db.insert(schema.kpiTargets).values({ yearMonth, ...KPI_TARGET });
  }

  /* Tham chiếu tỉnh/xã — 34 tỉnh + 3.321 xã từ address-kit, chỉ đọc */
  if ((await count("ref_provinces")) === 0) {
    await db.insert(schema.refProvinces).values(vnAddress.provinces);
    const wardRows = vnAddress.wards as { id: string; provinceId: string; name: string }[];
    for (let i = 0; i < wardRows.length; i += 500) {
      await db.insert(schema.refWards).values(wardRows.slice(i, i + 500));
    }
  }

  const users = await db.select({ id: schema.users.id }).from(schema.users);
  console.log(
    `Seed xong: ${DEPARTMENTS.length} phòng · ${users.length} tài khoản · ` +
      `${BANKS.length} ngân hàng · ${GIFT_RULES.length} quy tắc quà · ` +
      `${vnAddress.provinces.length} tỉnh tham chiếu.`,
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
