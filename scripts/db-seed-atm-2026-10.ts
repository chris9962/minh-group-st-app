import { eq, inArray } from "drizzle-orm";
import { businessMonth } from "../src/lib/format";
import { db } from "../src/server/db/client";
import { departments, serviceTypes, users } from "../src/server/db/schema";
import { recomputeForSalaryScheme, recomputeKpiForMonth } from "../src/server/kpi";

/**
 * Nhập dữ liệu của thông báo "Bảng tính lương nhân viên Chuyển đổi số" ngày
 * 2026-09-30, áp từ 2026-10-01: điểm mỗi lượt và trần của từng loại dịch vụ, và
 * danh sách nhân viên trực điểm ATM (cách tính lương `atm`).
 *
 * Chạy khô, in những gì sẽ ghi:
 *   bun run db:seed-atm-2026-10
 * Ghi thật:
 *   bun run db:seed-atm-2026-10 -- --apply
 *
 * Là script chứ không nằm trong migration: danh sách người và mức điểm là dữ
 * liệu của công ty, đổi theo thời gian (chủ dự án chốt 2026-09-30). Sau lượt
 * này, thêm bớt người ở ô "Cách tính lương" của hộp thoại nhân viên, đổi điểm
 * và trần ở màn loại dịch vụ P-84.
 *
 * Thiếu một loại dịch vụ hay một mã nhân viên thì dừng, không ghi gì. Ghi thật
 * chỉ chạy từ tháng 2026-10. Chạy lại nhiều lần vô hại. Cần migration 0111 và 0112.
 *
 * ⚠️ Điểm mỗi lượt không lưu theo tháng. Tháng 2026-09 chưa chốt lương thì mọi
 * lượt tính lại điểm tháng 9 sau lượt ghi này dùng mức điểm mới. Chốt lương
 * tháng 9 trước khi chạy `--apply`.
 */

/** Bảng "Cách tính điểm KPI" của thông báo. Khoá là tên loại dịch vụ trong app. */
const SERVICE_TYPES: Record<
  string,
  { coefficient: number; dailyCap: number | null; monthlyCap: number | null }
> = {
  "Nạp / rút": { coefficient: 0.1, dailyCap: 5, monthlyCap: null }, // Rút, nạp, chuyển tiền
  "Thủ tục hành chính": { coefficient: 0.1, dailyCap: 10, monthlyCap: null }, // Hỗ trợ hành chính công
  "Thanh toán hoá đơn": { coefficient: 0.3, dailyCap: null, monthlyCap: 50 },
  "Bảo hiểm xã hội": { coefficient: 0.1, dailyCap: null, monthlyCap: null }, // Vận động thu BHXH
  "Bảo hiểm y tế": { coefficient: 0.1, dailyCap: null, monthlyCap: null }, // Vận động thu BHYT
  "Nhập liệu BHXH": { coefficient: 0.01, dailyCap: null, monthlyCap: null }, // Nhập hồ sơ bảo hiểm
  "Nhập liệu BHYT": { coefficient: 0.01, dailyCap: null, monthlyCap: null },
  "Hỗ trợ chi BTXH": { coefficient: 0.05, dailyCap: null, monthlyCap: null }, // Chi BTXH
};

/** Danh sách của thông báo, theo mã nhân viên. Điểm ATM ghi ở comment. */
const STAFF_CODES = [
  "273NIHTH", // Xã Tân Thạnh
  "287MENTTT", // Xã Gia Hòa
  "272TRANGNTH", // Xã Ngọc Tố
  "188QUYENLV", // Xã Tân Long
  "282PHUONGSCA", // Xã An Ninh
  "411DUYNN", // Xã Nhơn Mỹ
  "424MUNGPTC", // Xã Thuận Hòa
  "427UYENNDP", // Phường Sóc Trăng
];

/** Tháng thông báo bắt đầu áp dụng. */
const START_MONTH = "2026-10";

const apply = process.argv.slice(2).includes("--apply");

const capText = (daily: number | null, monthly: number | null) =>
  [daily === null ? null : `${daily} lượt/ngày`, monthly === null ? null : `${monthly} lượt/tháng`]
    .filter(Boolean)
    .join(", ") || "không trần";

async function main() {
  const types = await db
    .select()
    .from(serviceTypes)
    .where(inArray(serviceTypes.name, Object.keys(SERVICE_TYPES)));
  const missingTypes = Object.keys(SERVICE_TYPES).filter((name) => !types.some((t) => t.name === name));
  if (missingTypes.length) throw new Error(`Không có loại dịch vụ: ${missingTypes.join(", ")}`);

  const staff = await db
    .select({
      id: users.id,
      staffCode: users.staffCode,
      fullName: users.fullName,
      role: users.role,
      salaryScheme: users.salaryScheme,
      departmentName: departments.name,
      departmentType: departments.type,
    })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(inArray(users.staffCode, STAFF_CODES));
  const missingStaff = STAFF_CODES.filter((code) => !staff.some((s) => s.staffCode === code));
  if (missingStaff.length) throw new Error(`Không có mã nhân viên: ${missingStaff.join(", ")}`);
  // Công thức điểm ATM chỉ áp cho vai Nhân viên ở phòng kinh doanh.
  const unpaid = staff.filter((s) => s.role !== "staff" || s.departmentType !== "sales");
  if (unpaid.length)
    throw new Error(
      `Không phải Nhân viên của phòng kinh doanh, lương điểm ATM không áp: ${unpaid.map((s) => s.staffCode).join(", ")}`,
    );

  console.log("Loại dịch vụ:");
  for (const t of types) {
    const next = SERVICE_TYPES[t.name];
    console.log(
      `- ${t.name}: ${Number(t.coefficient)} điểm, ${capText(t.dailyCap, t.monthlyCap)} → ${next.coefficient} điểm, ${capText(next.dailyCap, next.monthlyCap)}`,
    );
  }
  console.log("\nNhân viên chuyển sang cách tính lương Điểm ATM:");
  for (const s of staff)
    console.log(
      `- ${s.staffCode} ${s.fullName}, ${s.departmentName}${s.salaryScheme === "atm" ? " (đã là Điểm ATM)" : ""}`,
    );

  if (!apply) {
    console.log("\nChạy khô, chưa ghi gì. Thêm --apply để ghi.");
    return;
  }
  // Ghi trước tháng áp dụng là đổi điểm dịch vụ, ngày công và cách tính lương
  // của tháng trước đó: tháng đang chạy đọc hồ sơ hiện tại, rồi bị chụp lại y vậy.
  if (businessMonth() < START_MONTH)
    throw new Error(`Thông báo áp từ tháng ${START_MONTH}. Đang là tháng ${businessMonth()}, không ghi.`);

  await db.transaction(async (tx) => {
    for (const t of types) {
      const next = SERVICE_TYPES[t.name];
      await tx
        .update(serviceTypes)
        .set({
          coefficient: String(next.coefficient),
          dailyCap: next.dailyCap,
          monthlyCap: next.monthlyCap,
        })
        .where(eq(serviceTypes.id, t.id));
    }
    await tx
      .update(users)
      .set({ salaryScheme: "atm" })
      .where(inArray(users.staffCode, STAFF_CODES));
  });

  // Điểm dịch vụ và ngày công theo lượt dịch vụ của 8 người, mọi tháng họ có dữ liệu.
  for (const s of staff) await recomputeForSalaryScheme(s.id);
  // Mức điểm mới áp cho tháng đang chạy của cả công ty: người ngoài nhóm về 0
  // điểm dịch vụ. Cùng cách `updateServiceType` làm khi đổi hệ số ở P-84.
  const month = businessMonth();
  const count = await recomputeKpiForMonth(month);
  console.log(`\nĐã ghi. Tính lại điểm tháng ${month} cho ${count} người.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
