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
  /**
   * Ngày lịch mở sẵn khi ô còn TRỐNG, dạng `yyyy-mm-dd`.
   *
   * Ô ngày sinh cần nó: lịch mặc định mở ở năm hiện tại, mà khách nhỏ tuổi nhất
   * cũng sinh trước đó 15 năm, nên người nhập phải cuộn ngược 15 lần mỗi lần
   * lập hồ sơ. Không truyền thì lịch mở ở ngày trình duyệt tự chọn.
   *
   * Chỉ đổi chỗ lịch MỞ RA. Ô vẫn trống cho tới khi người dùng chọn thật.
   */
  pickerStart?: string;
  /**
   * Cận ngày cho LỊCH, dạng `yyyy-mm-dd`.
   *
   * Đưa xuống ô ngày ẩn chứ không đưa lên ô chữ: `max` trên một ô `type="text"`
   * không có nghĩa gì, và người dùng vẫn chọn được ngày ngoài khoảng ở lịch.
   *
   * ⚠️ Chỉ khoanh vùng chọn của LỊCH, KHÔNG chặn được người gõ tay. Luật thật
   * vẫn phải nằm ở schema zod — máy chủ kiểm cùng một luật.
   */
  min?: string;
  max?: string;
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
export function DateField({ value, onChange, pickerStart, min, max, ...rest }: Props) {
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
          {/*
            Ô ngày thật NẰM ĐÈ lên biểu tượng lịch, trong suốt, và chính nó nhận
            lượt chạm.

            Bản trước dựng một `<button>` rồi gọi `showPicker()` lên một ô ngày
            ẩn 1px kèm `pointer-events: none`. Trên điện thoại lịch không mở:
            Safari từ chối `showPicker()` cho phần tử ẩn, và `click()` thay thế
            cũng không mở bộ chọn của hệ điều hành. Chạm thẳng vào ô ngày thì hệ
            điều hành mở lịch như với mọi ô ngày khác, không cần API nào.

            `showPicker()` vẫn gọi cho máy tính để bàn: ở Chrome, bấm vào thân ô
            ngày KHÔNG mở lịch, chỉ bấm đúng biểu tượng mới mở.
          */}
          <input
            ref={pickerRef}
            type="date"
            className={styles.picker}
            aria-label="Chọn ngày trên lịch"
            min={min}
            max={max}
            value={value || pickerStart || ""}
            onChange={(e) => apply(toDigits(e.target.value))}
            onClick={() => {
              const el = pickerRef.current;
              // Trên điện thoại lịch đã mở do chính lượt chạm này; gọi thêm lần
              // nữa thì trình duyệt ném lỗi. Bọc lại để lỗi đó không nổi lên.
              try {
                el?.showPicker?.();
              } catch {
                /* Trình duyệt không cho gọi lúc này — lượt chạm đã đủ. */
              }
            }}
          />

          <span className={styles.pick} aria-hidden>
            <CalendarDays size={16} />
          </span>
        </>
      }
    />
  );
}
