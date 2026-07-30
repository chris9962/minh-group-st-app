"use client";

import { TopBar } from "@/components/layout/TopBar";
import { SectionCard } from "@/components/ui/SectionCard";
import { ROLE_LABEL } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.css";

/** C-04 · Hồ sơ cá nhân — xem thông tin mình, không tự sửa quyền. */
export default function ProfilePage() {
  const user = useSession((s) => s.user);
  if (!user) return null;

  return (
    <>
      <TopBar title="Thông tin cá nhân" />

      <main className={styles.body}>
        <SectionCard title="Tài khoản" className={styles.card}>
          <dl className={styles.pairs}>
            <div>
              <dt>Họ tên</dt>
              <dd>{user.fullName}</dd>
            </div>
            <div>
              <dt>Tên đăng nhập</dt>
              <dd className="tabular-nums">{user.username}</dd>
            </div>
            <div>
              <dt>Chức danh</dt>
              <dd>{user.title}</dd>
            </div>
            <div>
              <dt>Chức vụ</dt>
              <dd>{ROLE_LABEL[user.role]}</dd>
            </div>
            <div>
              <dt>Số quyền được cấp</dt>
              <dd className="tabular-nums">{user.permissions.length}</dd>
            </div>
          </dl>
          <p className={styles.note}>
            Quyền do quản trị hệ thống cấp, bạn không tự sửa được. Quên mật khẩu
            thì liên hệ quản trị để được cấp lại.
          </p>
        </SectionCard>
      </main>
    </>
  );
}
