"use client";

import { AttendanceDayTable } from "@/components/attendance/AttendanceDayTable";
import { CheckInPanel } from "@/components/attendance/CheckInPanel";
import { TopBar } from "@/components/layout/TopBar";
import { attendanceModeOf } from "@/lib/api/attendance";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

/**
 * Chấm công: nhân viên Điểm ATM thấy 4 lượt của mình, người Phòng An Sinh thấy
 * nút điểm danh, người có quyền xem thấy bảng của phòng.
 */
export default function AttendancePage() {
  const user = useSession((s) => s.user);
  const mode = attendanceModeOf(user);

  return (
    <>
      <TopBar title="Chấm công" />
      <main className={styles.body}>
        {mode && <CheckInPanel mode={mode} />}
        {can(user, "attendance", "view-detail") && <AttendanceDayTable />}
      </main>
    </>
  );
}
