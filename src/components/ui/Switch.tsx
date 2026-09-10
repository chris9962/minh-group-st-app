"use client";

import { useId } from "react";
import styles from "./Switch.module.css";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  /** Câu giải thích dưới nhãn — nói rõ bật lên thì điều gì đổi. */
  hint?: string;
  disabled?: boolean;
  /**
   * Giấu nhãn khỏi mắt nhưng giữ cho trình đọc màn hình.
   *
   * Dùng khi công tắc nằm trong `SettingsRow`: dòng đó đã in nhãn bên trái rồi,
   * in thêm lần nữa là đọc lên hai lần. KHÔNG bỏ `label` đi — bỏ là công tắc
   * mất tên, người dùng trình đọc màn hình nghe "bật tắt" mà không biết của gì.
   */
  hideLabel?: boolean;
};

/**
 * Công tắc bật/tắt một trạng thái.
 *
 * Dùng `<input type="checkbox" role="switch">` chứ không dựng bằng `div`: bàn
 * phím, tiêu điểm và trạng thái đọc được đều có sẵn của trình duyệt. `role`
 * chỉ đổi cách trình đọc màn hình xướng lên — "bật/tắt" thay vì "đã tích".
 *
 * Khác `Checkbox`: ô tích là một mục trong danh sách chọn nhiều, còn công tắc
 * đổi ngay một trạng thái của màn hình đang mở.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled,
  hideLabel,
}: Props) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={hideLabel ? `${styles.wrap} ${styles.bare}` : styles.wrap}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      <label htmlFor={id} className={styles.label}>
        <span className={styles.track} aria-hidden>
          <span className={styles.thumb} />
        </span>
        <span className={hideLabel ? "sr-only" : styles.text}>{label}</span>
      </label>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}
