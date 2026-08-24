"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Đường CŨ của kho mã giới thiệu — chuyển sang `/settings/banks`, tab thứ hai.
 *
 * Hai màn gộp làm một trang hai tab ngày 2026-08-24. Giữ lại đường này vì mọi
 * link cũ trong tài liệu, tin nhắn và thẻ đánh dấu của người dùng vẫn trỏ vào
 * đây; bỏ hẳn là chúng trả 404.
 *
 * `replace` chứ không `push`: bấm Quay lại phải về đúng chỗ người dùng vừa rời,
 * không phải quay vào một trang chỉ để chuyển tiếp rồi bị đẩy đi lần nữa.
 *
 * KHÔNG gác quyền ở đây. Trang này không dựng nội dung gì, và `/settings/banks`
 * tự gác — thêm một lượt kiểm nữa chỉ làm người không có quyền thấy màn "không
 * có quyền" ở một đường dẫn mà lẽ ra họ chỉ đi ngang.
 */
export default function ReferralCodesRedirectPage() {
  const router = useRouter();

  // Điều hướng là tác dụng phụ với hệ thống bên ngoài React, đúng chỗ cho effect.
  useEffect(() => {
    router.replace("/settings/banks");
  }, [router]);

  return null;
}
