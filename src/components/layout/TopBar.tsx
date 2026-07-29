"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useSession } from "@/store/session";
import styles from "./TopBar.module.css";

type Props = {
  title: string;
  /** Thanh chọn phạm vi, bộ lọc… tuỳ từng trang. */
  children?: React.ReactNode;
};

export function TopBar({ title, children }: Props) {
  const router = useRouter();
  const logout = useSession((s) => s.logout);

  return (
    <header className={styles.bar}>
      <h1 className={styles.title}>{title}</h1>
      <div className={styles.tools}>{children}</div>
      <Button
        variant="ghost"
        onClick={() => {
          logout();
          router.replace("/login");
        }}
      >
        Đăng xuất
      </Button>
    </header>
  );
}
