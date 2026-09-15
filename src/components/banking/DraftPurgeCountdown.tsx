"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { businessDay } from "@/lib/format";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 00:00 giờ Việt Nam kế tiếp — mốc timer `mgst-purge-drafts` xoá bản nháp.
 * Việt Nam không đổi giờ mùa nên cộng đúng 24 giờ vào 00:00 của ngày hiện tại.
 */
const nextMidnight = (now: number): number =>
  new Date(`${businessDay(new Date(now))}T00:00:00+07:00`).getTime() + DAY_MS;

const formatLeft = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "dưới 1 phút";
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes} phút`;
  return `${hours} giờ ${String(minutes % 60).padStart(2, "0")} phút`;
};

/**
 * Cảnh báo trên tài khoản ĐANG TẠO: hệ thống xoá lúc 00:00 giờ Việt Nam
 * (chốt 2026-09-15), còn bao lâu tới lúc đó.
 *
 * Đếm theo giờ máy người dùng nhưng mốc tính theo giờ Việt Nam, nên máy đặt
 * sai múi giờ vẫn ra đúng con số. Cập nhật mỗi 30 giây cho số phút lệch tối đa
 * nửa phút. Không dùng vùng `alert`: chữ đổi mỗi phút thì trình đọc màn hình
 * đọc lại cả câu mỗi phút.
 */
export function DraftPurgeCountdown() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const left = nextMidnight(now) - now;

  return (
    <Alert tone="warning" live={false}>
      Tài khoản đang tạo tự xoá lúc 00:00, còn {formatLeft(left)}.
    </Alert>
  );
}
