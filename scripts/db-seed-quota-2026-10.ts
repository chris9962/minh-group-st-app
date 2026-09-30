import { eq, inArray } from "drizzle-orm";
import type { QuotaKindItem } from "../src/lib/api/quota";
import { bankTierFor } from "../src/rules";
import { db } from "../src/server/db/client";
import { banks, departments, users } from "../src/server/db/schema";
import { getQuotaMonth, saveQuotaMonth } from "../src/server/quota";

/**
 * Nhập chỉ tiêu tháng 2026-10 theo bảng Kế toán gửi 2026-09-29
 * (`mgst-the-le/kpi-tháng 10.jpg`) vào màn Chỉ tiêu tháng.
 *
 * Chạy khô, in số sẽ ghi:
 *   bun run db:seed-quota-2026-10
 * Ghi thật, khai tên đăng nhập người chịu trách nhiệm:
 *   bun run db:seed-quota-2026-10 -- --apply --as=admin
 *
 * Ghi đè toàn bộ chỉ tiêu tháng 2026-10 nếu tháng đó đã lưu. Lương tháng
 * 2026-10 đã chốt thì dừng, không ghi gì. Cần migration 0109.
 *
 * Cột "TK chất lượng" của bảng là CASA (chủ dự án xác nhận 2026-09-29).
 */

const MONTH = "2026-10";

/** Phụ lục 1. */
const STAFF = { hkd: 4, directed: 20, casa: 2 };
const SERVICE = { hkd: 2, directed: 10, casa: 1 };

/**
 * Phụ lục 2. Khoá là tên phòng trong app; tên trong bảng ghi ở comment. Số 0 của
 * bảng ghi thành null: không giao, không chấm. Màn Chỉ tiêu tháng không nhận 0.
 */
const DEPARTMENTS: Record<string, { hkd: number | null; directed: number | null; casa: number }> = {
  "Phòng Kinh doanh 1": { hkd: 46, directed: 230, casa: 23 }, // Phòng KD 1
  "Phòng Kinh doanh 2": { hkd: 34, directed: 170, casa: 17 },
  "Phòng Kinh doanh 3": { hkd: 38, directed: 190, casa: 19 },
  "Phòng Kinh doanh 4": { hkd: 36, directed: 180, casa: 18 },
  "Phòng Kinh doanh 5": { hkd: 32, directed: 160, casa: 16 },
  "Phòng Kinh doanh 6": { hkd: 32, directed: 160, casa: 16 },
  "Phòng Kinh doanh 7": { hkd: 44, directed: 220, casa: 22 },
  "Phòng Kinh doanh 8": { hkd: 24, directed: 120, casa: 12 },
  "Phòng Kinh doanh 9": { hkd: 32, directed: 160, casa: 16 },
  "Phòng Kinh doanh 10": { hkd: 24, directed: 120, casa: 12 },
  "Phòng Kinh doanh 11": { hkd: 14, directed: 70, casa: 7 },
  "Phòng Y": { hkd: null, directed: null, casa: 41 }, // Phòng KD Y
  "Phòng Dự Án": { hkd: 30, directed: null, casa: 15 },
};

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const asUsername = args.find((a) => a.startsWith("--as="))?.slice("--as=".length);

async function main() {
  const found = await db
    .select({ id: departments.id, name: departments.name, type: departments.type })
    .from(departments)
    .where(inArray(departments.name, Object.keys(DEPARTMENTS)));
  const missing = Object.keys(DEPARTMENTS).filter((name) => !found.some((d) => d.name === name));
  if (missing.length) throw new Error(`Không có phòng: ${missing.join(", ")}`);
  const notSales = found.filter((d) => d.type !== "sales");
  if (notSales.length)
    throw new Error(`Phòng không phải loại sales, lương không chấm: ${notSales.map((d) => d.name).join(", ")}`);

  // Bảng tháng 10 không nói loại tài khoản định hướng, nên giữ danh sách của
  // tháng gần nhất đã lưu.
  const current = await getQuotaMonth(MONTH);
  if (current.directedKinds.length === 0)
    throw new Error("Tháng trước chưa chọn tài khoản định hướng. Chọn trên màn Chỉ tiêu tháng trước.");
  const bankRows = await db.select({ id: banks.id, code: banks.code }).from(banks);
  const codeOf = new Map(bankRows.map((b) => [b.id, b.code]));
  // HKD của MỌI ngân hàng trong thể lệ kỳ 2026-10-01 (chủ dự án chốt 2026-09-30).
  // Tháng 9 chỉ đếm VPa HKD; từ kỳ này HKD mở được ở mọi ngân hàng, chép danh
  // sách tháng 9 thì phòng mở HKD ở MB không được đếm.
  const hkdKinds: QuotaKindItem[] = bankRows
    .filter((b) => b.code && bankTierFor(b.code, `${MONTH}-01`) !== null)
    .map((b) => ({ bankId: b.id, accountType: "HKD" }));
  const kindText = (kinds: QuotaKindItem[]) =>
    kinds.map((k) => `${codeOf.get(k.bankId)} ${k.accountType}`).join(", ");

  console.log(
    `Tháng ${MONTH}: ${current.copiedFrom === null && current.staffDirected !== null ? "ĐÃ có chỉ tiêu, sẽ ghi đè" : `chưa lưu, đang dùng ${current.copiedFrom}`}.`,
  );
  console.log("Mỗi nhân viên HĐLĐ:", STAFF);
  console.log("Mỗi nhân viên HĐDV (chỉ lưu):", SERVICE);
  for (const d of found) console.log(`- ${d.name}:`, DEPARTMENTS[d.name]);
  console.log(`HKD: ${kindText(hkdKinds)}.\nTài khoản định hướng: ${kindText(current.directedKinds)}.`);

  if (!apply) {
    console.log("\nChạy khô, chưa ghi gì. Thêm --apply --as=<tên đăng nhập> để ghi.");
    return;
  }
  if (!asUsername) throw new Error("Ghi thật phải có --as=<tên đăng nhập>.");
  const [actor] = await db.select({ id: users.id }).from(users).where(eq(users.username, asUsername));
  if (!actor) throw new Error(`Không có tài khoản "${asUsername}".`);

  // Giữ nguyên phòng không có trong bảng nếu tháng gần nhất đã có số.
  const saved = await saveQuotaMonth(
    MONTH,
    {
      staffHkd: STAFF.hkd,
      staffDirected: STAFF.directed,
      staffCasa: STAFF.casa,
      serviceHkd: SERVICE.hkd,
      serviceDirected: SERVICE.directed,
      serviceCasa: SERVICE.casa,
      departments: current.departments.map((d) => {
        const target = found.find((f) => f.id === d.departmentId);
        return target
          ? { departmentId: d.departmentId, ...DEPARTMENTS[target.name] }
          : { departmentId: d.departmentId, hkd: d.hkd, directed: d.directed, casa: d.casa };
      }),
      hkdKinds,
      directedKinds: current.directedKinds,
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
