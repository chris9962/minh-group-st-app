"use client";

import type { Scope } from "@/lib/types";
import styles from "./ScopeSwitcher.module.css";

const LABEL: Record<Scope, string> = {
  own: "Của tôi",
  team: "Nhóm tôi",
  department: "Phòng tôi",
  branch: "Chi nhánh",
  company: "Toàn công ty",
};

type Props = {
  options: Scope[];
  value: Scope;
  onChange: (scope: Scope) => void;
};

/**
 * Thanh chọn phạm vi ở đầu mọi màn danh sách.
 *
 * Ai chỉ được cấp một mức thì KHÔNG hiện gì — nhân viên kinh doanh nhìn thấy
 * giao diện y như không có tính năng này.
 */
export function ScopeSwitcher({ options, value, onChange }: Props) {
  if (options.length < 2) return null;

  return (
    <div className={`seg ${styles.seg}`} role="group" aria-label="Phạm vi dữ liệu">
      {options.map((scope) => (
        <label key={scope} className="seg-opt">
          <input
            type="radio"
            name="scope"
            checked={value === scope}
            onChange={() => onChange(scope)}
          />
          {LABEL[scope]}
        </label>
      ))}
    </div>
  );
}
