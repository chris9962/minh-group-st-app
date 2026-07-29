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
 * Phải chờ worker xong mới render: mở thẳng một trang trong app (F5 khi đang ở
 * /people) thì query bắn đi trước lúc worker kịp đăng ký, đi thẳng ra mạng và
 * ăn 404 của Next. `catch` là bắt buộc — thiếu nó thì máy nào chặn service
 * worker sẽ thấy trang trắng vĩnh viễn.
 */
function useMockApi() {
  const [ready, setReady] = useState(!USE_MOCK);

  useEffect(() => {
    if (!USE_MOCK) return;
    let cancelled = false;
    import("@/mocks/browser")
      .then(({ worker }) =>
        worker.start({ onUnhandledRequest: "bypass", quiet: true }),
      )
      .catch((e) => console.error("[mock] không bật được MSW:", e))
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const mockReady = useMockApi();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {mockReady ? children : null}
    </QueryClientProvider>
  );
}
