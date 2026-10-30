import styles from "./InsuranceBlanks.module.scss";

/** Số phôi phòng còn chưa phát. Âm là phát vượt: kèm ⚠ và chữ, không báo chỉ bằng màu (AGENTS.md §8). */
export function BlankLeft({ value }: { value: number }) {
  if (value >= 0) return <>{value}</>;
  return (
    <span className={styles.dangerText}>
      {value} <span aria-hidden>⚠</span>
      <span className="sr-only">phát vượt số phòng có</span>
    </span>
  );
}
