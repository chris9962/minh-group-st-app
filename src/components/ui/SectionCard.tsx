import styles from "./SectionCard.module.css";

type Props = {
  title: string;
  /** Chú thích bên phải tiêu đề, ví dụ "7 ngày". */
  meta?: string;
  children: React.ReactNode;
  className?: string;
};

/** Khối nội dung có tiêu đề trên dashboard và các màn chi tiết. */
export function SectionCard({ title, meta, children, className }: Props) {
  return (
    <section className={[styles.card, className].filter(Boolean).join(" ")}>
      <header className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        {meta && <span className={styles.meta}>{meta}</span>}
      </header>
      {children}
    </section>
  );
}
