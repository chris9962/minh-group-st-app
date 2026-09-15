import { and, eq, exists, sql, type SQL } from "drizzle-orm";
import { BUSINESS_TIMEZONE } from "@/lib/format";
import { db } from "./db/client";
import { bankAccounts, customers } from "./db/schema";

/**
 * Ngày HỒ SƠ khách theo giờ Việt Nam — mốc duy nhất cho điểm KPI, rổ quà, chọn
 * kỳ luật, luật chặn lúc mở tài khoản và mọi phép đếm tài khoản theo kỳ (chủ dự
 * án chốt 2026-09-16).
 *
 * Trước chốt đó những thứ trên đọc `bank_accounts.opened_date`. Đổi vì mỗi hồ
 * sơ là một combo (chốt 2026-09-05), và Kế toán nói "ngày" là ngày làm việc với
 * khách chứ không phải ngày của từng tài khoản. Đo 2026-09-15 trên 41.766 tài
 * khoản: 38 dòng lệch ngày, 0 dòng lệch tháng, nên con số cũ gần như không đổi.
 * Ngày mở tài khoản giữ lại chỉ để hiện.
 *
 * Cột là `timestamptz`; so ngày phải quy về giờ làm việc trước. `customerDayBetween`
 * so trên cột gốc chứ không trên biểu thức cắt ngày, để còn dùng được chỉ mục.
 */
export const customerDay = sql<string>`(${customers.createdAt} at time zone ${BUSINESS_TIMEZONE})::date`;

export const customerDayText = sql<string>`to_char(${customers.createdAt} at time zone ${BUSINESS_TIMEZONE}, 'YYYY-MM-DD')`;

/** Hồ sơ lập trong khoảng ngày `[from, to]`, hai đầu đóng, theo giờ Việt Nam. */
export const customerDayBetween = (from: string, to: string): SQL =>
  and(
    sql`${customers.createdAt} >= ((${from}::date)::timestamp at time zone ${BUSINESS_TIMEZONE})`,
    sql`${customers.createdAt} < ((${to}::date + 1)::timestamp at time zone ${BUSINESS_TIMEZONE})`,
  ) as SQL;

/**
 * Cùng điều kiện, viết cho câu hỏi trên `bank_accounts` mà không nối bảng: câu
 * cắt trang của P-20 và các phép đếm theo kỳ chạy trên chỉ mục của
 * `bank_accounts`, nối `customers` vào trước khi cắt là hình dạng câu hỏi
 * AGENTS.md §5.2 cấm. Câu con `exists` chỉ chạy trên dòng đã lọc.
 */
export const accountCustomerDayBetween = (from: string, to: string): SQL =>
  exists(
    db
      .select({ one: sql`1` })
      .from(customers)
      .where(and(eq(customers.id, bankAccounts.customerId), customerDayBetween(from, to))),
  ) as SQL;
