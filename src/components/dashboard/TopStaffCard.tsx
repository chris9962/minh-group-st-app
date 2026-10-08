import { clsx } from "clsx";
import Link from "next/link";
import styles from "./TopStaffCard.module.scss";

type Props = {
  /** Tên chỉ số, ví dụ "Khách có TK". */
  label: string;
  /** `null` khi kỳ đang xem chưa ai có số này. */
  person: { id: string; name: string; departmentName: string } | null;
  /** Con số đã định dạng kèm đơn vị, ví dụ "65 khách". */
  value: string;
};

/** Card người đứng đầu một chỉ số ở P-80: tên chỉ số, tên người, phòng, con số. */
export function TopStaffCard({ label, person, value }: Props) {
  return (
    <div className={styles.card}>
      <span className={styles.label}>{label}</span>
      {person ? (
        <>
          <Link href={`/users/${person.id}`} className={styles.name}>
            {person.name}
          </Link>
          {person.departmentName && <span className={styles.department}>{person.departmentName}</span>}
          <strong className={clsx(styles.value, "tabular-nums")}>{value}</strong>
        </>
      ) : (
        <strong className={styles.value}>—</strong>
      )}
    </div>
  );
}
