"use client";

import { clsx } from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { useContext, useId, useRef, useState } from "react";
import { matchesSearch } from "@/lib/format";
import { DialogPortalContext } from "./Dialog";
import styles from "./Combobox.module.css";

export type ComboboxOption = { value: string; label: string };

type Props = {
  label: string;
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Thông báo lỗi. Có giá trị thì ô được đánh dấu `aria-invalid` và nối vào câu lỗi. */
  error?: string;
  /** Nhãn xếp phía trên, ô rộng hết cỡ — dùng khi đứng cùng hàng với TextField trong form. */
  block?: boolean;
};

/**
 * Ô chọn có gõ để lọc — dùng thay `Select` khi danh sách quá dài để lướt tay
 * (ví dụ xã/ấp cả nước). Không dùng `<datalist>` gốc vì trình duyệt vẽ khung
 * gợi ý theo giao diện hệ điều hành, không theo được token màu/khoảng cách
 * của design system.
 *
 * Danh sách nổi lên qua `@radix-ui/react-popover` (portal ra ngoài DOM) thay
 * vì `position: absolute` thường — hộp thoại (Dialog) cuộn nội dung bằng
 * `overflow-y: auto`, một khối absolute nằm trong đó bị cắt mất phần tràn ra
 * ngoài, y hệt cách `DateRangePicker`/`FilterButton` đã phải dùng Popover.
 */
export function Combobox({
  label,
  value,
  options,
  onChange,
  placeholder,
  error,
  block = false,
}: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  /**
   * Con trỏ đang nằm trong ô — KHÁC với `open` của danh sách gợi ý.
   *
   * Hai thứ này từng dùng chung một state và chữ trong ô bám theo `open`. Khi
   * Combobox nằm trong một Popover khác (ô lọc của `FilterButton`), lượt bấm
   * chuột vừa mở danh sách vừa bị lớp bắt-bấm-ra-ngoài của Radix đóng lại ngay,
   * nên `open` về `false` và nhãn đang chọn hiện lại. Người dùng gõ tiếp thì
   * chữ nối vào sau nhãn đó — phải tự xoá tay trước mỗi lần tìm.
   */
  const [editing, setEditing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const dialogEl = useContext(DialogPortalContext);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const displayValue = editing ? query : (selected?.label ?? "");
  const filtered = query.trim() ? options.filter((o) => matchesSearch(o.label, query)) : options;

  const commit = (option: ComboboxOption) => {
    onChange(option.value);
    setQuery("");
    setOpen(false);
    setEditing(false);
    setActiveIndex(-1);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <span className={block ? styles.blockWrap : styles.wrap}>
        {/*
          Bấm vào nhãn KHÔNG mở danh sách gợi ý. Nhãn nằm ngay trên ô, mà danh
          sách đang mở thì người dùng bấm hụt lên phía trên để đóng nó — trúng
          nhãn là danh sách mở lại ngay.

          Vẫn giữ `htmlFor`/`id`: liên kết đó là thứ trình đọc màn hình đọc
          (AGENTS.md §8). Chỉ bỏ hành vi kích hoạt bằng chuột, bàn phím đi bằng
          Tab nên không đổi.
        */}
        <label
          htmlFor={id}
          className={block ? styles.blockLabel : styles.label}
          onMouseDown={(e) => {
            e.preventDefault();
            // Nhả con trỏ ra hẳn. Chỉ chặn `preventDefault` thì Radix đóng danh
            // sách nhưng con trỏ vẫn nằm trong ô, nên ô kẹt ở trạng thái đang
            // gõ: chữ trống, nhãn đang chọn không quay lại.
            inputRef.current?.blur();
          }}
          onClick={(e) => e.preventDefault()}
        >
          {label}
        </label>
        <Popover.Anchor asChild>
          <input
            ref={inputRef}
            id={id}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
            aria-invalid={Boolean(error)}
            aria-errormessage={error ? errorId : undefined}
            autoComplete="off"
            className={`input ${styles.input} ${block ? styles.blockInput : ""}`}
            value={displayValue}
            placeholder={placeholder}
            onFocus={() => {
              setOpen(true);
              setEditing(true);
              setQuery("");
              setActiveIndex(-1);
            }}
            // Mở lại ở `click`, không chỉ ở `focus`: lượt bấm mở danh sách rồi
            // bị chính lớp bắt-bấm-ra-ngoài của Radix đóng ngay trong cùng một
            // nhịp. `click` chạy sau `pointerup` nên nó đứng vững.
            onClick={() => setOpen(true)}
            onBlur={() => {
              setEditing(false);
              setQuery("");
            }}
            onChange={(e) => {
              setOpen(true);
              setEditing(true);
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
                setEditing(false);
                setQuery("");
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
            {filtered.length === 0 ? (
              <li className={styles.empty}>Không tìm thấy</li>
            ) : (
              filtered.map((o, i) => (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={o.value === value}
                  className={clsx(styles.option, i === activeIndex && styles.optionActive)}
                  // Chặn blur nổ trước click — không thì danh sách đóng trước khi kịp chọn.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(o)}
                >
                  {o.label}
                </li>
              ))
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
