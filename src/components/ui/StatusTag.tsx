import { Check, Clock, Hourglass, Minus, RefreshCw, TriangleAlert } from "lucide-react";
import styles from "./StatusTag.module.css";

export type StatusTone = "ok" | "warn" | "neutral" | "waiting" | "progress" | "review";

type Props = {
  /**
   * `true` đạt · `false` cần để ý · `null` KHÔNG THUỘC BÊN NÀO.
   *
   * Nhánh `null` có mặt vì nhiều trạng thái không phải tin vui cũng chẳng phải
   * cảnh báo: "Chưa đủ điều kiện" nghĩa là khách chưa mở đủ tài khoản, không
   * ai làm sai và cũng không có việc gì phải làm. Nhét nó vào `true` thì màn
   * hiện dấu ✓ nền xanh cho một dòng chưa được gì.
   */
  ok?: boolean | null;
  /**
   * Nói thẳng tông khi ba nhánh của `ok` không đủ nghĩa. Vòng đời đơn bảo hiểm
   * cần `progress` — "Đang tạo" không phải cảnh báo, nhưng cũng không phải một
   * ô trống như `neutral`. Truyền `tone` thì `ok` bị bỏ qua.
   */
  tone?: StatusTone;
  children: React.ReactNode;
};

const TONE_CLASS: Record<StatusTone, string> = {
  ok: styles.ok,
  warn: styles.warn,
  neutral: styles.neutral,
  // Cùng màu xám với `neutral`, khác đúng KÝ HIỆU nên dùng chung class — chép
  // lại bộ màu là hai chỗ sớm muộn lệch nhau.
  waiting: styles.neutral,
  progress: styles.progress,
  review: styles.review,
};

/**
 * `neutral` giữ dấu gạch ngang vì nó nghĩa là "không thuộc bên nào" — dùng ở
 * khối Quà cho "Chưa đủ điều kiện". Trạng thái ĐANG CHỜ thì khác hẳn: có việc,
 * chỉ là chưa tới lượt, nên nó cần mặt đồng hồ chứ không phải một gạch ngang
 * đọc ra như ô trống.
 */
const TONE_MARK: Record<StatusTone, React.ReactNode> = {
  ok: <Check size={13} strokeWidth={3} />,
  warn: <TriangleAlert size={12} />,
  neutral: <Minus size={13} strokeWidth={3} />,
  waiting: <Clock size={12} />,
  progress: <RefreshCw size={12} strokeWidth={2.5} />,
  review: <Hourglass size={12} />,
};

/**
 * Nhãn trạng thái.
 *
 * LUÔN kèm ký hiệu và chữ. Màu nhạt không được là cách duy nhất truyền đạt —
 * đội KD đọc màn hình ngoài nắng, và người mù màu không phân biệt được.
 */
export function StatusTag({ ok = null, tone, children }: Props) {
  const resolved: StatusTone = tone ?? (ok === null ? "neutral" : ok ? "ok" : "warn");

  return (
    <span className={`tag ${TONE_CLASS[resolved]}`}>
      <span aria-hidden className={styles.mark}>
        {TONE_MARK[resolved]}
      </span>
      {children}
    </span>
  );
}
