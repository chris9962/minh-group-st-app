import { hashSync } from "bcryptjs";
import { businessMonth } from "../src/lib/format";
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
  HOSPITALS,
  INSURANCE_PACKAGES,
  KPI_TARGET,
  SERVICE_TYPES,
} from "./seed-data";

/**
 * Seed khởi tạo — CHỈ cấu trúc + danh mục thật (scripts/seed-data.ts), không
 * có dữ liệu nghiệp vụ giả. Idempotent: bảng nào đã có dữ liệu thì bỏ qua
 * nguyên khối, không chèn đè.
 */

const DEMO_PASSWORD_HASH = hashSync("12345678", 10);

async function main() {
  // `pg` không báo lỗi khi thiếu biến này — nó rơi về localhost:5432 và
  // script sẽ tạo bảng / đổ dữ liệu vào NHẦM database mà không ai biết.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  const count = async (name: string): Promise<number> => {
    const r = await pool.query(`select count(*)::int as n from ${name}`);
    return r.rows[0].n;
  };

  /* Phòng ban */
  if ((await count("departments")) === 0) {
    await db.insert(schema.departments).values(DEPARTMENTS.map((d) => ({ code: d.code, name: d.name })));
  }
  const departmentIdByCode = new Map(
    (await db.select().from(schema.departments)).map((d) => [d.code, d.id]),
  );

  /** Mã sai thì DỪNG HẲN — bỏ qua trong im lặng là quan hệ quản lý rơi mất mà không ai biết. */
  const departmentId = (code: string): string => {
    const id = departmentIdByCode.get(code);
    if (!id) throw new Error(`Seed: không có phòng nào mã "${code}"`);
    return id;
  };

  /* Tài khoản + quyền + phòng quản.
     Cả khối trong MỘT transaction: cổng vào là "bảng users đã có dòng nào chưa",
     nên đổ dở dang rồi lỗi là lần chạy sau bỏ qua cả khối, mất luôn những tài
     khoản chưa kịp tạo — kể cả `admin`, tài khoản duy nhất cấp quyền được. */
  if ((await count("users")) === 0) {
    await db.transaction(async (tx) => {
      for (const a of ACCOUNTS) {
        const [row] = await tx
          .insert(schema.users)
          .values({
            username: a.username,
            staffCode: a.staffCode,
            passwordHash: DEMO_PASSWORD_HASH,
            fullName: a.fullName,
            phone: "0900000000",
            role: a.role,
            title: a.title,
            departmentId: a.departmentCode ? departmentId(a.departmentCode) : null,
            manageScope: a.manageScope,
          })
          .returning({ id: schema.users.id });

        if (a.permissions.length > 0)
          await tx.insert(schema.userPermissions).values(
            a.permissions.map((perm) => ({
              userId: row.id,
              module: perm.module,
              action: perm.action,
              scope: perm.scope,
            })),
          );

        if (a.managedDepartmentCodes.length > 0)
          await tx.insert(schema.userManagedDepartments).values(
            a.managedDepartmentCodes.map((code) => ({
              userId: row.id,
              departmentId: departmentId(code),
            })),
          );
      }
    });
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
  /* Kho mã giới thiệu KHÔNG seed — KDTH nhập mã thật qua P-61/P-62. */

  /* Kênh · bệnh viện · loại dịch vụ · quà · gói BH */
  if ((await count("channels")) === 0)
    await db.insert(schema.channels).values(CHANNELS.map((c) => ({ ...c })));
  if ((await count("hospitals")) === 0)
    await db.insert(schema.hospitals).values(HOSPITALS.map((name) => ({ name })));
  if ((await count("service_types")) === 0)
    await db.insert(schema.serviceTypes).values(SERVICE_TYPES.map((s) => ({ ...s })));
  if ((await count("gift_items")) === 0)
    await db.insert(schema.giftItems).values(GIFT_ITEMS.map((g) => ({ ...g })));
  if ((await count("insurance_packages")) === 0) {
    const packageRows = await db
      .insert(schema.insurancePackages)
      .values(INSURANCE_PACKAGES.map(({ code, name }) => ({ code, name })))
      .returning({ id: schema.insurancePackages.id, code: schema.insurancePackages.code });

    // Gói không có leg là gói không sinh đơn nào — vô dụng. Ghi cùng lượt.
    const idByCode = new Map(packageRows.map((r) => [r.code, r.id]));
    await db.insert(schema.insurancePackageLegs).values(
      INSURANCE_PACKAGES.flatMap((p) =>
        p.legs.map((leg, i) => ({
          packageId: idByCode.get(p.code)!,
          ord: i + 1,
          product: leg.product,
          years: leg.years,
          fee: leg.fee,
        })),
      ),
    );
  }

  /* Quy tắc quà KHÔNG seed — không còn bảng cấu hình; thể lệ nằm ở module code
     theo kỳ `src/rules/YYYY-MM.ts` (spec §5.3, chốt 03/08). */

  /* Chỉ tiêu KPI — mốc chung toàn công ty cho tháng hiện tại */
  if ((await count("kpi_targets")) === 0) {
    const yearMonth = businessMonth();
    await db.insert(schema.kpiTargets).values({ yearMonth, ...KPI_TARGET });
  }

  /* Tham chiếu tỉnh/xã — 34 tỉnh + 3.321 xã từ address-kit, chỉ đọc.
     Transaction vì xã chia 7 lượt insert nhưng cổng vào lại đếm bảng TỈNH:
     gãy giữa chừng là còn thiếu xã mà lần chạy sau tưởng đã xong. */
  if ((await count("ref_provinces")) === 0) {
    await db.transaction(async (tx) => {
      await tx.insert(schema.refProvinces).values(vnAddress.provinces);
      const wardRows = vnAddress.wards as { id: string; provinceId: string; name: string }[];
      for (let i = 0; i < wardRows.length; i += 500) {
        await tx.insert(schema.refWards).values(wardRows.slice(i, i + 500));
      }
    });
  }

  const users = await db.select({ id: schema.users.id }).from(schema.users);
  console.log(
    `Seed xong: ${DEPARTMENTS.length} phòng · ${users.length} tài khoản · ` +
      `${BANKS.length} ngân hàng · ` +
      `${vnAddress.provinces.length} tỉnh tham chiếu.`,
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
