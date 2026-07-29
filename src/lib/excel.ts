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
  value: (row: T) => string | number;
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

  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.header,
    width: c.width ?? 18,
  }));
  ws.getRow(1).font = { bold: true };

  for (const row of rows) {
    const cells = columns.map((c) => {
      const raw = c.value(row);
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
