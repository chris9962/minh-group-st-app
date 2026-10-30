import { and, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import {
  departmentPointExclusions,
  departments,
  kpiScores,
  kpiTargets,
  staffRoster,
  users,
} from "./db/schema";

/**
 * Chỉ tiêu của ĐÚNG phòng người này, viết thẳng trong SQL.
 *
 * Cùng chuỗi rơi với `targetsFor` ở `people.ts`, chỉ khác là chạy trong database.
 * Người không thuộc phòng nào (ban giám đốc) có `department_id` null nên vế đầu
 * không khớp dòng nào và rơi thẳng xuống mốc chung — đúng như bản JS.
 */
export const targetExpr = (
  yearMonth: string,
  departmentId: AnyColumn | SQL = users.departmentId,
) => sql<number>`coalesce(
  (select t.monthly_points from ${kpiTargets} t
    where t.year_month = ${yearMonth} and t.department_id = ${departmentId}),
  (select t.monthly_points from ${kpiTargets} t
    where t.department_id is null and t.year_month <= ${yearMonth}
    order by t.year_month desc limit 1),
  100
)`;

/**
 * Luật đếm chung của thẻ "đã đạt chỉ tiêu" (màn Nhân sự & KPI) và dòng "Nhân
 * viên đạt 100 điểm" của lương PGĐ (chốt 2026-10-30). Hai chỗ cùng đọc file
 * này: đếm ở hai nơi là hai nơi sớm muộn lệch nhau.
 *
 * Câu gọi phải nối `staffRoster` và `kpiScores` của đúng tháng. File không
 * import `people.ts` hay `salary.ts` vì hai file đó import lẫn nhau.
 */

/** Nhân viên xét tổng điểm, Trưởng/Phó phòng chỉ xét điểm cài app. */
export const reachPointsExpr = (totalPoints: SQL) =>
  sql<number>`(case when ${staffRoster.role} = 'staff' then ${totalPoints}
    else coalesce(${kpiScores.bankingPoints}, 0)::float end)`;

/** Nhân viên, Trưởng, Phó phòng của phòng kinh doanh, kể cả người đã khoá; bỏ Nhân viên bị loại khỏi điểm phòng. */
export const reachMemberWhere = (yearMonth: string) =>
  and(
    inArray(staffRoster.role, ["staff", "deputy-head", "head"]),
    sql`exists (select 1 from ${departments} d where d.id = ${staffRoster.departmentId} and d.type = 'sales')`,
    sql`not (${staffRoster.role} = 'staff' and exists (select 1 from ${departmentPointExclusions} e
      where e.user_id = ${users.id} and e.year_month = ${yearMonth}))`,
  );
