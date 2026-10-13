"use client";

import { AttendanceDayTable } from "@/components/attendance/AttendanceDayTable";
import { CheckInPanel } from "@/components/attendance/CheckInPanel";
import { TopBar } from "@/components/layout/TopBar";
import { attendanceModeOf } from "@/lib/api/attendance";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

/**
 * Chấm công: người của phòng có bật chấm công thấy các lượt của mình theo cách
 * chấm của phòng, người có quyền xem thấy bảng theo phòng.
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
