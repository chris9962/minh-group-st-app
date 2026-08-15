"use client";

import { clsx } from "clsx";
import { useId } from "react";
import styles from "./SectionTabs.module.scss";

export type SectionOption = {
  value: string;
  label: string;
};

type Props = {
  /** Nhãn nhóm cho trình đọc màn hình. */
  label: string;
  options: SectionOption[];
  value: string;
  onChange: (value: string) => void;
};

/**
 * Chuyển giữa các KHU VỰC của một trang.
 *
 * Khác `SegmentedTabs` ở chỗ dùng: cái kia là viên thuốc có số đếm, hợp khi
 * đổi qua lại giữa mấy bảng nằm trong cùng một thẻ. Ở cấp trang thì hai viên
 * thuốc to đọc ra như hai cái nút bấm, tranh chú ý với nội dung bên dưới —
 * gạch chân là quy ước quen thuộc cho "đây là điều hướng, không phải hành động".
 *
 * Vẫn dựng bằng radio: phím mũi tên và trạng thái chọn có sẵn, không phải tự
 * viết mã bàn phím nào.
 */
export function SectionTabs({ label, options, value, onChange }: Props) {
  const id = useId();

  return (
    <div className={styles.bar} role="group" aria-label={label}>
      {options.map((o) => (
        <label
          key={o.value}
          className={clsx(styles.tab, o.value === value && styles.active)}
        >
          <input
            type="radio"
            className="sr-only"
            name={`${id}-section`}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
