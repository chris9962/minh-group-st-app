"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Backend là API thật (app/api/* đọc Postgres) — MSW đã gỡ hẳn khỏi app
 * (quyết định 03/08: bỏ toàn bộ mock, làm chuẩn từ đầu). Component vẫn gọi
 * `fetch('/api/...')` như trước, chỉ là không còn ai chặn ở tầng mạng nữa.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
