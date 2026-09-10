"use client";

import { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { ChangePasswordDialog } from "@/components/profile/ChangePasswordDialog";
import { NotificationSettings } from "@/components/profile/NotificationSettings";
import { SettingsAction, SettingsGroup, SettingsRow } from "@/components/ui/SettingsList";
import { ROLE_LABEL } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.css";

/**
 * C-04 · Hồ sơ cá nhân — xem thông tin mình và đổi cài đặt của riêng mình.
 *
 * Dựng bằng `SettingsGroup` thay cho `SectionCard`: màn này toàn dòng nhãn cộng
 * giá trị hoặc nhãn cộng công tắc, không có nội dung tự do nào. Danh sách dòng
 * đọc nhanh hơn trên điện thoại, và mỗi dòng cao 44px cho ngón tay.
 *
 * Người dùng KHÔNG tự sửa quyền ở đây. Quyền nằm ở P-92, do quản trị cấp.
 */
export default function ProfilePage() {
  const user = useSession((s) => s.user);
  const [changingPassword, setChangingPassword] = useState(false);
  if (!user) return null;

  return (
    <>
      <TopBar title="Cá nhân" keepTitleOnMobile />

      <main className={styles.body}>
        <div className={styles.column}>
          <SettingsGroup title="Thông tin cá nhân">
            <SettingsRow label="Họ tên" value={user.fullName} />
            <SettingsRow
              label="Tên đăng nhập"
              value={<span className="tabular-nums">{user.username}</span>}
            />
            <SettingsRow label="Chức danh" value={user.title} />
            <SettingsRow label="Chức vụ" value={ROLE_LABEL[user.role]} />
          </SettingsGroup>

          <NotificationSettings />

          <SettingsGroup title="Bảo mật">
            <SettingsAction label="Đổi mật khẩu" onClick={() => setChangingPassword(true)} />
          </SettingsGroup>
        </div>

        {/* Chỉ dựng khi mở: form giữ state trong `useForm`, tháo hẳn thì lần mở
            sau bắt đầu từ ba ô rỗng mà không cần gọi `reset`. */}
        {changingPassword && (
          <ChangePasswordDialog open onClose={() => setChangingPassword(false)} />
        )}
      </main>
    </>
  );
}
