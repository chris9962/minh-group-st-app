"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import styles from "./CopyValue.module.css";

type Props = {
  value: string;
  /** Cái đang chép, đọc lên cho trình đọc màn hình: "mật khẩu mới", "số tài khoản"… */
  label: string;
};

type State = "idle" | "copied" | "failed";

/**
 * Giá trị bấm một cái là chép xong.
 *
 * Là `<button>` thật chứ không phải `<span onClick>`: bàn phím Tab tới được,
 * Enter/Space bấm được, và trình đọc màn hình biết đây là nút chứ không phải
 * chữ thường. Bọc div rồi gắn onClick thì mất cả ba thứ đó.
 *
 * Giá trị vẫn đặt `user-select: all` — chép bằng clipboard cần trang chạy trên
 * https (hoặc localhost), lên http là API không tồn tại. Lúc đó vẫn phải bấm
 * chọn tay được, không thì người dùng kẹt hẳn.
 */
export function CopyValue({ value, label }: Props) {
  const [state, setState] = useState<State>("idle");

  // Trả nhãn về trạng thái ban đầu sau hai giây. Hẹn giờ là hệ thống ngoài
  // React nên phải dọn khi state đổi tiếp hoặc component biến mất.
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.button}
        onClick={copy}
        aria-label={`Chép ${label}: ${value}`}
      >
        <span className={styles.value}>{value}</span>
        {state === "copied" ? (
          <Check size={14} aria-hidden />
        ) : (
          <Copy size={14} aria-hidden />
        )}
      </button>

      {/* Chữ chứ không chỉ đổi icon: màu và hình không được là kênh duy nhất.
          `aria-live` để trình đọc màn hình báo mà không cướp tiêu điểm. */}
      <span className={styles.status} aria-live="polite">
        {state === "copied" && "Đã chép"}
        {state === "failed" && "Không chép được, bấm chọn rồi copy tay"}
      </span>
    </span>
  );
}
