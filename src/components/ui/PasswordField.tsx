"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { TextField } from "./TextField";
import styles from "./PasswordField.module.css";

type Props = Omit<React.ComponentProps<typeof TextField>, "type" | "trailing">;

/**
 * Ô mật khẩu có nút hiện/ẩn.
 *
 * Đội KD gõ trên điện thoại ngoài trời, bàn phím ảo hay gõ nhầm mà ô mật khẩu
 * chỉ hiện dấu chấm — không có nút này thì sai một ký tự cũng không soát ra.
 */
export function PasswordField(props: Props) {
  const [shown, setShown] = useState(false);

  return (
    <TextField
      {...props}
      type={shown ? "text" : "password"}
      trailing={
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setShown(!shown)}
          aria-label={shown ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          aria-pressed={shown}
        >
          {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      }
    />
  );
}
