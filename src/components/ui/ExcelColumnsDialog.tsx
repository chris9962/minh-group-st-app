"use client";

import { usePrefs } from "@/store/prefs";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { Dialog } from "./Dialog";
import styles from "./ExcelColumnsDialog.module.css";

export type ExcelColumnOption = { key: string; label: string; group: string };

type Props = {
  /** Khoá lưu lựa chọn trong localStorage, mỗi màn một khoá. */
  screen: string;
  columns: ExcelColumnOption[];
  exporting: boolean;
  onClose: () => void;
  onExport: (keys: string[]) => void;
};

const NONE: string[] = [];

/** Chọn cột trước khi xuất Excel. Cột bỏ tick lưu theo máy, lần xuất sau giữ nguyên. */
export function ExcelColumnsDialog({ screen, columns, exporting, onClose, onExport }: Props) {
  const hidden = usePrefs((s) => s.excelHiddenColumns[screen] ?? NONE);
  const setHidden = usePrefs((s) => s.setExcelHiddenColumns);
  const selected = columns.filter((c) => !hidden.includes(c.key)).map((c) => c.key);
  const groups = [...new Set(columns.map((c) => c.group))];

  const toggle = (key: string, on: boolean) =>
    setHidden(screen, on ? hidden.filter((k) => k !== key) : [...hidden, key]);

  return (
    <Dialog
      open
      title="Xuất Excel"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button disabled={exporting || selected.length === 0} onClick={() => onExport(selected)}>
            {exporting ? "Đang xuất…" : "Xuất Excel"}
          </Button>
        </>
      }
    >
      <div className={styles.groups}>
        {groups.map((group) => (
          <fieldset key={group} className={styles.fieldset}>
            <legend className={styles.legend}>{group}</legend>
            <div className={styles.grid}>
              {columns
                .filter((c) => c.group === group)
                .map((c) => (
                  <Checkbox
                    key={c.key}
                    checked={!hidden.includes(c.key)}
                    onCheckedChange={(on) => toggle(c.key, on)}
                    label={c.label}
                  />
                ))}
            </div>
          </fieldset>
        ))}
      </div>
    </Dialog>
  );
}
