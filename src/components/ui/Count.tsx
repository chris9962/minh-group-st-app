/**
 * Một con số đếm trong ô bảng.
 *
 * Số 0 mờ đi để mắt lướt dọc cột chỉ dừng lại ở dòng có phát sinh. `0` mờ khác
 * hẳn `—`: `—` nghĩa là không đọc được số, còn `0` là đã đếm và bằng không.
 *
 * `tabular-nums` giữ mọi chữ số cùng bề rộng, nên các dòng thẳng cột với nhau.
 */
export function Count({ n }: { n: number }) {
  return <span className={n === 0 ? "text-muted tabular-nums" : "tabular-nums"}>{n}</span>;
}
