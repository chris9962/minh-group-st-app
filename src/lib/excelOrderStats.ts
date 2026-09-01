import ExcelJS from 'exceljs';
import { nameForExcel } from './format';

/**
 * Báo cáo #4 · Số liệu cấp đơn — dựng lại đúng hai file Kế toán đang làm tay,
 * `Bao cao so lieu cap don Thang 08` và bản `theo phong`.
 *
 * Đường riêng, KHÔNG dùng `exportExcel`: hàm đó dựng một sheet với đầu bảng một
 * hoặc ba tầng cố định, còn file này cần nhiều sheet, một dòng tiêu đề gộp trọn
 * bề ngang, và một dòng TỔNG ở chân bảng. Nắn `exportExcel` cho vừa cả hai hình
 * dạng là làm khó ba báo cáo đang chạy tốt.
 */

const FONT = 'Arial';
const HEADER_GREY = 'FFE8EAED';
const TOTAL_GREY = 'FFF5F6F7';
const LINE = 'FFB0B4BA';

const thinBorder = {
  top: { style: 'thin' as const, color: { argb: LINE } },
  left: { style: 'thin' as const, color: { argb: LINE } },
  bottom: { style: 'thin' as const, color: { argb: LINE } },
  right: { style: 'thin' as const, color: { argb: LINE } },
};

/** Mười cột số, đúng thứ tự và đúng chữ của file Kế toán. */
const USED_HEADERS = [
  'SỐ ĐƠN BHXM',
  'SỐ NĂM BHXM',
  'SỐ ĐƠN BHĐ - PHÍ 100.000 VNĐ',
  'SỐ ĐƠN BHĐ - PHÍ 200.000 VNĐ',
  'SỐ ĐƠN BHSK',
];
const CANCELLED_HEADERS = [
  'SỐ ĐƠN BHXM HỦY',
  'SỐ NĂM BHXM HỦY',
  'SỐ ĐƠN BHĐ Hủy - PHÍ 100.000 VNĐ',
  'SỐ ĐƠN BHĐ Hủy - PHÍ 200.000 VNĐ',
  'SỐ ĐƠN HUỶ BHSK',
];

/** Mười con số của một dòng, đúng thứ tự cột. */
export type OrderStatsMeasures = [
  number, number, number, number, number,
  number, number, number, number, number,
];

export type OrderStatsSheet = {
  /** Tên sheet: `DD.MM` khi chia theo ngày, `Tháng MM` khi gộp. */
  name: string;
  /** Dòng tiêu đề gộp trọn bề ngang. */
  title: string;
  rows: { label: string; measures: OrderStatsMeasures }[];
};

/**
 * Cột đầu khác nhau giữa hai trục gộp: theo phòng chỉ có `PHÒNG`, theo nhân
 * viên có `STT` cộng `HỌ VÀ TÊN`. Phần còn lại giống hệt.
 */
export type OrderStatsShape = 'department' | 'staff';

const sum = (rows: { measures: OrderStatsMeasures }[], i: number): number =>
  rows.reduce((total, r) => total + r.measures[i], 0);

function buildSheet(
  wb: ExcelJS.Workbook,
  sheet: OrderStatsSheet,
  shape: OrderStatsShape,
): void {
  // Excel cấm * ? : \ / [ ] trong tên sheet và giới hạn 31 ký tự.
  const ws = wb.addWorksheet(sheet.name.replace(/[*?:\\/[\]]/g, '-').slice(0, 31) || 'Sheet1');

  const leadWidth = shape === 'staff' ? 2 : 1;
  const total = leadWidth + 10 + 1;

  ws.columns = [
    ...(shape === 'staff' ? [{ width: 6 }, { width: 42 }] : [{ width: 26 }]),
    ...USED_HEADERS.map(() => ({ width: 16 })),
    ...CANCELLED_HEADERS.map(() => ({ width: 16 })),
    { width: 18 },
  ];

  for (let i = 1; i <= total; i += 1) {
    const col = ws.getColumn(i);
    col.font = { name: FONT, size: 10 };
    col.alignment = { horizontal: 'left' };
  }

  // Dòng 1 — tiêu đề. Ở bản theo nhân viên nó bắt đầu từ cột B, chừa ô A trống
  // cho cột STT, đúng như file Kế toán.
  const titleStart = shape === 'staff' ? 2 : 1;
  ws.addRow([]);
  const titleCell = ws.getCell(1, titleStart);
  titleCell.value = sheet.title;
  titleCell.font = { name: FONT, bold: true, size: 12 };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.mergeCells(1, titleStart, 1, total);
  ws.getRow(1).height = 24;

  // Dòng 2 và 3 — hai tầng đầu bảng.
  ws.addRow([]);
  ws.addRow([]);
  const lead = shape === 'staff' ? ['STT', 'HỌ VÀ TÊN'] : ['PHÒNG'];
  lead.forEach((label, i) => {
    ws.getCell(2, i + 1).value = label;
    ws.mergeCells(2, i + 1, 3, i + 1);
  });
  ws.getCell(2, leadWidth + 1).value = 'BẢO HIỂM SỬ DỤNG';
  ws.mergeCells(2, leadWidth + 1, 2, leadWidth + 5);
  ws.getCell(2, leadWidth + 6).value = 'BẢO HIỂM HUỶ';
  ws.mergeCells(2, leadWidth + 6, 2, leadWidth + 10);
  ws.getCell(2, total).value = 'GHI CHÚ';
  ws.mergeCells(2, total, 3, total);

  [...USED_HEADERS, ...CANCELLED_HEADERS].forEach((header, i) => {
    ws.getCell(3, leadWidth + 1 + i).value = header;
  });

  for (const row of [2, 3]) {
    ws.getRow(row).height = row === 2 ? 20 : 42;
    for (let i = 1; i <= total; i += 1) {
      const cell = ws.getCell(row, i);
      cell.font = { name: FONT, bold: true, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_GREY } };
      cell.border = thinBorder;
    }
  }

  for (const [index, row] of sheet.rows.entries())
    ws.addRow([
      ...(shape === 'staff' ? [index + 1, nameForExcel(row.label)] : [row.label]),
      ...row.measures,
      '',
    ]);

  const totalRow = ws.addRow([
    ...(shape === 'staff' ? ['TỔNG', ''] : ['TỔNG']),
    ...USED_HEADERS.map((_, i) => sum(sheet.rows, i)),
    ...CANCELLED_HEADERS.map((_, i) => sum(sheet.rows, i + 5)),
    '',
  ]);
  for (let i = 1; i <= total; i += 1) {
    const cell = totalRow.getCell(i);
    cell.font = { name: FONT, bold: true, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_GREY } };
    cell.border = thinBorder;
  }
  // Bản theo nhân viên gộp ô TỔNG qua cột tên, đúng như file Kế toán.
  if (shape === 'staff') ws.mergeCells(totalRow.number, 1, totalRow.number, 2);

  // Giữ ba dòng đầu và cột tên khi cuộn — bảng theo nhân viên dài tới vài chục
  // dòng, cuộn xuống là mất tên cột.
  ws.views = [{ state: 'frozen', xSplit: leadWidth, ySplit: 3 }];
}

export async function exportOrderStats({
  fileName,
  shape,
  sheets,
}: {
  fileName: string;
  shape: OrderStatsShape;
  sheets: OrderStatsSheet[];
}): Promise<void> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) buildSheet(wb, sheet, shape);

  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
