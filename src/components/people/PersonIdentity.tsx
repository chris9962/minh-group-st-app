import { monthLabel } from "@/components/ui/MonthPicker";
import type { PersonDetail } from "@/lib/api/person";
import { formatPhone } from "@/lib/format";
import styles from "./PersonIdentity.module.scss";

/**
 * Dòng nhận diện của một người: tên viết tắt, tên, mã, số điện thoại, phòng.
 *
 * Tách khỏi `PersonKpiPanel` vì hồ sơ Phó giám đốc (`BranchPanel`) cần đúng
 * khối này mà không cần vòng điểm bên dưới.
 */
type Props = {
  person: Pick<PersonDetail, "fullName" | "staffCode" | "phone" | "departmentName" | "joinedMonth">;
};

/** Hai chữ cái đầu của tên — ảnh đại diện chưa có, và tên viết tắt đọc nhanh hơn một ô xám. */
const initialsOf = (fullName: string): string => {
  const parts = fullName.trim().split(/\s+/);
  const last = parts.at(-1) ?? "";
  return (parts.length > 1 ? `${parts[0][0]}${last[0]}` : last.slice(0, 2)).toUpperCase();
};

export function PersonIdentity({ person }: Props) {
  return (
    <div className={styles.identity}>
      <span className={styles.avatar} aria-hidden>
        {initialsOf(person.fullName)}
      </span>
      <div>
        <strong className={styles.name}>{person.fullName}</strong>
        {/* Mã nhân viên là thứ dùng để đối chiếu với app khác, nên đứng cạnh
            số điện thoại ở dòng nhận diện. Tên đăng nhập thì không. */}
        <span className={`${styles.sub} tabular-nums`}>
          {[person.staffCode, formatPhone(person.phone)].filter(Boolean).join(" · ")}
        </span>
        {/* Ban giám đốc không thuộc phòng nào nên chuỗi phòng rỗng — nối
            cứng dấu · sẽ để lại một dấu chấm mồ côi đầu dòng. */}
        <span className={styles.sub}>
          {[person.departmentName, `vào từ ${monthLabel(person.joinedMonth)}`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </div>
  );
}
