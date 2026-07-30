"use client";

import { useId, useState } from "react";
import { matchesSearch } from "@/lib/format";
import styles from "./Combobox.module.css";

export type ComboboxOption = { value: string; label: string };

type Props = {
  label: string;
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Nhãn xếp phía trên, ô rộng hết cỡ — dùng khi đứng cùng hàng với TextField trong form. */
  block?: boolean;
};

/**
 * Ô chọn có gõ để lọc — dùng thay `Select` khi danh sách quá dài để lướt tay
 * (ví dụ xã/ấp cả nước). Không dùng `<datalist>` gốc vì trình duyệt vẽ khung
 * gợi ý theo giao diện hệ điều hành, không theo được token màu/khoảng cách
 * của design system.
 */
export function Combobox({ label, value, options, onChange, placeholder, block = false }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const selected = options.find((o) => o.value === value);
  const displayValue = open ? query : (selected?.label ?? "");
  const filtered = query.trim() ? options.filter((o) => matchesSearch(o.label, query)) : options;

  const commit = (option: ComboboxOption) => {
    onChange(option.value);
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
  };

  return (
    <span className={block ? styles.blockWrap : styles.wrap}>
      <label htmlFor={id} className={block ? styles.blockLabel : styles.label}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        className={`input ${styles.input} ${block ? styles.blockInput : ""}`}
        value={displayValue}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setActiveIndex(-1);
        }}
        onChange={(e) => {
          setOpen(true);
          setQuery(e.target.value);
          setActiveIndex(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            if (open && filtered[activeIndex]) {
              e.preventDefault();
              commit(filtered[activeIndex]);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
        }}
        onBlur={() => setOpen(false)}
      />

      {open && (
        <ul id={listId} role="listbox" className={styles.list}>
          {filtered.length === 0 ? (
            <li className={styles.empty}>Không tìm thấy</li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                className={[styles.option, i === activeIndex && styles.optionActive]
                  .filter(Boolean)
                  .join(" ")}
                // Chặn blur nổ trước click — không thì danh sách đóng trước khi kịp chọn.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(o)}
              >
                {o.label}
              </li>
            ))
          )}
        </ul>
      )}
    </span>
  );
}
