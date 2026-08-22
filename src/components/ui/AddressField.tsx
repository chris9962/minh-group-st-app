"use client";

import { clsx } from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { useContext, useId, useRef, useState } from "react";
import { matchesSearch } from "@/lib/format";
import { DialogPortalContext } from "./Dialog";
import styles from "./Combobox.module.css";

type Props = {
  label: string;
  /** Chuỗi địa chỉ — chữ TỰ DO là giá trị thật, gợi ý chỉ điền hộ. */
  value: string;
  onChange: (value: string) => void;
  /** Danh sách `Tỉnh, Xã, Ấp` đã ghép sẵn (spec §U9). */
  suggestions: string[];
  placeholder?: string;
  required?: boolean;
  error?: string;
};

/**
 * Danh sách cả nước có thể tới ~20.000 dòng — vẽ hết là khựng khi mở. Người
 * dùng gõ thêm chữ thì danh sách tự thu, nên chỉ cần một trang đầu.
 */
const MAX_SHOWN = 50;

/**
 * Ô địa chỉ có gợi ý (spec §U9) — KHÁC `Combobox` một điểm quyết định: chữ tự
 * do LÀ giá trị, không phải từ khoá lọc bị vứt khi rời ô.
 *
 * `Combobox` chọn một mục trong danh sách đóng: rời ô là chữ gõ dở biến mất,
 * hiện lại nhãn của mục đã chọn. Ô địa chỉ thì ngược lại — chọn gợi ý
 * `Cần Thơ, Cái Răng, Ấp 1` xong người dùng gõ NỐI `, số nhà 999`, và chuỗi
 * cuối cùng chính là thứ được lưu. Nhét hành vi này vào `Combobox` là component
 * đó phải mang hai luật giá trị trái nhau.
 *
 * Dùng chung CSS với `Combobox` — cùng hình thức, chỉ khác luật giá trị.
 */
export function AddressField({
  label,
  value,
  onChange,
  suggestions,
  placeholder,
  required,
  error,
}: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const dialogEl = useContext(DialogPortalContext);
  const inputRef = useRef<HTMLInputElement>(null);

  const matched = value.trim()
    ? suggestions.filter((s) => matchesSearch(s, value))
    : suggestions;
  const shown = matched.slice(0, MAX_SHOWN);
  // Gõ số nhà vào sau là hết gợi ý khớp — danh sách tự đóng, không hiện
  // "Không tìm thấy": chữ tự do hợp lệ nên không có gì để báo.
  const listOpen = open && shown.length > 0;

  const commit = (text: string) => {
    onChange(text);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  return (
    <Popover.Root open={listOpen} onOpenChange={setOpen}>
      <span className={styles.blockWrap}>
        <label
          htmlFor={id}
          className={styles.blockLabel}
          // Cùng lý do với `Combobox`: bấm nhãn không được mở lại danh sách.
          onMouseDown={(e) => {
            e.preventDefault();
            inputRef.current?.blur();
          }}
          onClick={(e) => e.preventDefault()}
        >
          {label}
          {required && (
            <span className={styles.required} aria-hidden>
              {" *"}
            </span>
          )}
        </label>
        <Popover.Anchor asChild>
          <input
            ref={inputRef}
            id={id}
            type="text"
            role="combobox"
            aria-expanded={listOpen}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-required={required || undefined}
            aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
            aria-invalid={Boolean(error)}
            aria-errormessage={error ? errorId : undefined}
            autoComplete="off"
            className={`input ${styles.input} ${styles.blockInput}`}
            value={value}
            placeholder={placeholder}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
              setActiveIndex(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActiveIndex((i) => Math.min(i + 1, shown.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                // Chỉ chặn Enter khi đang trỏ vào một gợi ý — không thì cứ để
                // form xử lý như mọi ô nhập khác.
                if (listOpen && shown[activeIndex]) {
                  e.preventDefault();
                  commit(shown[activeIndex]);
                }
              } else if (e.key === "Escape") {
                setOpen(false);
                setActiveIndex(-1);
              }
            }}
          />
        </Popover.Anchor>
        {error && (
          <span id={errorId} className={styles.error} role="alert">
            {error}
          </span>
        )}
      </span>

      <Popover.Portal container={dialogEl ?? undefined}>
        <Popover.Content
          className={styles.list}
          align="start"
          sideOffset={4}
          style={{ width: "var(--radix-popover-trigger-width)" }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <ul id={listId} role="listbox" className={styles.listInner}>
            {shown.map((s, i) => (
              <li
                key={s}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={s === value}
                className={clsx(styles.option, i === activeIndex && styles.optionActive)}
                // Chặn blur nổ trước click — không thì danh sách đóng trước khi kịp chọn.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(s)}
              >
                {s}
              </li>
            ))}
            {matched.length > MAX_SHOWN && (
              <li className={styles.empty} aria-hidden>
                … còn {matched.length - MAX_SHOWN} gợi ý — gõ thêm để thu hẹp
              </li>
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
