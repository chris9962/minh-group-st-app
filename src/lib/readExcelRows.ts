import type { CellValue } from 'exceljs';
import { removeDiacritics } from './format';

/**
 * Mỗi khoá một cột: các tên đầu cột nhận được, và cột đó có bắt buộc không.
 * `rate`: ô số là tỉ lệ, không làm tròn. `anchor`: dòng trống mọi cột `anchor`
 * thì bỏ qua. `endsAtTotal`: ô cột này ghi "Tổng…" là dòng tổng cuối bảng, app
 * dừng đọc từ dòng đó, bỏ cả bảng tra hay ghi chú nằm dưới.
 */
export type ColumnSpec<K extends string> = Record<
  K,
  { headers: string[]; required: boolean; rate?: boolean; anchor?: boolean; endsAtTotal?: boolean }
>;

export type ExcelRow<K extends string> = { row: number } & Record<K, string>;

/** Dòng đầu bảng nằm trong 10 dòng đầu: file thật hay có tiêu đề, ngày lập ở trên. */
const HEADER_SEARCH_ROWS = 10;

/** "Tổng", "Tổng cộng:", "TỔNG SỐ" sau `headerKey`. Không khớp tên người như "Tống Văn A" (`TONGVANA`). */
const TOTAL_LABEL = /^TONG(CONG|SO)?($|[^A-Z])/;

/** Bỏ dấu, viết hoa, bỏ mọi khoảng trắng: `% HH NHẬN` khớp `%HH NHAN`, `CCCD / BHXH` khớp `CCCD/BHXH`. */
const headerKey = (text: string) => removeDiacritics(text).toUpperCase().replace(/\s+/g, '');

/**
 * Giá trị ô thành chuỗi.
 *
 * Ô số làm tròn về 2 số lẻ, nên chuỗi ra không bao giờ có 3 chữ số sau dấu
 * chấm. Nhờ vậy `parseMoneyCents` hiểu `100.000` là một trăm nghìn mà không
 * đọc nhầm một ô công thức `44579.808`. Ô định dạng % (Excel lưu 0,0912) ra
 * `9.12%`. Ô tỉ lệ (`rate`) giữ đủ số lẻ: 0,0735 không thành 0,07.
 *
 * `toPrecision(15)` bỏ đuôi sai số của số thực trước khi làm tròn: công thức ra
 * 16253,055 được Excel lưu là 16253,054999…, làm tròn thẳng thì mất 1 xu.
 */
function cellText(value: CellValue, numFmt: string | undefined, rate = false): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (numFmt?.includes('%')) return `${Number((value * 100).toPrecision(15))}%`;
    if (rate) return String(Number(value.toPrecision(15)));
    return String(Math.round(Number((value * 100).toPrecision(15))) / 100);
  }
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ('richText' in value) return value.richText.map((t) => t.text).join('').trim();
  if ('formula' in value || 'sharedFormula' in value)
    return 'result' in value && value.result !== undefined
      ? cellText(value.result as CellValue, numFmt, rate)
      : '';
  if ('text' in value) return String(value.text).trim();
  return '';
}

/**
 * Đọc trang tính đầu tiên thành từng dòng chuỗi theo `spec`. Thiếu cột bắt buộc
 * thì ném lỗi nêu tên cột thiếu. Dòng trống hết các cột `anchor` (không khai
 * `anchor` thì mọi cột) được bỏ qua.
 */
export async function readExcelRows<K extends string>(
  file: File,
  spec: ColumnSpec<K>,
): Promise<ExcelRow<K>[]> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('File không có trang tính nào.');

  const keys = Object.keys(spec) as K[];
  const required = keys.filter((k) => spec[k].required);
  let header = { row: 0, columns: new Map<K, number>() };
  let best = new Map<K, number>();

  for (let r = 1; r <= Math.min(HEADER_SEARCH_ROWS, sheet.rowCount); r++) {
    const found = new Map<K, number>();
    sheet.getRow(r).eachCell((cell, col) => {
      const text = headerKey(cellText(cell.value, cell.numFmt));
      const key = keys.find(
        (k) => !found.has(k) && spec[k].headers.some((h) => headerKey(h) === text),
      );
      if (key) found.set(key, col);
    });
    if (required.every((k) => found.has(k))) {
      header = { row: r, columns: found };
      break;
    }
    if (found.size > best.size) best = found;
  }

  if (header.row === 0) {
    const missing = required.filter((k) => !best.has(k)).map((k) => spec[k].headers[0]);
    throw new Error(`File thiếu cột: ${missing.join(', ')}.`);
  }

  const anchors = keys.some((k) => spec[k].anchor) ? keys.filter((k) => spec[k].anchor) : keys;
  const rows: ExcelRow<K>[] = [];
  for (let r = header.row + 1; r <= sheet.rowCount; r++) {
    const excelRow = sheet.getRow(r);
    const values = Object.fromEntries(
      keys.map((k) => {
        const col = header.columns.get(k);
        if (!col) return [k, ''];
        const cell = excelRow.getCell(col);
        return [k, cellText(cell.value, cell.numFmt, spec[k].rate)];
      }),
    ) as Record<K, string>;
    if (keys.some((k) => spec[k].endsAtTotal && TOTAL_LABEL.test(headerKey(values[k])))) break;
    if (anchors.every((k) => values[k] === '')) continue;
    rows.push({ row: r, ...values });
  }
  return rows;
}
