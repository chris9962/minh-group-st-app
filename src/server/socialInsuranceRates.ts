import { desc, inArray, lte } from "drizzle-orm";
import type { SocialInsuranceKind, SocialInsurancePlan } from "@/lib/api/socialInsurance";
import { db } from "./db/client";
import { socialInsuranceRates } from "./db/schema";

type Conn = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Rate = { receiveRate: number; payRate: number };

/** Bộ % của một tháng. `yearMonth` là tháng có dòng thật, `null` = chưa cấu hình tháng nào. */
export type RateBook = {
  yearMonth: string | null;
  get: (kind: SocialInsuranceKind, plan: SocialInsurancePlan, months: number) => Rate | null;
};

/** Tái tục có một mức cho mọi số tháng, lưu ở `months = 0`. */
const keyOf = (kind: SocialInsuranceKind, plan: SocialInsurancePlan, months: number) =>
  `${kind}|${plan}|${plan === "renewal" ? 0 : months}`;

/**
 * Bộ % cho từng tháng cần dùng. Tháng không có dòng nào thì dùng bộ của tháng
 * gần nhất trước đó, cùng cách trọng số dịch vụ (`service_type_months`).
 */
export async function rateBooksFor(months: string[], conn: Conn = db): Promise<Map<string, RateBook>> {
  const books = new Map<string, RateBook>();
  const effectiveOf = new Map<string, string | null>();
  for (const month of new Set(months)) {
    const [row] = await conn
      .select({ yearMonth: socialInsuranceRates.yearMonth })
      .from(socialInsuranceRates)
      .where(lte(socialInsuranceRates.yearMonth, month))
      .orderBy(desc(socialInsuranceRates.yearMonth))
      .limit(1);
    effectiveOf.set(month, row?.yearMonth ?? null);
  }

  const effective = [...new Set([...effectiveOf.values()].filter((m): m is string => m !== null))];
  const rows = effective.length
    ? await conn.select().from(socialInsuranceRates).where(inArray(socialInsuranceRates.yearMonth, effective))
    : [];

  for (const [month, yearMonth] of effectiveOf) {
    const rates = new Map(
      rows
        .filter((r) => r.yearMonth === yearMonth)
        .map((r) => [keyOf(r.kind, r.plan, r.months), { receiveRate: r.receiveRate, payRate: r.payRate }]),
    );
    books.set(month, {
      yearMonth,
      get: (kind, plan, count) => rates.get(keyOf(kind, plan, count)) ?? null,
    });
  }
  return books;
}
