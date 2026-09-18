"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { matchesSearch } from "@/lib/format";
import type { SelectOption } from "./Select";
import { SearchField } from "./SearchField";
import styles from "./FilterChoices.module.css";

type Props = {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Gợi ý trong ô tìm. Bỏ trống thì dựng từ `label`. */
  searchPlaceholder?: string;
};

/**
 * Danh sách giá trị của một mục lọc — ô tìm + từng dòng chọn được.
 *
 * Dùng trong cột phải của `FilterButton` thay cho `<select>`/`Combobox`: thấy
 * hết lựa chọn một lúc, gõ để thu hẹp, không mở popover lồng nhau.
 */
export function FilterChoices({ label, value, options, onChange, searchPlaceholder }: Props) {
  const [query, setQuery] = useState("");
  const searchable = options.length >= 6;
  const shown = useMemo(
    () => (query.trim() ? options.filter((option) => matchesSearch(option.label, query)) : options),
    [options, query],
  );

  return (
    <div className={styles.wrap}>
      {searchable && (
        <div className={styles.search}>
          <SearchField
            block
            label={`Tìm ${label}`}
            placeholder={searchPlaceholder ?? `Tìm ${label.toLowerCase()}…`}
            value={query}
            onChange={setQuery}
          />
        </div>
      )}

      <div className={styles.list} role="listbox" aria-label={label}>
        {shown.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value === "" ? "__all" : option.value}
              type="button"
              role="option"
              aria-selected={on}
              className={on ? `${styles.row} ${styles.rowOn}` : styles.row}
              onClick={() => onChange(option.value)}
            >
              <span className={on ? `${styles.box} ${styles.boxOn}` : styles.box} aria-hidden>
                {on && <Check size={12} strokeWidth={2.5} />}
              </span>
              <span className={styles.rowLabel}>{option.label}</span>
            </button>
          );
        })}
        {shown.length === 0 && <p className={styles.empty}>Không có kết quả</p>}
      </div>
    </div>
  );
}
