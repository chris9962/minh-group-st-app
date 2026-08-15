"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { canOpenPath } from "@/lib/nav";
import { useSession } from "@/store/session";
import { AppLoading } from "./AppLoading";
import { BottomNav } from "./BottomNav";
import { Sidebar } from "./Sidebar";
import styles from "./AppShell.module.scss";

/**
 * Khung app (C-03): sidebar trái + vùng nội dung.
 *
 * Chưa đăng nhập thì đá về /login; đăng nhập rồi mà gõ đường dẫn của một màn
 * không có trên sidebar của mình thì đá về trang chủ. Trước đây nhân viên vẫn
 * mở được `/users`: màn hiện ra đủ tiêu đề, bộ lọc và bảng rỗng, rồi mọi lời gọi
 * trả 403 — không chỗ nào nói vì sao.
 *
 * Đây là chốt chặn ở GIAO DIỆN cho tiện dùng — không phải bảo mật. Máy chủ vẫn
 * phải kiểm phiên và quyền ở mọi lời gọi (AGENTS.md §6).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useSession((s) => s.user);
  const isValid = useSession((s) => s.isValid);
  // Phiên nằm ở localStorage nên lượt render đầu luôn thấy `user` rỗng. Kết
  // luận quyền ngay lúc đó thì tải lại `/users` là bị đưa về trang chủ, dù
  // người đó có quyền — đợi `hydrated` rồi mới xét.
  const hydrated = useSession((s) => s.hydrated);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const allowed = hydrated && canOpenPath(user, pathname);

  useEffect(() => {
    if (!hydrated) return;
    if (!isValid()) {
      router.replace("/login");
      return;
    }
    if (!allowed) router.replace("/");
  }, [allowed, hydrated, isValid, router]);

  // Không dựng nội dung của màn đang bị chặn: `router.replace` chạy sau lượt
  // render này, nên vẽ ra rồi mới chuyển đi là một nhịp nhấp nháy, kèm một lượt
  // gọi mạng chắc chắn nhận 403.
  if (!user || !allowed) return <AppLoading />;

  return (
    <div className={styles.shell}>
      <Sidebar user={user} mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />

      <div className={styles.main}>{children}</div>

      <BottomNav user={user} onOpenMenu={() => setMobileNavOpen(true)} />
    </div>
  );
}
