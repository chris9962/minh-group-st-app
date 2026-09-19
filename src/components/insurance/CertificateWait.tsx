"use client";

import { useEffect, useState } from "react";

/** `mm:ss` theo TỔNG số phút, không đổi sang giờ (chủ dự án chốt 2026-09-19). */
const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
};

/**
 * Đơn đã đợi PVI cấp giấy chứng nhận bao lâu, tính từ lượt chuyển sang
 * `awaiting-certificate` (`awaitingSince`), nhảy mỗi giây.
 *
 * Không dùng vùng `aria-live`: chữ đổi mỗi giây thì trình đọc màn hình đọc
 * lại liên tục.
 */
export function CertificateWait({ since, className }: { since: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className={`tabular-nums ${className ?? ""}`.trim()}>
      {formatElapsed(now - new Date(since).getTime())}
    </span>
  );
}
