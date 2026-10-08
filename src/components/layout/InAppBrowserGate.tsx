"use client";

import { Ban } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import styles from "./InAppBrowserGate.module.css";

/** Trình duyệt trong Zalo gắn `Zalo` vào user agent ở cả Android lẫn iOS. */
const ZALO_UA = /zalo/i;

const subscribe = () => () => {};
const inZalo = () => ZALO_UA.test(navigator.userAgent);

/**
 * Chặn dùng app trong trình duyệt của Zalo (chốt 2026-10-08): camera và tải ảnh
 * trong đó chạy không ổn định, nhân viên phải mở bằng Chrome hoặc Safari.
 *
 * Máy chủ không biết user agent lúc dựng trang, nên lượt đầu luôn vẽ app;
 * `useSyncExternalStore` đổi sang màn chặn ngay khi trang chạy ở trình duyệt.
 */
export function InAppBrowserGate({ children }: { children: React.ReactNode }) {
  const blocked = useSyncExternalStore(subscribe, inZalo, () => false);
  const [copied, setCopied] = useState(false);

  if (!blocked) return children;

  const url = window.location.href;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <Ban size={32} className={styles.icon} aria-hidden />
        <h1 className={styles.title}>Không dùng được trong Zalo</h1>
        <p className={styles.text}>Bạn mở app bằng Chrome hoặc Safari.</p>
        <ol className={styles.steps}>
          <li>Bấm nút ⋯ ở góc trên bên phải.</li>
          <li>Chọn mở bằng trình duyệt.</li>
        </ol>
        <div className={styles.link}>
          <input
            className={styles.url}
            value={url}
            readOnly
            aria-label="Link của app"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button variant="secondary" onClick={() => void copy()}>
            {copied ? "Đã sao chép" : "Sao chép link"}
          </Button>
        </div>
      </div>
    </main>
  );
}
