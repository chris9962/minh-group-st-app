import styles from "./TopBar.module.scss";

type Props = {
  title: string;
  /** Thanh chọn phạm vi, bộ lọc… tuỳ từng trang. */
  children?: React.ReactNode;
};

export function TopBar({ title, children }: Props) {
  return (
    <header className={styles.bar}>
      <h1 className={styles.title}>{title}</h1>
      <div className={styles.tools}>{children}</div>
    </header>
  );
}
