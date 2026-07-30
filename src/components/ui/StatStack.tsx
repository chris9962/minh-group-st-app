import styles from "./StatStack.module.scss";

export type StatStackItem = {
  value: React.ReactNode;
  label: string;
  /** Nhãn nhỏ nằm cạnh số, ví dụ điều kiện đi kèm. */
  badge?: string;
};

/**
 * Vài số liệu xếp dọc trong CÙNG một thẻ, ngăn nhau bằng đường kẻ.
 *
 * Khác `StatCard` ở chỗ gom các số có liên hệ vào một khối: "tài khoản mở" và
 * "khách hàng" là hai mặt của một việc, tách thành hai thẻ rời thì trang chỉ
 * còn là một dãy ô số bằng nhau, không thấy cái nào đi với cái nào.
 */
export function StatStack({ items }: { items: StatStackItem[] }) {
  return (
    <div className={styles.card}>
      {items.map((item) => (
        <div key={item.label} className={styles.item}>
          <div className={styles.row}>
            <strong className={`${styles.value} so`}>{item.value}</strong>
            {item.badge && <span className={styles.badge}>{item.badge}</span>}
          </div>
          <span className={styles.label}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
