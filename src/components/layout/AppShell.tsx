"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/store/session";
import { BottomNav } from "./BottomNav";
import { Sidebar } from "./Sidebar";
import styles from "./AppShell.module.scss";

/**
 * Khung app (C-03): sidebar trái + vùng nội dung.
 *
 * Chưa đăng nhập thì đá về /login. Đây là chốt chặn ở GIAO DIỆN cho tiện dùng —
 * không phải bảo mật. Máy chủ vẫn phải kiểm phiên ở mọi lời gọi.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const isValid = useSession((s) => s.isValid);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!isValid()) router.replace("/login");
  }, [isValid, router]);

  if (!user) return null;

  return (
    <div className={styles.shell}>
      <Sidebar user={user} mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />

      <div className={styles.main}>{children}</div>

      <BottomNav user={user} onOpenMenu={() => setMobileNavOpen(true)} />
    </div>
  );
}
