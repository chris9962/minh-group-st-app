import { Check, TriangleAlert } from "lucide-react";
import styles from "./StatusTag.module.css";

type Props = {
  ok: boolean;
  children: React.ReactNode;
};

/**
 * Nhãn trạng thái.
 *
 * LUÔN kèm ký hiệu và chữ. Màu nhạt không được là cách duy nhất truyền đạt —
 * đội KD đọc màn hình ngoài nắng, và người mù màu không phân biệt được.
 */
export function StatusTag({ ok, children }: Props) {
  return (
    <span className={`tag ${ok ? styles.ok : styles.warn}`}>
      <span aria-hidden className={styles.mark}>
        {ok ? <Check size={13} strokeWidth={3} /> : <TriangleAlert size={12} />}
      </span>
      {children}
    </span>
  );
}
