"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Mở hộp thoại tạo khi URL có `?create=…`, rồi gỡ query để F5 không mở lại.
 *
 * Ô tìm và nút + thanh đáy đẩy người dùng tới đúng nút tạo sẵn có trên từng
 * màn. Nút trên trang vẫn gọi `setOpen(true)` như cũ.
 *
 * `kind` là giá trị `create` để mở hộp NÀY. Mặc định `"1"`. Màn hai hộp
 * (P-60 ngân hàng / mã) dùng `"bank"` và `"code"` để không mở nhầm hộp kia.
 */
export function useCreateIntent(kind = "1"): [boolean, (open: boolean) => void] {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(() => searchParams.get("create") === kind);

  useEffect(() => {
    if (searchParams.get("create") !== kind) return;
    setOpen(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("create");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [kind, searchParams, pathname, router]);

  return [open, setOpen];
}
