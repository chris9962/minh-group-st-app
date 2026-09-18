"use client";

import { sparklineHeights } from "./ranking";
import styles from "./Sparkline.module.css";

type Props = {
  values: number[];
  /** Câu đọc lên cho cả dãy — từng cột là trang trí. */
  label: string;
};

/** Biểu đồ cột mini trong bảng xếp hạng, cùng dáng cột Growth trên ảnh mẫu. */
export function Sparkline({ values, label }: Props) {
  const heights = sparklineHeights(values);
  return (
    <span className={styles.chart} role="img" aria-label={label}>
      {heights.map((height, index) => (
        <span
          key={index}
          className={styles.bar}
          aria-hidden
          style={{ height: `${Math.max(height, 12)}%` }}
        />
      ))}
    </span>
  );
}
