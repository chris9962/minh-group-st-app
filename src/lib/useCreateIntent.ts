"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Mở hộp thoại tạo khi URL có `?create=1`, rồi gỡ query để F5 không mở lại.
 *
 * Ô tìm trên thanh trên đẩy người dùng tới đúng nút tạo sẵn có trên từng màn.
 * Nút trên trang vẫn gọi `setOpen(true)` như cũ.
 */
export function useCreateIntent(): [boolean, (open: boolean) => void] {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(() => searchParams.get("create") === "1");

  useEffect(() => {
    if (searchParams.get("create") !== "1") return;
    setOpen(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("create");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router]);

  return [open, setOpen];
}
