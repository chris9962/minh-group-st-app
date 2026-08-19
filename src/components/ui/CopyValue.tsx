"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import styles from "./CopyValue.module.css";

type State = "idle" | "copied" | "failed";

type ButtonProps = {
  value: string;
  /** Cái đang chép, đọc lên cho trình đọc màn hình: "mật khẩu mới", "tên đăng nhập và mật khẩu"… */
  label: string;
  /** Có thì hiện chữ cạnh icon. Không có thì nút chỉ còn icon. */
  children?: React.ReactNode;
  /**
   * Giấu câu "Đã chép" khỏi mắt, chỉ để trình đọc màn hình đọc.
   *
   * Dùng khi nút nằm trong lưới trường dày đặc: câu đó dài hơn cả giá trị bên
   * cạnh nên nó xuống dòng, đẩy ô cao lên và làm cả hàng lệch nhau. Icon vẫn
   * đổi từ Copy sang Check, nên vẫn còn kênh thị giác thứ hai ngoài màu.
   */
  quiet?: boolean;
};

/**
 * Nút chép, phẳng — không viền không nền.
 *
 * Là `<button>` thật chứ không phải `<span onClick>`: bàn phím Tab tới được,
 * Enter/Space bấm được, và trình đọc màn hình biết đây là nút chứ không phải
 * chữ thường.
 */
export function CopyButton({ value, label, children, quiet = false }: ButtonProps) {
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
        aria-label={`Chép ${label}`}
      >
        {state === "copied" ? (
          <Check size={15} aria-hidden />
        ) : (
          <Copy size={15} aria-hidden />
        )}
        {children}
      </button>

      {/* Chữ chứ không chỉ đổi icon: màu và hình không được là kênh duy nhất.
          `aria-live` để trình đọc màn hình báo mà không cướp tiêu điểm. */}
      <span className={quiet ? "sr-only" : styles.status} aria-live="polite">
        {state === "copied" && "Đã chép"}
        {state === "failed" && "Không chép được, bấm chọn rồi copy tay"}
      </span>
    </span>
  );
}

/**
 * Giá trị + nút chép nhỏ bên cạnh.
 *
 * Giá trị đặt `user-select: all` — chép bằng clipboard cần trang chạy trên
 * https (hoặc localhost), lên http là API không tồn tại. Lúc đó vẫn phải bấm
 * chọn tay được, không thì người dùng không có cách chép.
 */
export function CopyValue({ value, label }: { value: string; label: string }) {
  return (
    <span className={styles.wrap}>
      <span className={styles.value}>{value}</span>
      <CopyButton value={value} label={`${label}: ${value}`} />
    </span>
  );
}
