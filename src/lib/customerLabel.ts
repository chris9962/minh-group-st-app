/** Một dòng khách đủ để dựng nhãn — tên, số lần, và hồ sơ gốc. */
type Labelled = { fullName: string; seq: number; rootId: string };

/**
 * Nhãn tên khách, kèm số hồ sơ KHI CẦN phân biệt.
 *
 * Hai điều kiện, hợp bằng HOẶC:
 *   `seq > 1`                       → hồ sơ sau luôn nói rõ nó là hồ sơ mấy
 *   nhiều dòng CÙNG MỘT NGƯỜI       → cả nhóm hiện số, kể cả hồ sơ 1
 *
 * Vế thứ hai là lý do hàm nhận cả danh sách chứ không nhận từng dòng: hai hồ sơ
 * của một người mà chỉ dòng sau ghi "hồ sơ 2" thì dòng trước đọc ra như một
 * người khác trùng tên.
 *
 * ⚠️ Nhóm theo `rootId`, KHÔNG theo tên. Hai người khác nhau trùng tên thật thì
 * cả hai đều `seq = 1`, ghi "hồ sơ 1" lên cả hai là thêm chữ mà không phân biệt
 * được gì. Trùng tên là chuyện thường: `e2e-seed` dựng sẵn 22 khách cùng tên.
 *
 * Danh sách nào cũng chỉ là MỘT TRANG, nên vế thứ hai chỉ thấy phần đang hiện.
 * Chấp nhận: người dùng so hai dòng trước mắt, không so với dòng ở trang khác.
 */
export function seqLabeller<T extends Labelled>(rows: readonly T[]): (row: T) => string {
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.rootId, (count.get(r.rootId) ?? 0) + 1);

  return (row) =>
    row.seq > 1 || (count.get(row.rootId) ?? 0) > 1
      ? `${row.fullName} - hồ sơ ${row.seq}`
      : row.fullName;
}
