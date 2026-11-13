import { exportExcelSheets, EXCEL_GROUP_COLORS, type ExcelColumn } from "@/lib/excel";
import type { SalaryExportRow } from "@/lib/api/exports";

/** Một cột của báo cáo Lương, cùng hình dạng với cột ở màn Xuất dữ liệu. */
export type SalaryExportColumn = Omit<ExcelColumn<SalaryExportRow>, "type"> & {
  type?: "text" | "number";
  key: string;
  defaultOn: boolean;
  sample: [string, string];
};

/**
 * Mọi cột có thể xuất của báo cáo Lương. Màn Xuất dữ liệu và trang Lương dùng
 * chung khai báo này, nên hai nơi ra cùng một file.
 */
export function salaryExportColumns(): SalaryExportColumn[] {
  const NHAN_SU = { group: "NHÂN SỰ", groupColor: EXCEL_GROUP_COLORS.staff };
  const APP = { group: "APP", groupColor: EXCEL_GROUP_COLORS.account };
  const DIEM = { group: "ĐIỂM", groupColor: EXCEL_GROUP_COLORS.points };
  const LUONG = { group: "LƯƠNG" };
  const TAI_KHOAN = { group: "TÀI KHOẢN NHẬN", groupColor: EXCEL_GROUP_COLORS.staff };
  const sum = (pick: (r: SalaryExportRow) => number) => (rows: SalaryExportRow[]) =>
    Number(rows.reduce((t, r) => t + pick(r), 0).toFixed(2));
  const finalPoints = (r: SalaryExportRow) => Number((r.points + r.minusPoints + r.plusPoints).toFixed(2));
  return [
    { key: "stt", header: "STT", ...NHAN_SU, type: "number", width: 6, defaultOn: true, sample: ["1", "2"], total: (rows) => rows.length, value: (_row, index) => index + 1 },
    { key: "fullName", header: "HỌ TÊN", ...NHAN_SU, transform: "name", width: 26, defaultOn: true, sample: ["VO THI KIEU TRANG", "LUU PHUONG DUY"], value: (r: SalaryExportRow) => r.fullName },
    { key: "staffCode", header: "MÃ NHÂN VIÊN", ...NHAN_SU, type: "text", width: 15, defaultOn: true, sample: ["343TRANGVTK", "013DUYLP"], value: (r: SalaryExportRow) => r.staffCode },
    { key: "department", header: "PHÒNG", ...NHAN_SU, width: 24, defaultOn: true, sample: ["Phòng Y", "Phòng Y"], value: (r: SalaryExportRow) => r.departmentName },
    { key: "role", header: "CHỨC VỤ", ...NHAN_SU, width: 24, defaultOn: true, sample: ["Dịch vụ", "Phó phòng kinh doanh"], value: (r: SalaryExportRow) => r.title },
    { key: "active", header: "TRẠNG THÁI", ...NHAN_SU, width: 12, defaultOn: true, sample: ["Đang làm", "Đã nghỉ"], value: (r: SalaryExportRow) => (r.active ? "Đang làm" : "Đã nghỉ") },
    { key: "appsAll", header: "TỔNG APP (GỒM LỖI)", ...APP, type: "number", width: 12, defaultOn: true, sample: ["315", "120"], total: sum((r) => r.appsAll), value: (r: SalaryExportRow) => r.appsAll },
    { key: "appsBroken", header: "APP LỖI", ...APP, type: "number", width: 10, defaultOn: true, sample: ["1", "0"], total: sum((r) => r.appsBroken), value: (r: SalaryExportRow) => r.appsBroken },
    { key: "appsDone", header: "APP SAU TRỪ LỖI", ...APP, type: "number", width: 12, defaultOn: true, sample: ["314", "120"], total: sum((r) => r.appsAll - r.appsBroken), value: (r: SalaryExportRow) => r.appsAll - r.appsBroken },
    { key: "points", header: "ĐIỂM", ...DIEM, type: "number", width: 11, defaultOn: true, sample: ["103,6", "45"], total: sum((r) => r.points), value: (r: SalaryExportRow) => r.points },
    { key: "minusPoints", header: "ĐIỂM TRỪ", ...DIEM, type: "number", width: 11, defaultOn: true, sample: ["-5,4", "0"], total: sum((r) => r.minusPoints), value: (r: SalaryExportRow) => r.minusPoints },
    { key: "minusReason", header: "LÝ DO TRỪ ĐIỂM", ...DIEM, width: 62, defaultOn: true, sample: ["điểm trừ lỗi VPBa tháng 08", ""], value: (r: SalaryExportRow) => r.minusReason },
    { key: "plusPoints", header: "ĐIỂM CỘNG", ...DIEM, type: "number", width: 11, defaultOn: true, sample: ["0", "3"], total: sum((r) => r.plusPoints), value: (r: SalaryExportRow) => r.plusPoints },
    { key: "plusReason", header: "LÝ DO CỘNG ĐIỂM", ...DIEM, width: 30, defaultOn: true, sample: ["", "cộng điểm HKD ngoại lệ VPBb"], value: (r: SalaryExportRow) => r.plusReason },
    { key: "finalPoints", header: "ĐIỂM SAU CÙNG", ...DIEM, type: "number", width: 12, defaultOn: true, sample: ["98,2", "48"], total: sum(finalPoints), value: finalPoints },
    { key: "pointsSalary", header: "LƯƠNG THEO ĐIỂM", ...LUONG, type: "number", width: 15, defaultOn: true, sample: ["9012000", "6960000"], total: sum((r) => r.pointsSalary), value: (r: SalaryExportRow) => r.pointsSalary },
    { key: "bonus", header: "LƯƠNG THƯỞNG", ...LUONG, type: "number", width: 13, defaultOn: true, sample: ["500000", "0"], total: sum((r) => r.bonus), value: (r: SalaryExportRow) => r.bonus },
    { key: "bonusReason", header: "LÝ DO THƯỞNG", ...LUONG, width: 30, defaultOn: true, sample: ["thưởng nóng tháng 10", ""], value: (r: SalaryExportRow) => r.bonusReason },
    { key: "deduction", header: "LƯƠNG TRỪ", ...LUONG, type: "number", width: 13, defaultOn: true, sample: ["0", "200000"], total: sum((r) => r.deduction), value: (r: SalaryExportRow) => r.deduction },
    { key: "deductionReason", header: "LÝ DO TRỪ LƯƠNG", ...LUONG, width: 30, defaultOn: true, sample: ["", "đi trễ"], value: (r: SalaryExportRow) => r.deductionReason },
    { key: "advance", header: "LƯƠNG ỨNG TRƯỚC", ...LUONG, type: "number", width: 15, defaultOn: true, sample: ["2000000", "0"], total: sum((r) => r.advance), value: (r: SalaryExportRow) => r.advance },
    { key: "salary", header: "LƯƠNG CUỐI CÙNG", ...LUONG, type: "number", width: 15, defaultOn: true, sample: ["7512000", "6760000"], total: sum((r) => r.salary), value: (r: SalaryExportRow) => r.salary },
    { key: "bankAccountNumber", header: "SỐ TÀI KHOẢN", ...TAI_KHOAN, type: "text", width: 18, defaultOn: true, sample: ["10001234567", "0123456789"], value: (r: SalaryExportRow) => r.bankAccountNumber },
    { key: "bankName", header: "NGÂN HÀNG NHẬN", ...TAI_KHOAN, width: 16, defaultOn: true, sample: ["TPBank", "VPBank"], value: (r: SalaryExportRow) => r.bankName },
    { key: "bankCode", header: "MÃ NGÂN HÀNG", ...TAI_KHOAN, type: "text", width: 14, defaultOn: true, sample: ["01358001", ""], value: (r: SalaryExportRow) => r.bankCode },
  ];
}

/**
 * Dựng file Lương: sheet chính, và sheet riêng cho người bị đánh dấu không tính
 * điểm phòng của tháng (chốt 2026-10-19). Trả số dòng đã xuất.
 */
export async function exportSalaryWorkbook(
  month: string,
  rows: SalaryExportRow[],
  columns: ExcelColumn<SalaryExportRow>[],
): Promise<number> {
  const [year, mm] = month.split("-");
  if (rows.length === 0) throw new Error(`Tháng ${mm}/${year} chưa có nhân sự phòng kinh doanh.`);
  const excluded = rows.filter((r) => r.excludedNote !== null);
  await exportExcelSheets({
    fileName: `luong-${month}.xlsx`,
    sheets: [
      { sheetName: `Lương ${mm}-${year}`, columns, rows: rows.filter((r) => r.excludedNote === null) },
      ...(excluded.length > 0
        ? [
            {
              sheetName: "Không tính điểm phòng",
              columns: [
                ...columns,
                {
                  header: "LÝ DO",
                  group: "KHÔNG TÍNH ĐIỂM PHÒNG",
                  groupColor: EXCEL_GROUP_COLORS.staff,
                  width: 24,
                  value: (r: SalaryExportRow) => r.excludedNote ?? "",
                },
              ],
              rows: excluded,
            },
          ]
        : []),
    ],
  });
  return rows.length;
}
