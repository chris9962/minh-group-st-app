"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { useContext, useId, useMemo, useState } from "react";
import { matchesSearch } from "@/lib/format";
import { DialogPortalContext } from "./Dialog";
import { SearchField } from "./SearchField";
import type { SelectOption } from "./Select";
import styles from "./MultiSelect.module.css";

type Props = {
  label: string;
  /** Ẩn nhãn khỏi màn hình nhưng trình đọc màn hình vẫn đọc được. */
  hideLabel?: boolean;
  value: string[];
  options: SelectOption[];
  onChange: (value: string[]) => void;
  /** Chữ trong ô khi chưa chọn gì. */
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  /** Nhãn xếp phía trên, ô rộng hết cỡ — dùng khi đứng trong form dọc. */
  block?: boolean;
};

/** Gõ để lọc chỉ có nghĩa khi danh sách dài hơn một tầm mắt. */
const SEARCHABLE_FROM = 8;

/**
 * Ô chọn NHIỀU giá trị — nút mở danh sách, mỗi dòng một ô tích.
 *
 * `<select multiple>` gốc của trình duyệt không dùng được: trên máy tính nó đòi
 * giữ Ctrl để chọn dòng thứ hai, bấm thường là mất hết lựa chọn cũ, và trên
 * điện thoại nó vẽ một khung cuộn cao nghều không theo token nào.
 *
 * Danh sách nổi lên qua Popover có portal, cùng lý do với `Combobox`: hộp thoại
 * cuộn bằng `overflow-y: auto` nên khối absolute nằm trong đó bị cắt.
 */
export function MultiSelect({
  label,
  hideLabel = false,
  value,
  options,
  onChange,
  placeholder = "Chưa chọn",
  disabled,
  error,
  block = false,
}: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const dialogEl = useContext(DialogPortalContext);

  const searchable = options.length >= SEARCHABLE_FROM;
  const shown = useMemo(
    () => (query.trim() ? options.filter((o) => matchesSearch(o.label, query)) : options),
    [options, query],
  );

  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);

  const toggle = (optionValue: string) =>
    onChange(
      value.includes(optionValue)
        ? value.filter((v) => v !== optionValue)
        : [...value, optionValue],
    );

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <span className={block ? styles.blockWrap : styles.wrap}>
        <span id={id} className={hideLabel ? "sr-only" : block ? styles.blockLabel : styles.label}>
          {label}
        </span>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-labelledby={id}
            aria-expanded={open}
            aria-describedby={error ? errorId : undefined}
            className={styles.trigger}
          >
            {/* Từng phòng một thẻ, xuống dòng khi hết chỗ. Ghép thành một chuỗi
                rồi cắt bằng `text-overflow` thì chọn tới phòng thứ ba là không
                đọc được phòng nào nữa. */}
            {selectedLabels.length > 0 ? (
              <span className={styles.chips}>
                {selectedLabels.map((text) => (
                  <span key={text} className={styles.chip}>
                    {text}
                  </span>
                ))}
              </span>
            ) : (
              <span className={styles.placeholder}>{placeholder}</span>
            )}
            <ChevronDown size={15} className={styles.chevron} aria-hidden />
          </button>
        </Popover.Trigger>
        {error && (
          <span id={errorId} className={styles.error} role="alert">
            {error}
          </span>
        )}
      </span>

      <Popover.Portal container={dialogEl ?? undefined}>
        <Popover.Content className={styles.panel} align="start" sideOffset={4}>
          {searchable && (
            <div className={styles.search}>
              <SearchField
                block
                label={`Tìm ${label.toLowerCase()}`}
                placeholder="Gõ để tìm…"
                value={query}
                onChange={setQuery}
              />
            </div>
          )}
          <div className={styles.list}>
            {shown.map((o) => {
              const on = value.includes(o.value);
              return (
                <label key={o.value} className={styles.row}>
                  <input
                    type="checkbox"
                    className={styles.input}
                    checked={on}
                    onChange={() => toggle(o.value)}
                  />
                  <span className={on ? `${styles.box} ${styles.boxOn}` : styles.box} aria-hidden>
                    {on && <Check size={12} strokeWidth={2.5} />}
                  </span>
                  <span className={styles.rowLabel}>{o.label}</span>
                </label>
              );
            })}
            {shown.length === 0 && <p className={styles.empty}>Không tìm thấy</p>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
