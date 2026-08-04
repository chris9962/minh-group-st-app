"use client";

import { useId } from "react";
import styles from "./SegmentedTabs.module.css";

export type TabOption = {
  value: string;
  label: string;
  /** Bỏ trống khi con số không có nghĩa — ví dụ tab điều hướng giữa hai khu vực. */
  count?: number;
};

type Props = {
  /** Nhãn nhóm cho trình đọc màn hình. */
  label: string;
  options: TabOption[];
  value: string;
  onChange: (value: string) => void;
};

/**
 * Chuyển giữa vài bảng cùng chỗ.
 *
 * Dựng bằng radio chứ không phải role="tab": radio cho sẵn di chuyển bằng phím
 * mũi tên và trạng thái chọn, không phải tự viết mã bàn phím nào. Số đếm nằm
 * ngay trên nhãn để biết thẻ nào rỗng mà khỏi bấm thử.
 */
export function SegmentedTabs({ label, options, value, onChange }: Props) {
  const id = useId();

  return (
    <div className={styles.tabs} role="group" aria-label={label}>
      {options.map((o) => (
        <label
          key={o.value}
          className={[styles.tab, o.value === value && styles.active]
            .filter(Boolean)
            .join(" ")}
        >
          <input
            type="radio"
            className="sr-only"
            name={`${id}-tab`}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
          {o.count !== undefined && (
            <span className={`${styles.count} so`}>{o.count}</span>
          )}
        </label>
      ))}
    </div>
  );
}
