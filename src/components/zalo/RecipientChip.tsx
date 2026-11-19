import { clsx } from "clsx";
import { Phone, User, Users, X } from "lucide-react";
import { formatPhone } from "@/lib/format";
import styles from "./RecipientChip.module.scss";

export type RecipientType = "group" | "person" | "phone";

const ICON: Record<RecipientType, typeof User> = { group: Users, person: User, phone: Phone };

type Props = {
  type: RecipientType;
  /** Rỗng với số nhập tay chưa tra ra tên Zalo: chip chỉ hiện số. */
  name: string;
  phone?: string;
  onRemove?: () => void;
};

export function RecipientChip({ type, name, phone, onRemove }: Props) {
  const Icon = ICON[type];
  const shownName = name || (phone ? formatPhone(phone) : "");

  return (
    <span className={clsx(styles.chip, onRemove && styles.removable)}>
      <Icon size={14} aria-hidden className={styles.icon} />
      <span className={styles.name}>{shownName}</span>
      {name && phone && <span className={styles.phone}>{formatPhone(phone)}</span>}
      {onRemove && (
        <button type="button" className={styles.remove} onClick={onRemove} aria-label={`Bỏ ${shownName}`}>
          <X size={13} aria-hidden />
        </button>
      )}
    </span>
  );
}
