import styles from "./StatCard.module.css";

type Props = {
  value: React.ReactNode;
  label: string;
  /** Dòng phụ: so sánh kỳ trước, tách nhỏ theo loại… */
  detail?: React.ReactNode;
  /** `attention` cho số cần để mắt tới — vẫn kèm nhãn chữ, màu không đứng một mình. */
  tone?: "normal" | "attention";
};

/** Ô số liệu trên dashboard. */
export function StatCard({ value, label, detail, tone = "normal" }: Props) {
  return (
    <div className={styles.card}>
      <strong className={[styles.value, tone === "attention" && styles.attention, "so"].filter(Boolean).join(" ")}>
        {value}
      </strong>
      <span className={styles.label}>{label}</span>
      {detail && <span className={styles.detail}>{detail}</span>}
    </div>
  );
}
