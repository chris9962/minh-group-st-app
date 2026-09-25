import { eq, inArray } from "drizzle-orm";
import type { QuotaKindItem } from "../src/lib/api/quota";
import { db } from "../src/server/db/client";
import { banks, departments, users } from "../src/server/db/schema";
import { getQuotaMonth, saveQuotaMonth } from "../src/server/quota";

/**
 * Nhập chỉ tiêu tháng 2026-09 theo QĐ 145 ngày 2026-08-31 vào màn Chỉ tiêu tháng.
 *
 * Chạy khô, in số sẽ ghi:
 *   bun run db:seed-quota-2026-09
 * Ghi thật, khai tên đăng nhập người chịu trách nhiệm:
 *   bun run db:seed-quota-2026-09 -- --apply --as=admin
 *
 * Ghi đè toàn bộ chỉ tiêu tháng 2026-09 nếu tháng đó đã lưu. Lương tháng
 * 2026-09 đã chốt thì dừng, không ghi gì.
 */

const MONTH = "2026-09";

/** QĐ 145 Phụ lục 1, dòng nhân viên HĐLĐ. */
const STAFF = { hkd: 4, directed: 50, casa: 1 };

/** QĐ 145 Phụ lục 2. Khoá là tên phòng trong app; tên trong QĐ ghi ở comment. */
const DEPARTMENTS: Record<string, { hkd: number; directed: number; casa: number }> = {
  "Phòng Kinh doanh 1": { hkd: 46, directed: 575, casa: 12 }, // Phòng KD 1
  "Phòng Kinh doanh 2": { hkd: 34, directed: 425, casa: 9 },
  "Phòng Kinh doanh 3": { hkd: 38, directed: 475, casa: 10 },
  "Phòng Kinh doanh 4": { hkd: 36, directed: 450, casa: 9 },
  "Phòng Kinh doanh 5": { hkd: 32, directed: 400, casa: 8 },
  "Phòng Kinh doanh 6": { hkd: 32, directed: 400, casa: 8 },
  "Phòng Kinh doanh 7": { hkd: 44, directed: 550, casa: 11 },
  "Phòng Kinh doanh 8": { hkd: 24, directed: 300, casa: 6 },
  "Phòng Kinh doanh 9": { hkd: 32, directed: 400, casa: 8 },
  "Phòng Kinh doanh 10": { hkd: 24, directed: 300, casa: 6 },
  "Phòng Kinh doanh 11": { hkd: 14, directed: 175, casa: 4 },
  "Phòng Y": { hkd: 82, directed: 1025, casa: 21 }, // Phòng KD Y
  "Phòng Dự Án": { hkd: 30, directed: 375, casa: 8 },
};

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const asUsername = args.find((a) => a.startsWith("--as="))?.slice("--as=".length);

async function main() {
  const [vpa] = await db.select({ id: banks.id }).from(banks).where(eq(banks.code, "VPa"));
  if (!vpa) throw new Error('Không có ngân hàng mã "VPa".');
  const hkdKinds: QuotaKindItem[] = [{ bankId: vpa.id, accountType: "HKD" }];
  const directedKinds: QuotaKindItem[] = [
    { bankId: vpa.id, accountType: "none" },
    { bankId: vpa.id, accountType: "CNKD" },
  ];

  const found = await db
    .select({ id: departments.id, name: departments.name, type: departments.type })
    .from(departments)
    .where(inArray(departments.name, Object.keys(DEPARTMENTS)));
  const missing = Object.keys(DEPARTMENTS).filter((name) => !found.some((d) => d.name === name));
  if (missing.length) throw new Error(`Không có phòng: ${missing.join(", ")}`);
  const notSales = found.filter((d) => d.type !== "sales");
  if (notSales.length)
    throw new Error(`Phòng không phải loại sales, lương không chấm: ${notSales.map((d) => d.name).join(", ")}`);

  const current = await getQuotaMonth(MONTH);
  console.log(`Tháng ${MONTH}: ${current.copiedFrom === null && current.staffDirected !== null ? "ĐÃ có chỉ tiêu, sẽ ghi đè" : "chưa lưu"}.`);
  console.log("Mỗi nhân viên HĐLĐ:", STAFF);
  for (const d of found) console.log(`- ${d.name}:`, DEPARTMENTS[d.name]);
  console.log("HKD: VPa loại HKD. Tài khoản định hướng: VPa Thường, VPa CNKD.");

  if (!apply) {
    console.log("\nChạy khô, chưa ghi gì. Thêm --apply --as=<tên đăng nhập> để ghi.");
    return;
  }
  if (!asUsername) throw new Error("Ghi thật phải có --as=<tên đăng nhập>.");
  const [actor] = await db.select({ id: users.id }).from(users).where(eq(users.username, asUsername));
  if (!actor) throw new Error(`Không có tài khoản "${asUsername}".`);

  // Giữ nguyên phòng không có trong QĐ 145 nếu tháng đó đã có số.
  const saved = await saveQuotaMonth(
    MONTH,
    {
      staffHkd: STAFF.hkd,
      staffDirected: STAFF.directed,
      staffCasa: STAFF.casa,
      departments: current.departments.map((d) => {
        const target = found.find((f) => f.id === d.departmentId);
        return target
          ? { departmentId: d.departmentId, ...DEPARTMENTS[target.name] }
          : { departmentId: d.departmentId, hkd: d.hkd, directed: d.directed, casa: d.casa };
      }),
      hkdKinds,
      directedKinds,
    },
    actor.id,
  );
  if (!saved) throw new Error(`Lương tháng ${MONTH} đã chốt, không ghi chỉ tiêu.`);
  console.log(`\nĐã ghi chỉ tiêu tháng ${MONTH}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
