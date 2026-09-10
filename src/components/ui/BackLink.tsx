"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import styles from "./BackLink.module.scss";

type Props = {
  /** Trang mẹ. Dùng khi tab chưa có trang trước, và là đích của cmd-click. */
  href: string;
  /** Nhãn trang mẹ, ví dụ "Khách hàng". */
  children: string;
};

/**
 * Đường về của trang chi tiết. Bấm thường thì lùi một bước trong lịch sử trình
 * duyệt chứ không nhảy thẳng về trang mẹ: người dùng mở chi tiết từ nhiều nơi —
 * hồ sơ khách, danh sách đã lọc, ô tìm kiếm — và nhảy về trang mẹ bắt họ đi lại
 * từ đầu con đường đó. Sửa ảnh của một tài khoản là chuỗi bấm dài nhất.
 *
 * `history.length` là thứ duy nhất trình duyệt cho biết; nó không nói trang
 * trước nằm trong hay ngoài app. Bằng 1 nghĩa là chắc chắn không có gì để lùi
 * (mở thẳng link trong tab mới), lúc đó mới đi `href`.
 */
export function BackLink({ href, children }: Props) {
  const router = useRouter();

  const goBack = (e: MouseEvent<HTMLAnchorElement>) => {
    // Chuột giữa và cmd/ctrl/shift-click giữ nguyên nghĩa "mở trang mẹ ở tab khác".
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (window.history.length <= 1) return;
    e.preventDefault();
    router.back();
  };

  return (
    <Link href={href} className={styles.back} onClick={goBack}>
      <ChevronLeft size={15} aria-hidden />
      {children}
    </Link>
  );
}
