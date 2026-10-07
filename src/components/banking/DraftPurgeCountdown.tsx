"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { DRAFT_TTL_MINUTES } from "@/lib/api/bankAccounts";

const MINUTE_MS = 60_000;

/** `12p`, làm tròn LÊN phút: chưa tới hạn thì không hiện `0p`. */
const formatLeft = (ms: number): string => `${Math.max(1, Math.ceil(ms / MINUTE_MS))}p`;

/**
 * Cảnh báo trên tài khoản ĐANG TẠO: bản nháp sống `DRAFT_TTL_MINUTES` kể từ
 * lúc giữ chỗ (chốt 2026-10-06), còn bao lâu tới lúc hệ thống xoá.
 *
 * Cập nhật mỗi 30 giây cho số phút lệch tối đa nửa phút. Không dùng vùng
 * `alert`: chữ đổi mỗi phút thì trình đọc màn hình đọc lại cả câu mỗi phút.
 */
export function DraftPurgeCountdown({ createdAt }: { createdAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const left = Date.parse(createdAt) + DRAFT_TTL_MINUTES * MINUTE_MS - now;

  return (
    <Alert tone="warning" live={false}>
      {left > 0 ? (
        <>
          Tự xoá sau <span className="tabular-nums">{formatLeft(left)}</span> nếu chưa hoàn tất.
        </>
      ) : (
        `Bản nháp đã quá ${DRAFT_TTL_MINUTES} phút, hệ thống sắp xoá.`
      )}
    </Alert>
  );
}
