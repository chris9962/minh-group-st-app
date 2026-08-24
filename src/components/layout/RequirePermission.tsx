"use client";

import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import type { Action, ModuleKey, User } from "@/lib/types";
import styles from "./RequirePermission.module.scss";

type Props = {
  children: React.ReactNode;
} & (
  | { module: ModuleKey; action: Action; allow?: never }
  /**
   * Điều kiện tự viết, cho màn mà HAI quyền cùng mở được.
   *
   * Ví dụ trang ngân hàng: `manage-bank` mở nó với cả 13 ngân hàng,
   * `manage-assigned-banks` mở nó với vài ngân hàng được giao. Truyền thẳng
   * hàm từ `lib/permissions.ts` để giao diện và máy chủ hỏi CÙNG một hàm.
   */
  | { allow: (user: User | null) => boolean; module?: never; action?: never }
);

/**
 * Chặn cả MÀN khi người dùng không có quyền, thay vì để họ vào rồi bấm nút mới
 * biết.
 *
 * Vì sao cần: danh mục là dữ liệu tham chiếu nên ai đăng nhập cũng ĐỌC được
 * (quyết định 05/08) — nghĩa là màn cấu hình vẫn nạp đầy dữ liệu cho một nhân
 * viên gõ thẳng đường dẫn vào. Máy chủ vẫn chặn mọi lệnh ghi nên không mất an
 * toàn, nhưng người ta gặp một màn quản trị đầy nút bấm vào là báo lỗi.
 *
 * ⚠️ Đây là chốt chặn ở GIAO DIỆN, cho tiện dùng — KHÔNG phải phân quyền
 * (AGENTS.md §6). Điều kiện phải khớp đúng điều kiện hiện mục đó trên sidebar ở
 * `lib/nav.ts`; hai nơi lệch nhau thì menu dẫn tới một màn bị chính nó chặn.
 */
export function RequirePermission({ children, ...guard }: Props) {
  const user = useSession((s) => s.user);

  // `AppShell` đang đá về /login, đừng chớp một khối "không có quyền" ở giữa.
  if (!user) return null;

  const allowed = guard.allow ? guard.allow(user) : can(user, guard.module, guard.action);
  if (!allowed) {
    return (
      <main className={styles.denied}>
        <ShieldOff size={30} aria-hidden />
        <h1>Bạn không có quyền mở màn này</h1>
        <p>
          Màn này dành cho người được giao quản lý cấu hình. Cần dùng thì nhờ
          quản trị cấp thêm quyền.
        </p>
        <Link className="btn btn-secondary" href="/">
          Về trang chủ
        </Link>
      </main>
    );
  }

  return <>{children}</>;
}
