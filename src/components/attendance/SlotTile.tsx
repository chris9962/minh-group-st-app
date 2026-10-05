"use client";

import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { AttendanceCheck } from "@/lib/api/attendance";
import { clockNowVn } from "@/lib/format";
import styles from "./SlotTile.module.scss";

export type SlotAction = {
  icon: LucideIcon;
  text: string;
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
};

type Props = {
  label: string;
  check?: AttendanceCheck;
  onView: (check: AttendanceCheck) => void;
  /** Có khi đây là lượt kế tiếp được bấm. */
  action?: SlotAction;
  /** `null` khi chưa tải xong tháng: chưa biết lượt này đã chấm hay chưa. */
  missingText: string | null;
};

/**
 * Một ô lượt chấm công, dùng chung cho 4 lượt có ảnh của nhân viên Điểm ATM và
 * lượt điểm danh của Phòng An Sinh: cùng khung 3:4, cùng nút, cùng ô bấm trên
 * điện thoại.
 */
export function SlotTile({ label, check, onView, action, missingText }: Props) {
  if (check) {
    const time = clockNowVn(new Date(check.checkedAt)).slice(0, 5);
    if (!check.photoUrl)
      return (
        <li className={clsx(styles.slot, styles.slotDone)}>
          <button
            type="button"
            className={styles.doneTile}
            aria-label={`Xem lượt ${label} lúc ${time}`}
            onClick={() => onView(check)}
          >
            <span className={styles.label}>{label}</span>
            <span className={styles.doneTime}>{time}</span>
            {check.place && (
              <span className={styles.donePlace}>
                <MapPin size={13} aria-hidden />
                {check.place}
              </span>
            )}
          </button>
        </li>
      );
    return (
      <li className={clsx(styles.slot, styles.slotPhoto)}>
        <button
          type="button"
          className={styles.photoTile}
          aria-label={`Xem lượt ${label} lúc ${time}`}
          onClick={() => onView(check)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh đi qua /api/images có kiểm phiên, next/image không tối ưu được */}
          <img src={check.photoUrl} alt="" className={styles.photo} />
          <span className={styles.overlayTime}>{time}</span>
          {check.place && <span className={styles.overlayPlace}>{check.place}</span>}
        </button>
      </li>
    );
  }

  if (action) {
    const Icon = action.icon;
    // Máy tính bấm nút cam; điện thoại bấm cả ô, ô chỉ có icon ở giữa.
    return (
      <li className={clsx(styles.slot, styles.slotNext)}>
        <span className={styles.label}>{label}</span>
        <Button block className={styles.captureButton} disabled={action.disabled} onClick={action.onClick}>
          <Icon size={16} aria-hidden />
          {action.text}
        </Button>
        <button
          type="button"
          className={styles.captureTile}
          aria-label={action.ariaLabel}
          disabled={action.disabled}
          onClick={action.onClick}
        >
          <Icon size={28} aria-hidden />
        </button>
      </li>
    );
  }

  return (
    <li className={styles.slot}>
      <span className={styles.label}>{label}</span>
      {missingText && <span className={styles.missing}>{missingText}</span>}
    </li>
  );
}
