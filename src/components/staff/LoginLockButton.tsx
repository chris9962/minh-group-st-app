"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { clearLoginLock, fetchLoginLock } from "@/lib/api/loginLock";
import { errorMessage, toast } from "@/lib/toast";

const clock = (ms: number): string => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/**
 * Nút mở khoá đăng nhập, kèm đồng hồ đếm ngược tới lúc tự hết khoá.
 *
 * Chỉ hiện khi người này đang bị khoá vì sai mật khẩu 5 lần. Hết giờ thì nút tự
 * biến mất, không cần tải lại.
 */
export function LoginLockButton({ staffId }: { staffId: string }) {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());

  const { data } = useQuery({
    queryKey: ["login-lock", staffId],
    queryFn: () => fetchLoginLock(staffId),
  });

  const until = data?.lockedUntil ? new Date(data.lockedUntil).getTime() : 0;

  // Đồng hồ là hệ thống bên ngoài React: chỉ chạy khi đang có mốc khoá.
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);

  const unlock = useMutation({
    mutationFn: () => clearLoginLock(staffId),
    onSuccess: (lock) => {
      queryClient.setQueryData(["login-lock", staffId], lock);
      toast.ok("Đã mở khoá đăng nhập");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không mở khoá đăng nhập được. Thử lại.")),
  });

  const left = until - now;
  if (left <= 0) return null;

  return (
    <Button variant="secondary" onClick={() => unlock.mutate()} disabled={unlock.isPending}>
      Mở khoá đăng nhập (còn <span className="tabular-nums">{clock(left)}</span>)
    </Button>
  );
}
