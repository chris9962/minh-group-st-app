import { sql } from "drizzle-orm";
import { bankAccounts, bankGuideVariants, banks, referralCodes } from "./db/schema";

/**
 * Loại tài khoản THỰC của một dòng: dòng lập trước khi có cột `account_type`
 * còn mang `none`, khi đó đọc từ mã giới thiệu — cùng luật với `accountTypeOf`
 * ở `banking.ts`. Truy vấn dùng nó phải nối `referralCodes`.
 */
export const effectiveAccountType = sql`case when ${bankAccounts.accountType} = 'none' then ${referralCodes.accountType} else ${bankAccounts.accountType} end`;

/** Điều kiện `leftJoin(bankGuideVariants, …)`: dòng riêng của đúng ngân hàng và loại. */
export const variantOfAccount = sql`${bankGuideVariants.bankId} = ${bankAccounts.bankId} and ${bankGuideVariants.accountType} = ${effectiveAccountType}`;

/**
 * "Tài khoản này đếm là một app": đã cài app VÀ loại đó của ngân hàng có đi
 * kèm app. Bản Thường đọc `banks.counts_as_app`; CNKD/HKD đọc dòng riêng ở
 * `bank_guide_variants`, chưa có dòng riêng thì KHÔNG đếm (spec §2.6).
 *
 * Bốn phép đếm "App đã cài" (Tổng quan, Phòng ban, Nhân sự) dùng chung điều
 * kiện này — đếm khác nhau ở hai màn là con số không khớp nhau mà không ai
 * biết vì sao.
 */
export const appCounted = sql`${bankAccounts.appInstalled} and case when ${effectiveAccountType} = 'none' then ${banks.countsAsApp} else coalesce(${bankGuideVariants.countsAsApp}, false) end`;

/**
 * Số app đã cài, đếm theo cặp KHÁCH GỐC và NGÂN HÀNG (chốt 2026-09-07).
 *
 * Một người ở một ngân hàng chỉ cài một app. Dòng chính và dòng HKD cùng ngân
 * hàng là hai dòng `bank_accounts` nhưng một app; đếm theo dòng thì ra 2, lệch
 * với khối APP CÀI TRÊN THIẾT BỊ của file Excel vốn gộp theo ngân hàng.
 */
export const appsInstalledCount = sql<number>`count(distinct (${bankAccounts.rootCustomerId}, ${bankAccounts.bankId})) filter (where ${appCounted})::int`;
