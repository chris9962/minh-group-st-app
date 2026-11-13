import { exportExcel, EXCEL_GROUP_COLORS, type ExcelColumn } from "@/lib/excel";
import { ADVANCE_STATUS_LABEL, fetchAdvanceExport, type AdvanceExportRow } from "@/lib/api/salaryAdvances";
import { formatDateTime } from "@/lib/format";

const NHAN_SU = { group: "NHÂN SỰ", groupColor: EXCEL_GROUP_COLORS.staff };
const TAM_UNG = { group: "TẠM ỨNG", groupColor: EXCEL_GROUP_COLORS.account };
const TAI_KHOAN = { group: "TÀI KHOẢN NHẬN", groupColor: EXCEL_GROUP_COLORS.staff };

const COLUMNS: ExcelColumn<AdvanceExportRow>[] = [
  { header: "STT", ...NHAN_SU, type: "number", width: 6, total: (rows) => rows.length, value: (_r, i) => i + 1 },
  { header: "MÃ NHÂN VIÊN", ...NHAN_SU, type: "text", width: 15, value: (r) => r.staffCode },
  { header: "HỌ TÊN", ...NHAN_SU, transform: "name", width: 26, value: (r) => r.fullName },
  { header: "PHÒNG", ...NHAN_SU, width: 22, value: (r) => r.departmentName },
  { header: "CHỨC VỤ", ...NHAN_SU, width: 22, value: (r) => r.title },
  {
    header: "SỐ TIỀN TẠM ỨNG",
    ...TAM_UNG,
    type: "number",
    width: 16,
    total: (rows) => rows.reduce((t, r) => t + r.amount, 0),
    value: (r) => r.amount,
  },
  { header: "TRẠNG THÁI", ...TAM_UNG, width: 18, value: (r) => ADVANCE_STATUS_LABEL[r.status] },
  { header: "NGÀY GỬI", ...TAM_UNG, width: 18, value: (r) => formatDateTime(r.createdAt) },
  { header: "SỐ TÀI KHOẢN", ...TAI_KHOAN, type: "text", width: 18, value: (r) => r.bankAccountNumber },
  { header: "NGÂN HÀNG NHẬN", ...TAI_KHOAN, width: 16, value: (r) => r.bankName },
  { header: "MÃ NGÂN HÀNG", ...TAI_KHOAN, type: "text", width: 14, value: (r) => r.bankCode },
];

/** File của kế toán: yêu cầu Đã duyệt chưa vào file nào, theo bộ lọc đang xem. Trả các dòng đã xuất. */
export async function exportAdvances(query: Parameters<typeof fetchAdvanceExport>[0]): Promise<AdvanceExportRow[]> {
  const { month } = query;
  const rows = await fetchAdvanceExport(query);
  const [year, mm] = month.split("-");
  if (rows.length === 0) throw new Error(`Tháng ${mm}/${year} không có yêu cầu Đã duyệt nào khớp bộ lọc.`);
  await exportExcel({
    fileName: `tam-ung-luong-${month}.xlsx`,
    sheetName: `Tạm ứng ${mm}-${year}`,
    columns: COLUMNS,
    rows,
  });
  return rows;
}
