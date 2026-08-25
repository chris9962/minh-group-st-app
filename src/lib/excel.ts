import ExcelJS from 'exceljs';
import { nameForExcel } from './format';

/**
 * Xuất Excel.
 *
 * ⚠️ Cột SĐT và CCCD phải ép **định dạng text**. Để mặc định thì Excel hiểu là
 * số học: `0912345678` mất số 0 đầu, CCCD 12 số thành `9.12E+11`. Lỗi này chỉ
 * lộ ra lúc gửi file cho ngân hàng — muộn nhất có thể.
 *
 * ⚠️ Định dạng đặt ở mức CỘT, không đặt từng ô. Báo cáo Tính điểm tổng có 37.000
 * dòng trên 50 cột; gán style cho từng ô là gần hai triệu lượt, đủ làm treo tab
 * trình duyệt. `ws.getColumn()` giữ style một lần cho cả cột.
 */

/** Font dùng chung cho mọi file xuất — Arial có trên cả Windows lẫn macOS. */
const FONT = 'Arial';

export type ExcelColumn<T> = {
  header: string;
  width?: number;
  /** `text` ép định dạng chuỗi — dùng cho SĐT, CCCD, mã giới thiệu. */
  type?: 'text' | 'number' | 'auto';
  /** `name` chuẩn hoá thành VIẾT HOA KHÔNG DẤU khi xuất. */
  transform?: 'name';
  /**
   * Nhãn nhóm ở dòng đầu. Các cột LIỀN NHAU mang cùng nhãn sẽ gộp thành một ô.
   *
   * Chỉ có nghĩa khi bảng dựng đầu 3 tầng — xem `exportExcel`.
   */
  group?: string;
  /**
   * Màu nền của khối, dạng `FFRRGGBB`. Tô ở CẢ ba dòng đầu bảng để người đọc
   * thấy ranh giới khối khi cuộn ngang qua năm mươi cột.
   *
   * Chọn màu nhạt: file này hay được in đen trắng, nên ranh giới phải đọc được
   * bằng viền và chữ đậm chứ không chỉ bằng màu.
   */
  groupColor?: string;
  /** Số tổng ở dòng thứ hai. Nhận TRỌN danh sách dòng, không nhận từng dòng. */
  total?: (rows: T[]) => string | number;
  /**
   * Căn ngang của cột. Mặc định trái — quy ước bảng của dự án.
   *
   * `center` chỉ dùng cho ô đánh dấu một ký tự: hai khối ngân hàng ghi số `1`
   * trên cột rộng ba ký tự, căn trái thì dấu dính sát mép và mắt không dò được
   * theo hàng.
   */
  align?: 'left' | 'center';
  /** `index` là thứ tự dòng trong file, đếm từ 0 — dùng cho cột STT. */
  value: (row: T, index: number) => string | number;
};

const HEADER_GREY = 'FFE8EAED';
const TOTAL_GREY = 'FFF5F6F7';
const LINE = 'FFB0B4BA';

const thinBorder = {
  top: { style: 'thin' as const, color: { argb: LINE } },
  left: { style: 'thin' as const, color: { argb: LINE } },
  bottom: { style: 'thin' as const, color: { argb: LINE } },
  right: { style: 'thin' as const, color: { argb: LINE } },
};

export async function exportExcel<T>({
  fileName,
  sheetName,
  columns,
  rows,
}: {
  fileName: string;
  sheetName: string;
  columns: ExcelColumn<T>[];
  rows: T[];
}): Promise<void> {
  const wb = new ExcelJS.Workbook();
  // Excel cấm * ? : \\ / [ ] trong tên sheet và giới hạn 31 ký tự.
  // Không lọc thì "Tháng 7/2026" làm hỏng cả file.
  const ws = wb.addWorksheet(
    sheetName.replace(/[*?:\\/[\]]/g, '-').slice(0, 31) || 'Sheet1',
  );

  /**
   * Đầu bảng 3 tầng khi có cột nào khai `group` hoặc `total` — dựng lại hình
   * dạng file `TÍNH ĐIỂM TỔNG` mà Kế toán đang dùng (chốt 2026-08-25):
   *
   *   dòng 1  nhãn nhóm, cột liền nhau cùng nhãn thì gộp ô
   *   dòng 2  số tổng của cột
   *   dòng 3  tên cột
   *
   * Không cột nào khai thì giữ một tầng như cũ — hai báo cáo còn lại không đổi.
   */
  const stacked = columns.some((c) => c.group || c.total);
  const headerRow = stacked ? 3 : 1;

  /**
   * KHÔNG đặt `key` cho cột.
   *
   * ExcelJS lập chỉ mục cột theo `key`, và báo cáo Tính điểm tổng có mười một
   * tên cột lặp lại — `MB`, `VPa`, `LPB`… xuất hiện ở cả khối mở tài khoản lẫn
   * khối app cài. Đặt `key: header` thì cột sau ghi đè định nghĩa của cột trùng
   * tên đứng trước, và độ rộng chạy sang nhầm cột.
   */
  ws.columns = columns.map((c) => ({ width: c.width ?? 18 }));

  /**
   * Định dạng mức CỘT phải đặt TRƯỚC khi dựng đầu bảng.
   *
   * ExcelJS áp style cột lên mọi ô của cột, kể cả ô đã có style riêng — đặt sau
   * thì ba dòng đầu mất chữ đậm và mất căn giữa, chỉ còn nền với viền.
   *
   * `numFmt: '@'` giữ số 0 đầu của SĐT và chặn Excel đổi CCCD 12 số sang ký
   * hiệu mũ.
   */
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.font = { name: FONT, size: 10 };
    col.alignment = { horizontal: c.align === 'center' ? 'center' : 'left' };
    if (c.type === 'text') col.numFmt = '@';
  });

  if (stacked) {
    const groupRow = ws.addRow(columns.map((c) => c.group ?? ''));
    const totalRow = ws.addRow(columns.map((c) => c.total?.(rows) ?? ''));
    groupRow.height = 22;

    columns.forEach((c, i) => {
      const fill = c.groupColor ?? HEADER_GREY;
      const g = groupRow.getCell(i + 1);
      g.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      g.font = { name: FONT, bold: true, size: 11 };
      g.alignment = { horizontal: 'center', vertical: 'middle' };
      g.border = thinBorder;

      const t = totalRow.getCell(i + 1);
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_GREY } };
      t.font = { name: FONT, bold: true, size: 9, color: { argb: 'FF5F6368' } };
      t.alignment = { horizontal: c.align === 'center' ? 'center' : 'left' };
      t.border = thinBorder;
    });

    // Gộp ô cho từng dải cột liền nhau cùng nhãn nhóm. Không gộp thì nhãn lặp
    // lại trên mười một cột ngân hàng và người đọc không thấy ranh giới nhóm.
    let start = 0;
    for (let i = 1; i <= columns.length; i += 1)
      if (i === columns.length || columns[i].group !== columns[start].group) {
        if (columns[start].group && i - start > 1) ws.mergeCells(1, start + 1, 1, i);
        start = i;
      }
  }

  const head = ws.addRow(columns.map((c) => c.header));
  head.height = stacked ? 34 : 18;
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.font = { name: FONT, bold: true, size: 10 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: stacked };
    if (stacked) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: c.groupColor ?? HEADER_GREY },
      };
      cell.border = thinBorder;
    }
  });

  for (const [index, row] of rows.entries()) {
    const cells = columns.map((c) => {
      const raw = c.value(row, index);
      if (c.transform === 'name') return nameForExcel(String(raw));
      // Ép chuỗi TRƯỚC khi ghi: `numFmt` mức cột chỉ đổi cách HIỆN, còn giá trị
      // vẫn là số nên Excel vẫn cắt số 0 đầu lúc mở file.
      return c.type === 'text' ? String(raw ?? '') : raw;
    });
    ws.addRow(cells);
  }

  if (stacked) {
    // Giữ ba dòng đầu và hai cột đầu khi cuộn — không có nó thì cuộn tới cột
    // ĐIỂM là mất tên khách, và cuộn xuống dòng 500 là mất tên cột.
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: headerRow }];
    ws.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow + rows.length, column: columns.length },
    };
  } else {
    ws.getRow(1).font = { name: FONT, bold: true, size: 10 };
  }

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
