import ExcelJS from 'exceljs';
import { nameForExcel } from './format';

/**
 * Xuất Excel.
 *
 * ⚠️ Cột SĐT và CCCD phải ép **định dạng text**. Để mặc định thì Excel hiểu là
 * số học: `0912345678` mất số 0 đầu, CCCD 12 số thành `9.12E+11`. Lỗi này chỉ
 * lộ ra lúc gửi file cho ngân hàng — muộn nhất có thể.
 */

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
  /** Số tổng ở dòng thứ hai. Nhận TRỌN danh sách dòng, không nhận từng dòng. */
  total?: (rows: T[]) => string | number;
  /** `index` là thứ tự dòng trong file, đếm từ 0 — dùng cho cột STT. */
  value: (row: T, index: number) => string | number;
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
   * Không cột nào khai thì giữ một tầng như cũ — bảy báo cáo còn lại không đổi.
   */
  const stacked = columns.some((c) => c.group || c.total);
  const headerRow = stacked ? 3 : 1;

  ws.columns = columns.map((c) => ({ key: c.header, width: c.width ?? 18 }));

  if (stacked) {
    ws.addRow(columns.map((c) => c.group ?? ''));
    ws.addRow(columns.map((c) => c.total?.(rows) ?? ''));
    // Gộp ô cho từng dải cột liền nhau cùng nhãn nhóm. Không gộp thì nhãn lặp
    // lại trên mười một cột ngân hàng và người đọc không thấy ranh giới nhóm.
    let start = 0;
    for (let i = 1; i <= columns.length; i += 1)
      if (i === columns.length || columns[i].group !== columns[start].group) {
        if (columns[start].group && i - start > 1) ws.mergeCells(1, start + 1, 1, i);
        start = i;
      }
  }

  ws.addRow(columns.map((c) => c.header));
  ws.getRow(headerRow).font = { bold: true };
  if (stacked) ws.getRow(1).font = { bold: true };

  for (const [index, row] of rows.entries()) {
    const cells = columns.map((c) => {
      const raw = c.value(row, index);
      return c.transform === 'name' ? nameForExcel(String(raw)) : raw;
    });
    const added = ws.addRow(cells);

    columns.forEach((c, i) => {
      if (c.type === 'text') {
        const cell = added.getCell(i + 1);
        cell.numFmt = '@';
        cell.value = String(cell.value ?? '');
      }
    });
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
