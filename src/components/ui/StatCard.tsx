import styles from "./StatCard.module.css";

type Props = {
  value: React.ReactNode;
  label: string;
  /** Dòng phụ: so sánh kỳ trước, tách nhỏ theo loại… */
  detail?: React.ReactNode;
  /** Thẻ chỉ số chính — to hơn, nổi hơn. */
  featured?: boolean;
};

/** Ô số liệu trên dashboard. */
export function StatCard({ value, label, detail, featured = false }: Props) {
  return (
    <div className={[styles.card, featured && styles.featured].filter(Boolean).join(" ")}>
      <strong className={`${styles.value} so`}>{value}</strong>
      <span className={styles.label}>{label}</span>
      {detail && <span className={styles.detail}>{detail}</span>}
    </div>
  );
}
