"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/store/session";
import { Sidebar } from "./Sidebar";
import styles from "./AppShell.module.css";

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

  useEffect(() => {
    if (!isValid()) router.replace("/login");
  }, [isValid, router]);

  if (!user) return null;

  return (
    <div className={styles.shell}>
      <Sidebar user={user} />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
