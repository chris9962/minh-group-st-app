import { formatVnd } from "@/lib/format";

type Props = { amount: number; visible: boolean };

/** Một cách che số dùng chung; nút mở/đóng nằm ở tiêu đề khối hoặc cột. */
export function SalaryAmount({ amount, visible }: Props) {
  return visible ? (
    <span className="tabular-nums">{formatVnd(amount)}</span>
  ) : (
    <span aria-label="Lương đang ẩn">••••••</span>
  );
}
