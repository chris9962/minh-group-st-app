"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import {
  RECORD_DEFAULTS,
  recordAttendance,
  type AttendanceDayRow,
  type AttendanceMode,
  type TimeRange,
} from "@/lib/api/attendance";
import { formatDate } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./RecordAttendanceDialog.module.scss";

type Shift = "morning" | "afternoon" | "day";
type ShiftState = TimeRange & { on: boolean; done: boolean };

const SHIFT_LABEL: Record<Shift, string> = { morning: "Ca sáng", afternoon: "Ca chiều", day: "Cả ngày" };

/**
 * Ghi công thay nhân viên (chốt 2026-10-30). Giờ điền sẵn theo `RECORD_DEFAULTS`
 * để người ghi bấm Lưu ngay; ca đã đủ lượt thì khoá, máy chủ cũng không ghi đè.
 */
export function RecordAttendanceDialog({
  row,
  mode,
  workDate,
  onClose,
}: {
  row: AttendanceDayRow;
  mode: AttendanceMode;
  workDate: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const has = (slot: string) => row.checks.some((c) => c.slot === slot);
  const done: Record<Shift, boolean> = {
    morning: has("morning-in") && has("noon-out"),
    afternoon: has("afternoon-in") && has("afternoon-out"),
    day: has("check-in"),
  };
  const shiftsOfMode: Shift[] = mode === "daily" ? ["day"] : ["morning", "afternoon"];
  const [shifts, setShifts] = useState<Record<Shift, ShiftState>>(() => ({
    morning: { ...RECORD_DEFAULTS.morning, on: !done.morning, done: done.morning },
    afternoon: { ...RECORD_DEFAULTS.afternoon, on: !done.afternoon, done: done.afternoon },
    day: { ...RECORD_DEFAULTS.day, on: !done.day, done: done.day },
  }));
  const update = (shift: Shift, patch: Partial<ShiftState>) =>
    setShifts((prev) => ({ ...prev, [shift]: { ...prev[shift], ...patch } }));

  const picked = shiftsOfMode.filter((s) => shifts[s].on && !shifts[s].done);
  const invalid = picked.find((s) => !(shifts[s].from < shifts[s].to));
  const rangeOf = (s: Shift): TimeRange | null =>
    shiftsOfMode.includes(s) && shifts[s].on && !shifts[s].done ? { from: shifts[s].from, to: shifts[s].to } : null;

  const save = useMutation({
    mutationFn: () =>
      recordAttendance({
        userId: row.userId,
        workDate,
        morning: rangeOf("morning"),
        afternoon: rangeOf("afternoon"),
        day: rangeOf("day"),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast.ok(`Đã ghi công cho ${row.fullName}`);
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không ghi được công.")),
  });

  return (
    <Dialog
      open
      title={`Ghi công - ${row.fullName}`}
      onClose={onClose}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Huỷ
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={picked.length === 0 || invalid !== undefined || save.isPending}
          >
            Ghi công
          </Button>
        </>
      }
    >
      <p className={styles.date}>Ngày {formatDate(workDate)}</p>
      <div className={styles.shifts}>
        {shiftsOfMode.map((s) => {
          const shift = shifts[s];
          const off = shift.done || !shift.on;
          return (
            <fieldset key={s} className={styles.shift} disabled={shift.done || save.isPending}>
              <legend className="sr-only">{SHIFT_LABEL[s]}</legend>
              {mode === "daily" ? (
                <span className={styles.shiftName}>{SHIFT_LABEL[s]}</span>
              ) : (
                <Checkbox
                  checked={shift.on && !shift.done}
                  onCheckedChange={(on) => update(s, { on })}
                  label={SHIFT_LABEL[s]}
                  disabled={shift.done}
                />
              )}
              {shift.done ? (
                <span className={styles.done}>Đã đủ lượt chấm</span>
              ) : (
                <div className={styles.times}>
                  <TextField
                    label="Giờ vào"
                    type="time"
                    value={shift.from}
                    disabled={off}
                    onChange={(e) => update(s, { from: e.target.value })}
                  />
                  <TextField
                    label="Giờ ra"
                    type="time"
                    value={shift.to}
                    disabled={off}
                    error={shift.on && !(shift.from < shift.to) ? "Giờ ra phải sau giờ vào" : undefined}
                    onChange={(e) => update(s, { to: e.target.value })}
                  />
                </div>
              )}
            </fieldset>
          );
        })}
      </div>
    </Dialog>
  );
}
