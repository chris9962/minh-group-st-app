import { and, eq, inArray, sql, type SQLWrapper } from "drizzle-orm";
import type { WorkDayExportRow } from "@/lib/api/exports";
import { SOCIAL_DEPARTMENT_CODE } from "@/lib/api/staff";
import { monthRange } from "@/lib/format";
import { isMonthClosed } from "./closedMonths";
import { customerDayBetween, customerDayText } from "./customerDay";
import { db } from "./db/client";
import {
  attendanceChecks,
  bankAccounts,
  customers,
  departments,
  employeeWorkDays,
  services,
  staffRoster,
  users,
} from "./db/schema";

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Từ ngày này, nhân viên Điểm ATM và người Phòng An Sinh lấy ngày công từ chấm
 * công (spec 4.3). Lượt dịch vụ và tài khoản ngân hàng không còn tạo ngày công
 * cho hai nhóm này.
 */
export const ATTENDANCE_WORK_DAYS_FROM = "2026-10-01";

/**
 * Ngày công từ chấm công của một ngày. Phòng An Sinh: có lượt điểm danh là 1
 * ngày. Điểm ATM: đủ cặp vào ra sáng 0,5, đủ cặp vào ra chiều 0,5. `null` là
 * người không thuộc hai nhóm này.
 */
async function attendanceFraction(
  tx: Db,
  userId: string,
  workDate: string,
  staff: { role: string; salaryScheme: string; departmentCode: string | null },
): Promise<number | null> {
  const daily = staff.departmentCode === SOCIAL_DEPARTMENT_CODE;
  if (!daily && !(staff.salaryScheme === "atm" && staff.role === "staff")) return null;

  const rows = await tx
    .select({ slot: attendanceChecks.slot })
    .from(attendanceChecks)
    .where(and(eq(attendanceChecks.userId, userId), eq(attendanceChecks.workDate, workDate)));
  const has = new Set(rows.map((r) => r.slot));
  if (daily) return has.has("check-in") ? 1 : 0;
  return (
    (has.has("morning-in") && has.has("noon-out") ? 0.5 : 0) +
    (has.has("afternoon-in") && has.has("afternoon-out") ? 0.5 : 0)
  );
}

/**
 * Dựng lại đúng một ô ngày công từ dữ liệu gốc.
 *
 * Không cộng/trừ đếm theo sự kiện: một khách có nhiều tài khoản, và một tài
 * khoản có thể đi `done → error → fixed → done`. Đếm lại cả ngày làm mọi chiều
 * thay đổi đi chung một công thức, không có nhánh nào phải đoán cần +1 hay -1.
 */
async function recomputeEmployeeWorkDayOn(
  tx: Db,
  userId: string,
  workDate: string,
): Promise<void> {
  // Hai request đổi hai tài khoản của cùng người/ngày phải xếp hàng; nếu không
  // lượt đọc cũ có thể ghi đè kết quả của lượt vừa hoàn tất.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`work-day:${userId}`}), hashtext(${workDate}))`,
  );
  if (await isMonthClosed(workDate.slice(0, 7), tx)) return;

  // Chức vụ, phòng và cách tính lương của người đó TRONG tháng của ngày công.
  const [staff] = await tx
    .select({
      role: staffRoster.role,
      departmentId: staffRoster.departmentId,
      departmentCode: departments.code,
      salaryScheme: staffRoster.salaryScheme,
    })
    .from(staffRoster)
    .leftJoin(departments, eq(departments.id, staffRoster.departmentId))
    .where(and(eq(staffRoster.userId, userId), eq(staffRoster.yearMonth, workDate.slice(0, 7))))
    .limit(1);

  const fraction =
    staff?.departmentId && workDate >= ATTENDANCE_WORK_DAYS_FROM
      ? await attendanceFraction(tx, userId, workDate, staff)
      : null;
  if (fraction !== null && staff?.departmentId) {
    if (fraction === 0)
      await tx
        .delete(employeeWorkDays)
        .where(and(eq(employeeWorkDays.userId, userId), eq(employeeWorkDays.workDate, workDate)));
    else
      await tx
        .insert(employeeWorkDays)
        .values({
          userId,
          workDate,
          departmentId: staff.departmentId,
          qualifyingCustomerCount: 0,
          fraction: String(fraction),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [employeeWorkDays.userId, employeeWorkDays.workDate],
          set: {
            departmentId: staff.departmentId,
            qualifyingCustomerCount: 0,
            fraction: String(fraction),
            updatedAt: new Date(),
          },
        });
    return;
  }

  // Chỉ vai Nhân viên tạo ngày công. TP/PT lấy ngày từ hợp của nhân viên trong
  // phòng; hoạt động trực tiếp của quản lý không tự tạo ngày cho chính họ.
  if (!staff || staff.role !== "staff" || !staff.departmentId) {
    await tx
      .delete(employeeWorkDays)
      .where(and(eq(employeeWorkDays.userId, userId), eq(employeeWorkDays.workDate, workDate)));
    return;
  }

  const accountCustomers = await tx
    .selectDistinct({ id: customers.id })
    .from(customers)
    .innerJoin(
      bankAccounts,
      and(eq(bankAccounts.customerId, customers.id), eq(bankAccounts.status, "done")),
    )
    .where(
      and(
        eq(customers.createdBy, userId),
        customerDayBetween(workDate, workDate),
      ),
    );

  // Nhân viên điểm ATM: ngày có lượt dịch vụ cũng là ngày công (chốt 2026-09-30).
  const serviceCustomers =
    staff.salaryScheme === "atm"
      ? await tx
          .selectDistinct({ id: services.customerId })
          .from(services)
          .where(and(eq(services.createdBy, userId), eq(services.serviceDate, workDate)))
      : [];

  const qualifyingCustomerCount = new Set(
    [...accountCustomers, ...serviceCustomers].map((row) => row.id),
  ).size;
  if (qualifyingCustomerCount === 0) {
    await tx
      .delete(employeeWorkDays)
      .where(and(eq(employeeWorkDays.userId, userId), eq(employeeWorkDays.workDate, workDate)));
    return;
  }

  await tx
    .insert(employeeWorkDays)
    .values({
      userId,
      workDate,
      departmentId: staff.departmentId,
      qualifyingCustomerCount,
      fraction: "1",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [employeeWorkDays.userId, employeeWorkDays.workDate],
      set: {
        departmentId: staff.departmentId,
        qualifyingCustomerCount,
        fraction: "1",
        updatedAt: new Date(),
      },
    });
}

export async function recomputeEmployeeWorkDay(userId: string, workDate: string): Promise<void> {
  await db.transaction((tx) => recomputeEmployeeWorkDayOn(tx, userId, workDate));
}

/** Tính lại ngày công hiện tại của chủ hồ sơ khách. */
export async function recomputeWorkDayForCustomer(customerId: string): Promise<void> {
  const [row] = await db
    .select({ userId: customers.createdBy, workDate: customerDayText })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (row?.userId) await recomputeEmployeeWorkDay(row.userId, row.workDate);
}

/** Số ngày đã ghi nhận trong một tháng, chưa áp trần trợ cấp. Nửa ngày tính 0,5. */
export async function employeeWorkDayCount(userId: string, yearMonth: string): Promise<number> {
  const { from, to } = monthRange(yearMonth);
  const [row] = await db
    .select({ count: sql<number>`coalesce(sum(${employeeWorkDays.fraction}), 0)::float` })
    .from(employeeWorkDays)
    .where(
      and(
        eq(employeeWorkDays.userId, userId),
        sql`${employeeWorkDays.workDate} between ${from}::date and ${to}::date`,
      ),
    );
  return row?.count ?? 0;
}

/**
 * Số ngày phòng có ít nhất một nhân viên đi làm. Mỗi ngày chỉ đếm một lần dù
 * có bao nhiêu người hoặc bao nhiêu khách phát sinh trong ngày đó.
 */
export async function departmentWorkDayCount(
  departmentId: string,
  yearMonth: string,
): Promise<number> {
  const { from, to } = monthRange(yearMonth);
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${employeeWorkDays.workDate})::int` })
    .from(employeeWorkDays)
    .where(
      and(
        eq(employeeWorkDays.departmentId, departmentId),
        sql`${employeeWorkDays.workDate} between ${from}::date and ${to}::date`,
      ),
    );
  return row?.count ?? 0;
}

const ROLE_ORDER: Record<string, number> = { head: 0, "deputy-head": 1, staff: 2 };

/**
 * Báo cáo Ngày công của P-73. Người đã nghỉ chỉ có dòng khi có công trong tháng.
 *
 * Trưởng phòng và Phó phòng đọc ngày của PHÒNG, cùng cách `departmentWorkDayCount`
 * mà màn lương dùng. Đọc ngày của chính họ thì dòng luôn trống: chỉ Nhân viên
 * mới tạo ngày công. Phòng An Sinh là ngoại lệ: mọi người điểm danh, nên ai
 * cũng đọc ngày của chính mình.
 *
 * `departmentId` rỗng là mọi phòng; có thì chỉ lấy người thuộc phòng đó TRONG
 * tháng xuất.
 */
export async function listWorkDayExport(
  yearMonth: string,
  departmentId = "",
): Promise<WorkDayExportRow[]> {
  const { from, to } = monthRange(yearMonth);
  const [people, dayRows] = await Promise.all([
    // Phòng, chức vụ và trạng thái của từng người TRONG tháng xuất.
    db
      .select({
        id: users.id,
        fullName: users.fullName,
        role: staffRoster.role,
        active: staffRoster.active,
        departmentId: staffRoster.departmentId,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(users)
      .innerJoin(
        staffRoster,
        and(eq(staffRoster.userId, users.id), eq(staffRoster.yearMonth, yearMonth)),
      )
      .leftJoin(departments, eq(departments.id, staffRoster.departmentId))
      .where(
        and(
          inArray(staffRoster.role, ["staff", "head", "deputy-head"]),
          departmentId ? eq(staffRoster.departmentId, departmentId) : undefined,
        ),
      ),
    db
      .select({
        userId: employeeWorkDays.userId,
        departmentId: employeeWorkDays.departmentId,
        workDate: employeeWorkDays.workDate,
        fraction: employeeWorkDays.fraction,
      })
      .from(employeeWorkDays)
      .where(sql`${employeeWorkDays.workDate} between ${from}::date and ${to}::date`),
  ]);

  const byUser = new Map<string, Map<number, number>>();
  const byDepartment = new Map<string, Map<number, number>>();
  const mark = (map: Map<string, Map<number, number>>, key: string, day: number, fraction: number) => {
    const kept = map.get(key) ?? new Map<number, number>();
    kept.set(day, fraction);
    map.set(key, kept);
  };
  for (const row of dayRows) {
    const day = Number(row.workDate.slice(8, 10));
    mark(byUser, row.userId, day, Number(row.fraction));
    // Ngày của phòng là ngày có người đi làm, nửa ngày cũng tính cả ngày như `departmentWorkDayCount`.
    mark(byDepartment, row.departmentId, day, 1);
  }

  return people
    .map((p) => {
      const own =
        p.role === "staff" ||
        (p.departmentCode === SOCIAL_DEPARTMENT_CODE && yearMonth >= ATTENDANCE_WORK_DAYS_FROM.slice(0, 7));
      const days = (own ? byUser.get(p.id) : byDepartment.get(p.departmentId ?? "")) ?? new Map();
      return {
        ...p,
        days: [...days].map(([day, fraction]) => ({ day, fraction })).sort((a, b) => a.day - b.day),
      };
    })
    .filter((p) => p.active || p.days.length > 0)
    .sort(
      (a, b) =>
        Number(!a.departmentName) - Number(!b.departmentName) ||
        (a.departmentName ?? "").localeCompare(b.departmentName ?? "", "vi") ||
        ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
        a.fullName.localeCompare(b.fullName, "vi"),
    )
    .map((p) => ({ fullName: p.fullName, departmentName: p.departmentName ?? "", days: p.days }));
}

/** Ngày thuộc tháng chưa chốt lương. Ngày công của tháng đã chốt đứng yên. */
const openMonth = (day: SQLWrapper) =>
  sql`to_char(${day}, 'YYYY-MM') not in (select year_month from salary_closings)`;

/**
 * So và dựng lại bảng ngày công của các tháng chưa chốt lương. Dùng sau khi nạp
 * dữ liệu ngoài app hoặc khi nghi một lượt cập nhật hậu kỳ đã thất bại.
 *
 * `fromMonth` giới hạn từ tháng đó trở đi: deploy luật chấm công (2026-10) chỉ
 * dựng lại tháng 10, không đụng tháng 9 chưa chốt. `apply: false` chỉ trả dòng
 * lệch, không ghi.
 */
export async function recountEmployeeWorkDays(
  { fromMonth = "", apply = true }: { fromMonth?: string; apply?: boolean } = {},
): Promise<unknown[]> {
  const inScope = (day: SQLWrapper) =>
    fromMonth ? sql`${openMonth(day)} and to_char(${day}, 'YYYY-MM') >= ${fromMonth}` : openMonth(day);
  // Cùng điều kiện với `recomputeEmployeeWorkDayOn`: chức vụ, phòng và cách tính
  // lương đọc theo nhân sự của tháng chứa ngày công. Vế đầu là ngày công theo
  // khách, vế sau là ngày công theo chấm công từ `ATTENDANCE_WORK_DAYS_FROM`.
  const attendanceGroup = sql`(
    r.department_id is not null and d.work_date >= ${ATTENDANCE_WORK_DAYS_FROM}::date
    and (dep.code = ${SOCIAL_DEPARTMENT_CODE} or (r.salary_scheme = 'atm' and r.role = 'staff'))
  )`;
  const expected = sql`
    select d.user_id, d.work_date, r.department_id,
           count(distinct d.customer_id)::int qualifying_customer_count,
           1::numeric fraction
    from (
      select c.created_by user_id,
             (c.created_at at time zone 'Asia/Ho_Chi_Minh')::date work_date,
             c.id customer_id,
             false from_service
      from customers c
      join bank_accounts a on a.customer_id = c.id and a.status = 'done'
      union
      select s.created_by, s.service_date, s.customer_id, true
      from services s
    ) d
    join staff_roster r
      on r.user_id = d.user_id and r.year_month = to_char(d.work_date, 'YYYY-MM')
    left join departments dep on dep.id = r.department_id
    where r.role = 'staff' and r.department_id is not null
      and (not d.from_service or r.salary_scheme = 'atm')
      and not ${attendanceGroup}
      and ${inScope(sql`d.work_date`)}
    group by d.user_id, d.work_date, r.department_id
    union all
    select d.user_id, d.work_date, r.department_id, 0,
           case when dep.code = ${SOCIAL_DEPARTMENT_CODE}
                then 1
                else 0.5 * (d.morning::int) + 0.5 * (d.afternoon::int) end::numeric
    from (
      select user_id, work_date,
             bool_or(slot = 'check-in') check_in,
             bool_or(slot = 'morning-in') and bool_or(slot = 'noon-out') morning,
             bool_or(slot = 'afternoon-in') and bool_or(slot = 'afternoon-out') afternoon
      from attendance_checks
      group by user_id, work_date
    ) d
    join staff_roster r
      on r.user_id = d.user_id and r.year_month = to_char(d.work_date, 'YYYY-MM')
    left join departments dep on dep.id = r.department_id
    where ${attendanceGroup}
      and (case when dep.code = ${SOCIAL_DEPARTMENT_CODE} then d.check_in else d.morning or d.afternoon end)
      and ${inScope(sql`d.work_date`)}
  `;

  const drift = await db.execute(sql`
    with expected as (${expected})
    select coalesce(s.user_id, e.user_id) user_id,
           coalesce(s.work_date, e.work_date) work_date,
           s.qualifying_customer_count stored_count,
           e.qualifying_customer_count real_count,
           s.fraction stored_fraction,
           e.fraction real_fraction
    from (select * from employee_work_days where ${inScope(sql`work_date`)}) s
    full join expected e using (user_id, work_date)
    where s.user_id is null
       or e.user_id is null
       or s.department_id is distinct from e.department_id
       or s.qualifying_customer_count is distinct from e.qualifying_customer_count
       or s.fraction is distinct from e.fraction
    order by work_date, user_id
  `);

  if (!apply) return drift.rows;
  await db.transaction(async (tx) => {
    await tx.delete(employeeWorkDays).where(inScope(employeeWorkDays.workDate));
    await tx.execute(sql`
      insert into employee_work_days
        (user_id, work_date, department_id, qualifying_customer_count, fraction)
      ${expected}
    `);
  });

  return drift.rows;
}
