"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * Mặc định BẬT mock — clone về là chạy được ngay, không cần tạo file .env.
 * Tắt bằng NEXT_PUBLIC_USE_MOCK=false khi đã có backend thật.
 */
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

/**
 * Bật MSW.
 *
 * Component gọi thẳng `fetch('/api/...')` như thể backend đã có thật — MSW chặn
 * ở tầng mạng và trả lời. Ngày có backend, đặt NEXT_PUBLIC_USE_MOCK=false là
 * xong, không sửa dòng nào trong component.
 *
 * KHÔNG chặn render để chờ worker: giao diện hiện ngay, worker bật nền. Chặn ở
 * đây từng làm cả trang trắng khi service worker không chạy được. Trang đăng
 * nhập không gọi API lúc mở nên không có cuộc đua nào.
 */
function useMockApi() {
  useEffect(() => {
    if (!USE_MOCK) return;
    import("@/mocks/browser")
      .then(({ worker }) =>
        worker.start({ onUnhandledRequest: "bypass", quiet: true }),
      )
      .catch((e) => console.error("[mock] không bật được MSW:", e));
  }, []);
}

export function Providers({ children }: { children: React.ReactNode }) {
  useMockApi();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
