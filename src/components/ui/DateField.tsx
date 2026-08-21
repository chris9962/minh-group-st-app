"use client";

import { CalendarDays } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { TextField } from "./TextField";
import styles from "./DateField.module.css";

type Props = Omit<
  React.ComponentProps<typeof TextField>,
  "type" | "trailing" | "value" | "onChange" | "defaultValue" | "inputMode"
> & {
  /** Ngày dạng `yyyy-mm-dd`, hoặc `''` khi chưa nhập xong. */
  value: string;
  onChange: (isoDate: string) => void;
};

/** Chỉ giữ chữ số, tối đa 8 — `ddmmyyyy`. Năm vì vậy không quá 4 chữ số. */
const digitsOf = (text: string) => text.replace(/\D/g, "").slice(0, 8);

/**
 * `0601` → `06/01`. KHÔNG thêm dấu gạch ở cuối.
 *
 * Đây là chỗ làm phím xoá chạy đúng: hiển thị `06/01/` thì bấm xoá một cái ra
 * `06/01`, rồi lần sau lại ra `06/01` — người dùng bấm hai lần mới thấy đổi.
 */
const display = (digits: string) =>
  [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join("/");

const toDigits = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-");
  return y && m && d ? `${d}${m}${y}` : "";
};

/**
 * Đủ 8 chữ số và là ngày CÓ THẬT thì trả `yyyy-mm-dd`, không thì trả `''`.
 *
 * Phải dựng `Date` rồi đọc lại từng phần: `new Date("2026-02-31")` không lỗi mà
 * nhảy sang 03-03. Không kiểm lại thì ô nhận 31/02 và lưu ra ngày khác hẳn.
 */
function toIso(digits: string): string {
  if (digits.length !== 8) return "";

  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));

  const at = new Date(year, month - 1, day);
  if (at.getFullYear() !== year || at.getMonth() !== month - 1 || at.getDate() !== day) return "";

  return `${String(year).padStart(4, "0")}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
}

/**
 * Ô nhập ngày gõ tay, kèm nút mở lịch (spec §U8).
 *
 * `<input type="date">` gốc không dùng được cho ngày sinh: trên điện thoại nó
 * mở bộ chọn lịch và người nhập phải cuộn qua từng năm để tới 1985, năm thì
 * nhận tới 6 chữ số (`275760`), còn phím xoá thì xoá trọn một khối `dd` hay
 * `yyyy` thay vì từng chữ số.
 *
 * Ô này là MỘT ô văn bản, giữ đúng 8 chữ số và tự chèn dấu gạch. Phím xoá vì
 * vậy chạy như mọi ô chữ khác: `06/01/1996` bấm xoá liên tiếp ra `06/01/199`,
 * `06/01/19`, `06/01/1`, `06/01`, `06/0`, `06`, `0`.
 *
 * Ba ô con `dd` `mm` `yyyy` ghép lại cũng ra hình thức tương tự, nhưng khi đó
 * phải tự viết luật nhảy ô lúc gõ và lúc xoá — mà luật đó mới là chỗ dễ sai.
 *
 * Giá trị ra ngoài LUÔN là `yyyy-mm-dd`, giống `<input type="date">` cũ. Chuỗi
 * `dd/mm/yyyy` chỉ để nhìn: nó sắp xếp sai thứ tự khi so chuỗi, và đổi cả giá
 * trị lưu là phải sửa zod, API lẫn cột database theo.
 */
export function DateField({ value, onChange, ...rest }: Props) {
  const [digits, setDigits] = useState(() => toDigits(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  /** Số chữ số đứng trước con trỏ sau lượt gõ; `null` = con trỏ ở cuối. */
  const caretAfter = useRef<number | null>(null);

  /**
   * Đặt lại con trỏ — việc ngoài React nên phải chạm DOM.
   *
   * Chuỗi hiển thị dựng lại từ đầu sau mỗi lượt gõ, nên trình duyệt đẩy con trỏ
   * về cuối. Người sửa một chữ số ở giữa mà con trỏ nhảy đi là gõ tiếp sai chỗ.
   */
  useLayoutEffect(() => {
    const el = inputRef.current;
    const target = caretAfter.current;
    caretAfter.current = null;
    if (!el || target === null) return;

    // Đếm tới chữ số thứ `target`, rồi dừng ngay sau nó.
    let seen = 0;
    let at = 0;
    const text = display(digits);
    while (at < text.length && seen < target) {
      if (/\d/.test(text[at])) seen += 1;
      at += 1;
    }
    el.setSelectionRange(at, at);
  }, [digits]);

  const apply = (nextDigits: string) => {
    setDigits(nextDigits);
    onChange(toIso(nextDigits));
  };

  return (
    <TextField
        {...rest}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        maxLength={10}
        value={display(digits)}
        onChange={(e) => {
          const el = e.target;
          const before = el.value.slice(0, el.selectionStart ?? el.value.length);
          caretAfter.current = digitsOf(before).length;
          apply(digitsOf(el.value));
        }}
      trailing={
        <>
          <button
            type="button"
            className={styles.pick}
            aria-label="Chọn ngày trên lịch"
            onClick={() => {
              const el = pickerRef.current;
              if (!el) return;
              // `showPicker` phải chạy trong ĐÚNG lượt bấm này; gọi sau `await`
              // là trình duyệt từ chối. Trình duyệt cũ không có nó thì mở bằng
              // cách bấm thẳng vào ô ngày ẩn.
              if (typeof el.showPicker === "function") el.showPicker();
              else el.click();
            }}
          >
            <CalendarDays size={16} aria-hidden />
          </button>

          {/* Ô ngày thật, chỉ để mượn bộ chọn lịch của trình duyệt. Không dùng
              `display: none`: một số trình duyệt từ chối mở lịch cho phần tử đã
              bị gỡ khỏi luồng bố cục. */}
          <input
            ref={pickerRef}
            type="date"
            className={styles.picker}
            tabIndex={-1}
            aria-hidden
            value={value}
            onChange={(e) => apply(toDigits(e.target.value))}
          />
        </>
      }
    />
  );
}
