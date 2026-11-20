import { exportExcel, EXCEL_GROUP_COLORS, type ExcelColumn } from "@/lib/excel";
import { fetchMealExport, type MealExportRow } from "@/lib/api/mealAllowances";

const NHAN_SU = { group: "NHÂN SỰ", groupColor: EXCEL_GROUP_COLORS.staff };
const AN_CA = { group: "ĂN CA", groupColor: EXCEL_GROUP_COLORS.account };
const TAI_KHOAN = { group: "TÀI KHOẢN NHẬN", groupColor: EXCEL_GROUP_COLORS.staff };

const COLUMNS: ExcelColumn<MealExportRow>[] = [
  { header: "STT", ...NHAN_SU, type: "number", width: 6, total: (rows) => rows.length, value: (_r, i) => i + 1 },
  { header: "HỌ TÊN", ...NHAN_SU, transform: "name", width: 26, value: (r) => r.fullName },
  { header: "MÃ NHÂN VIÊN", ...NHAN_SU, type: "text", width: 15, value: (r) => r.staffCode },
  { header: "CHỨC DANH", ...NHAN_SU, width: 22, value: (r) => r.title },
  { header: "PHÒNG", ...NHAN_SU, width: 22, value: (r) => r.departmentName },
  {
    header: "SỐ NGÀY ĂN CA",
    ...AN_CA,
    type: "number",
    width: 12,
    total: (rows) => rows.reduce((t, r) => t + r.days, 0),
    value: (r) => r.days,
  },
  { header: "ĐƠN GIÁ", ...AN_CA, type: "number", width: 12, value: (r) => r.rate },
  {
    header: "SỐ TIỀN",
    ...AN_CA,
    type: "number",
    width: 14,
    total: (rows) => rows.reduce((t, r) => t + r.amount, 0),
    value: (r) => r.amount,
  },
  { header: "SỐ TÀI KHOẢN", ...TAI_KHOAN, type: "text", width: 18, value: (r) => r.bankAccountNumber },
  { header: "NGÂN HÀNG NHẬN", ...TAI_KHOAN, width: 16, value: (r) => r.bankName },
  { header: "MÃ NGÂN HÀNG", ...TAI_KHOAN, type: "text", width: 14, value: (r) => r.bankCode },
];

/** File của kế toán: dòng Đang xử lý có tiền, theo bộ lọc đang xem. Trả các dòng đã xuất. */
export async function exportMeals(query: Parameters<typeof fetchMealExport>[0]): Promise<MealExportRow[]> {
  const { month } = query;
  const rows = await fetchMealExport(query);
  const [year, mm] = month.split("-");
  if (rows.length === 0) throw new Error(`Tháng ${mm}/${year} không có dòng Đang xử lý nào khớp bộ lọc.`);
  await exportExcel({
    fileName: `luong-an-ca-${month}.xlsx`,
    sheetName: `Ăn ca ${mm}-${year}`,
    columns: COLUMNS,
    rows,
  });
  return rows;
}
