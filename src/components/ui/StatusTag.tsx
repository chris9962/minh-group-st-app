import { Check, Minus, TriangleAlert } from "lucide-react";
import styles from "./StatusTag.module.css";

type Props = {
  /**
   * `true` đạt · `false` cần để ý · `null` KHÔNG THUỘC BÊN NÀO.
   *
   * Nhánh `null` có mặt vì nhiều trạng thái không phải tin vui cũng chẳng phải
   * cảnh báo: "Chưa đủ điều kiện" nghĩa là khách chưa mở đủ tài khoản, không
   * ai làm sai và cũng không có việc gì phải làm. Nhét nó vào `true` thì màn
   * hiện dấu ✓ nền xanh cho một dòng chưa được gì.
   */
  ok: boolean | null;
  children: React.ReactNode;
};

/**
 * Nhãn trạng thái.
 *
 * LUÔN kèm ký hiệu và chữ. Màu nhạt không được là cách duy nhất truyền đạt —
 * đội KD đọc màn hình ngoài nắng, và người mù màu không phân biệt được.
 */
export function StatusTag({ ok, children }: Props) {
  const tone = ok === null ? styles.neutral : ok ? styles.ok : styles.warn;

  return (
    <span className={`tag ${tone}`}>
      <span aria-hidden className={styles.mark}>
        {ok === null ? (
          <Minus size={13} strokeWidth={3} />
        ) : ok ? (
          <Check size={13} strokeWidth={3} />
        ) : (
          <TriangleAlert size={12} />
        )}
      </span>
      {children}
    </span>
  );
}
