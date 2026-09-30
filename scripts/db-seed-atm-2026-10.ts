import { eq, inArray } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { departments, serviceTypes, users } from "../src/server/db/schema";

/**
 * Nhập dữ liệu của thông báo "Bảng tính lương nhân viên Chuyển đổi số" ngày
 * 2026-09-30, áp từ 2026-10-01: điểm mỗi lượt và trần của từng loại dịch vụ, ba
 * loại dịch vụ còn thiếu, và danh sách nhân viên trực điểm ATM (cách tính lương
 * `atm`).
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
 * Thiếu một loại dịch vụ hay một mã nhân viên thì dừng, không ghi gì. Chạy lại
 * nhiều lần vô hại. Cần migration 0111 và 0112. Không còn chặn ghi trước tháng
 * 2026-10: chủ dự án yêu cầu ghi ngay tối 2026-09-30.
 *
 * Script KHÔNG tính lại điểm (chủ dự án chốt 2026-09-30): chạy đầu tháng 2026-10
 * thì tháng đó chưa có dữ liệu, còn tính lại tháng cũ của 8 người làm điểm dịch
 * vụ tháng 2026-09 về 0, vì tháng đó chưa ai là Điểm ATM. Chạy giữa tháng thì
 * chạy thêm `bun run kpi:recompute <tháng>` cho tháng đang chạy.
 *
 * ⚠️ Điểm mỗi lượt không lưu theo tháng. Tháng 2026-09 chưa chốt lương thì app
 * vẫn tự tính lại điểm tháng 9 của một người khi tài khoản ngân hàng của khách
 * tháng 9 đổi trạng thái, và lượt đó dùng luật mới.
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

/**
 * Ba dòng của bảng chưa có loại dịch vụ trong app; script tạo khi chưa có.
 * `active: false` cho dòng thông báo ghi "nếu có ký hợp đồng": bật ở P-84 khi
 * công ty ký hợp đồng. Loại đã có thì chỉ đặt lại điểm, giữ nguyên trạng thái.
 */
const NEW_SERVICE_TYPES: Record<string, { coefficient: number; active: boolean }> = {
  "Tích hợp VNeID": { coefficient: 0.01, active: true }, // Tích hợp tiện ích lên VNeID
  "Bồi thường BH học sinh": { coefficient: 0.1, active: false }, // Tiếp nhận hồ sơ bồi thường bảo hiểm học sinh
  "Phát triển đại lý": { coefficient: 3, active: true }, // Phát triển đại lý BHXH, BHYT, BHXM, Top Up
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
  const existingNew = await db
    .select({ name: serviceTypes.name })
    .from(serviceTypes)
    .where(inArray(serviceTypes.name, Object.keys(NEW_SERVICE_TYPES)));
  const toCreate = Object.entries(NEW_SERVICE_TYPES).filter(
    ([name]) => !existingNew.some((t) => t.name === name),
  );

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
  console.log("\nLoại dịch vụ tạo mới:");
  for (const [name, next] of Object.entries(NEW_SERVICE_TYPES))
    console.log(
      toCreate.some(([created]) => created === name)
        ? `- ${name}: ${next.coefficient} điểm, không trần, ${next.active ? "đang dùng" : "đã ngừng"}`
        : `- ${name}: đã có, đặt ${next.coefficient} điểm, giữ nguyên trạng thái`,
    );
  console.log("\nNhân viên chuyển sang cách tính lương Điểm ATM:");
  for (const s of staff)
    console.log(
      `- ${s.staffCode} ${s.fullName}, ${s.departmentName}${s.salaryScheme === "atm" ? " (đã là Điểm ATM)" : ""}`,
    );

  if (!apply) {
    console.log("\nChạy khô, chưa ghi gì. Thêm --apply để ghi.");
    return;
  }
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
    for (const [name, next] of Object.entries(NEW_SERVICE_TYPES)) {
      if (toCreate.some(([created]) => created === name))
        await tx
          .insert(serviceTypes)
          .values({ name, coefficient: String(next.coefficient), active: next.active });
      else
        await tx
          .update(serviceTypes)
          .set({ coefficient: String(next.coefficient), dailyCap: null, monthlyCap: null })
          .where(eq(serviceTypes.name, name));
    }
    await tx
      .update(users)
      .set({ salaryScheme: "atm" })
      .where(inArray(users.staffCode, STAFF_CODES));
  });

  console.log("\nĐã ghi. Không tính lại điểm tháng nào.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
