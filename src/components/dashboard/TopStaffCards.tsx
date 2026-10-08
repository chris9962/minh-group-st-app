import type { TopStaff } from "@/lib/api/dashboard";
import { formatCount, formatPoints } from "@/lib/format";
import { TopStaffCard } from "./TopStaffCard";
import styles from "./TopStaffCards.module.scss";

const METRICS = [
  ["customers", "Khách có TK", "khách", formatCount],
  ["appsInstalled", "App cài", "app", formatCount],
  ["accountsOpened", "TK mở", "TK", formatCount],
  ["points", "Điểm cá nhân", "điểm", formatPoints],
] as const;

/** Bốn card người đứng đầu ở P-80, dùng chung cho khối trên màn và modal mở rộng. `null` = mọi card hiện "—". */
export function TopStaffCards({ top, columns = 4 }: { top: TopStaff | null; columns?: 2 | 4 }) {
  return (
    <div className={styles.grid} style={{ "--cols": columns } as React.CSSProperties}>
      {METRICS.map(([key, label, unit, format]) => {
        const person = top?.[key] ?? null;
        return (
          <TopStaffCard
            key={key}
            label={label}
            person={person}
            value={person ? `${format(person.value)} ${unit}` : ""}
          />
        );
      })}
    </div>
  );
}
