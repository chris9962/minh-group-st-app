"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import styles from "./RateDelta.module.css";

/**
 * Mức tăng / giảm so với kỳ liền trước, tính bằng điểm phần trăm.
 *
 * Mũi tên đi kèm luôn, không chỉ dựa vào màu: người mù màu và màn hình điện
 * thoại ngoài nắng đều không phân biệt được xanh với đỏ.
 */
export function RateDelta({ points }: { points: number }) {
  if (points === 0) return <span className={styles.flat}>—</span>;
  const up = points > 0;
  return (
    <span className={up ? styles.up : styles.down}>
      {up ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
      <span className="tabular-nums">{Math.abs(points)}</span>
    </span>
  );
}
