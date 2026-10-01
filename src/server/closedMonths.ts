import { eq, inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { BUSINESS_TIMEZONE } from "@/lib/format";
import { db } from "./db/client";
import { bankAccounts, customers, salaryClosings } from "./db/schema";

/**
 * Khoá dữ liệu của tháng đã chốt lương (chủ dự án chốt 2026-10-01): số đã chốt
 * là số đã trả, nên lượt dịch vụ, trạng thái tài khoản ngân hàng, kiểm ảnh,
 * điểm KPI và ngày công của tháng đó đứng yên.
 */

type Conn = Pick<typeof db, "select">;

/** Tháng đã chốt lương đầu tiên trong `months`; `null` khi mọi tháng còn mở. */
export async function closedMonthAmong(months: string[], conn: Conn = db): Promise<string | null> {
  const unique = [...new Set(months)];
  if (unique.length === 0) return null;
  const rows = await conn
    .select({ yearMonth: salaryClosings.yearMonth })
    .from(salaryClosings)
    .where(inArray(salaryClosings.yearMonth, unique));
  return rows.map((r) => r.yearMonth).sort()[0] ?? null;
}

export const isMonthClosed = async (yearMonth: string, conn: Conn = db): Promise<boolean> =>
  (await closedMonthAmong([yearMonth], conn)) !== null;

/** Tháng của hồ sơ khách (mốc điểm KPI, xem `customerDay.ts`) nếu tháng đó đã chốt lương. */
export async function closedMonthOfCustomer(customerId: string): Promise<string | null> {
  const [row] = await db
    .select({ yearMonth: salaryClosings.yearMonth })
    .from(customers)
    .innerJoin(
      salaryClosings,
      eq(
        salaryClosings.yearMonth,
        sql`to_char(${customers.createdAt} at time zone ${BUSINESS_TIMEZONE}, 'YYYY-MM')`,
      ),
    )
    .where(eq(customers.id, customerId))
    .limit(1);
  return row?.yearMonth ?? null;
}

/**
 * Điều kiện SQL: tài khoản `accountId` thuộc hồ sơ khách của tháng đã chốt lương.
 * Bảng trong câu con mang bí danh, nên câu ngoài đọc `bank_accounts` vẫn nối đúng cột của mình.
 */
export const accountInClosedMonth = (accountId: SQLWrapper): SQL<boolean> => sql<boolean>`exists (
  select 1
  from ${bankAccounts} a
  join ${customers} c on c.id = a.customer_id
  join ${salaryClosings} s
    on s.year_month = to_char(c.created_at at time zone ${BUSINESS_TIMEZONE}, 'YYYY-MM')
  where a.id = ${accountId}
)`;

export function closedMonthMessage(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return `Lương tháng ${month}/${year} đã chốt, không sửa được dữ liệu của tháng này.`;
}
