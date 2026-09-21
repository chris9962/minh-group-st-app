import { and, eq, sql } from "drizzle-orm";
import { monthRange } from "@/lib/format";
import { customerDayBetween, customerDayText } from "./customerDay";
import { db } from "./db/client";
import { bankAccounts, customers, employeeWorkDays, users } from "./db/schema";

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

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

  const [staff] = await tx
    .select({ role: users.role, departmentId: users.departmentId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // Chỉ vai Nhân viên tạo ngày công. TP/PT lấy ngày từ hợp của nhân viên trong
  // phòng; hoạt động trực tiếp của quản lý không tự tạo ngày cho chính họ.
  if (!staff || staff.role !== "staff" || !staff.departmentId) {
    await tx
      .delete(employeeWorkDays)
      .where(and(eq(employeeWorkDays.userId, userId), eq(employeeWorkDays.workDate, workDate)));
    return;
  }

  const [row] = await tx
    .select({
      count: sql<number>`count(distinct ${customers.id})::int`,
    })
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

  const qualifyingCustomerCount = row?.count ?? 0;
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
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [employeeWorkDays.userId, employeeWorkDays.workDate],
      set: {
        departmentId: staff.departmentId,
        qualifyingCustomerCount,
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

/** Số ngày đã ghi nhận trong một tháng, chưa áp trần trợ cấp. */
export async function employeeWorkDayCount(userId: string, yearMonth: string): Promise<number> {
  const { from, to } = monthRange(yearMonth);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
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

/**
 * So và dựng lại toàn bộ bảng ngày công. Dùng sau khi nạp dữ liệu ngoài app
 * hoặc khi nghi một lượt cập nhật hậu kỳ đã thất bại.
 */
export async function recountEmployeeWorkDays(): Promise<unknown[]> {
  const drift = await db.execute(sql`
    with expected as (
      select c.created_by user_id,
             (c.created_at at time zone 'Asia/Ho_Chi_Minh')::date work_date,
             u.department_id,
             count(distinct c.id)::int qualifying_customer_count
      from customers c
      join users u on u.id = c.created_by
      join bank_accounts a on a.customer_id = c.id and a.status = 'done'
      where u.role = 'staff' and u.department_id is not null
      group by c.created_by,
               (c.created_at at time zone 'Asia/Ho_Chi_Minh')::date,
               u.department_id
    )
    select coalesce(s.user_id, e.user_id) user_id,
           coalesce(s.work_date, e.work_date) work_date,
           s.qualifying_customer_count stored_count,
           e.qualifying_customer_count real_count
    from employee_work_days s
    full join expected e using (user_id, work_date)
    where s.user_id is null
       or e.user_id is null
       or s.department_id is distinct from e.department_id
       or s.qualifying_customer_count is distinct from e.qualifying_customer_count
    order by work_date, user_id
  `);

  await db.transaction(async (tx) => {
    await tx.delete(employeeWorkDays);
    await tx.execute(sql`
      insert into employee_work_days
        (user_id, work_date, department_id, qualifying_customer_count)
      select c.created_by,
             (c.created_at at time zone 'Asia/Ho_Chi_Minh')::date,
             u.department_id,
             count(distinct c.id)::int
      from customers c
      join users u on u.id = c.created_by
      join bank_accounts a on a.customer_id = c.id and a.status = 'done'
      where u.role = 'staff' and u.department_id is not null
      group by c.created_by,
               (c.created_at at time zone 'Asia/Ho_Chi_Minh')::date,
               u.department_id
    `);
  });

  return drift.rows;
}
