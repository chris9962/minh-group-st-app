import { eq } from "drizzle-orm";
import { businessDay } from "@/lib/format";
import { isRealIsoDate } from "@/lib/types";
import { db } from "./db/client";
import { customers } from "./db/schema";

/** Khoảng tuổi của ngân hàng, bản CNKD/HKD hay mã giới thiệu; null hai đầu = không giới hạn. */
export type AgeRule = { minAge: number | null; maxAge: number | null };

/** Tuổi tròn tới ngày làm việc Việt Nam, không tính năm sinh đơn thuần; null khi chưa có ngày sinh. */
export function ageOf(dob: string | null, at = businessDay()): number | null {
  if (!dob || !isRealIsoDate(dob) || !isRealIsoDate(at)) return null;
  const [birthYear, birthMonth, birthDay] = dob.split("-").map(Number);
  const [year, month, day] = at.split("-").map(Number);
  return year - birthYear - (month < birthMonth || (month === birthMonth && day < birthDay) ? 1 : 0);
}

/** Không biết tuổi thì mọi luật có giới hạn đều không đạt — thiếu ngày sinh không phải "đủ tuổi". */
export function ageFits(age: number | null, rule: AgeRule): boolean {
  if (rule.minAge === null && rule.maxAge === null) return true;
  return age !== null && (rule.minAge === null || age >= rule.minAge) && (rule.maxAge === null || age <= rule.maxAge);
}

export function meetsAgeRule(dob: string | null, rule: AgeRule, at = businessDay()): boolean {
  return ageFits(ageOf(dob, at), rule);
}

/** Tuổi của khách tới ngày làm việc; null khi không có khách hoặc khách chưa có ngày sinh. */
export async function customerAge(customerId: string): Promise<number | null> {
  const [customer] = await db
    .select({ dob: customers.dob })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return ageOf(customer?.dob ?? null);
}
