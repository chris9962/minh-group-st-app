"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ToastHost } from "@/components/ui/Toast";
import { useSession } from "@/store/session";

/**
 * Backend là API thật (app/api/* đọc Postgres) — MSW đã gỡ hẳn khỏi app
 * (quyết định 03/08: bỏ toàn bộ mock, làm chuẩn từ đầu). Component vẫn gọi
 * `fetch('/api/...')` như trước, chỉ là không còn ai chặn ở tầng mạng nữa.
 */

/**
 * Phiên chết ở máy chủ mà localStorage còn hạn thì người dùng KẸT: khung app
 * vẫn hiện, mọi panel báo "Không tải được", và không có đường nào về /login.
 * Chuyện này xảy ra thật mỗi khi admin đặt lại mật khẩu cho ai đó (thao tác đó
 * xoá hết phiên của họ), khoá tài khoản, hoặc chính họ đăng xuất ở tab khác.
 *
 * Chặn ở ĐÚNG MỘT CHỖ thay vì sửa 19 file trong `lib/api`: bọc `fetch`, thấy
 * 401 từ `/api/*` thì dọn phiên tại máy rồi đá về đăng nhập. Bỏ qua
 * `/api/login` — 401 ở đó nghĩa là sai mật khẩu, không phải phiên hết hạn.
 */
function useSignOutOn401(queryClient: QueryClient) {
  const router = useRouter();

  useEffect(() => {
    const original = window.fetch;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await original(input, init);
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (response.status === 401 && url.includes("/api/") && !url.includes("/api/login")) {
        useSession.getState().logout();
        // Dọn cả cache: máy dùng chung mà giữ lại thì người sau thấy dữ liệu
        // của người trước ngay ở lần render đầu, trước khi kịp gọi lại API.
        queryClient.clear();
        router.replace("/login");
      }
      return response;
    };

    return () => {
      window.fetch = original;
    };
  }, [queryClient, router]);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  useSignOutOn401(queryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Ở GỐC, không phải trong AppShell — màn đăng nhập nằm ngoài AppShell. */}
      <ToastHost />
    </QueryClientProvider>
  );
}
