"use client";

import { clsx } from "clsx";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useTheme, type Accent, type Theme } from "@/store/theme";
import styles from "./AppearanceDialog.module.css";

const THEMES: { value: Theme; label: string; className: string }[] = [
  { value: "light", label: "Sáng", className: styles.windowLight },
  { value: "dark", label: "Tối", className: styles.windowDark },
];

const ACCENTS: { value: Accent; label: string; className: string }[] = [
  { value: "orange", label: "Cam", className: styles.swatchOrange },
  { value: "blue", label: "Xanh dương", className: styles.swatchBlue },
  { value: "cyan", label: "Xanh ngọc", className: styles.swatchCyan },
  { value: "pink", label: "Hồng", className: styles.swatchPink },
  { value: "slate", label: "Xám than", className: styles.swatchSlate },
];

/** Đổi là áp ngay, không có nút Lưu: xem thử trên chính app rồi đổi lại được. */
export function AppearanceDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const accent = useTheme((s) => s.accent);
  const setAccent = useTheme((s) => s.setAccent);

  return (
    <Dialog
      open={open}
      title="Giao diện"
      onClose={onClose}
      footer={<Button onClick={onClose}>Xong</Button>}
    >
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Chế độ</legend>
        <div className={styles.themes}>
          {THEMES.map((t) => (
            <label key={t.value} className={styles.themeOption}>
              <input
                type="radio"
                name="appearance-theme"
                className="sr-only"
                checked={theme === t.value}
                onChange={() => setTheme(t.value)}
              />
              <span className={clsx(styles.window, t.className)} aria-hidden>
                <span className={styles.sidebar}>
                  <span className={styles.navActive} />
                  <span className={styles.nav} />
                  <span className={styles.nav} />
                  <span className={styles.nav} />
                </span>
                <span className={styles.content}>
                  <span className={styles.card}>
                    <span className={clsx(styles.line, styles.lineWide)} />
                    <span className={styles.line} />
                    <span className={styles.bar} />
                  </span>
                  <span className={styles.button} />
                </span>
              </span>
              <span className={styles.optionLabel}>{t.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Màu chủ đạo</legend>
        <div className={styles.accents}>
          {ACCENTS.map((a) => (
            <label key={a.value} className={styles.accentOption}>
              <input
                type="radio"
                name="appearance-accent"
                className="sr-only"
                checked={accent === a.value}
                onChange={() => setAccent(a.value)}
              />
              <span className={clsx(styles.swatch, a.className)} aria-hidden />
              <span className={styles.optionLabel}>{a.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </Dialog>
  );
}
