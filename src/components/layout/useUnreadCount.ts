"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchUnreadCount } from "@/lib/api/notifications";

/**
 * Số thông báo chưa đọc — dùng chung cho chuông ở thanh trên và ô ở thanh đáy.
 *
 * Hai nơi cùng một `queryKey` nên TanStack gộp thành MỘT lượt gọi, dù cả hai
 * cùng hiện. Tách hook ra để hai nơi không đặt hai chu kỳ hỏi lệch nhau — lệch
 * thì con số ở hai chỗ khác nhau trong cùng một màn hình.
 */
const REFRESH_MS = 60_000;

export function useUnreadCount(): number {
  const { data } = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: fetchUnreadCount,
    refetchInterval: REFRESH_MS,
    // Quay lại tab thì hỏi ngay, khỏi đợi hết chu kỳ.
    refetchOnWindowFocus: true,
  });
  return data ?? 0;
}
