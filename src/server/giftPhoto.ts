import { and, inArray, not, sql, type SQL } from "drizzle-orm";
import { GiftPhotoFilter } from "@/lib/api/banking";
import { NON_BANK_CODES } from "@/lib/api/bankAccounts";
import { db } from "./db/client";
import { bankAccountPhotos, bankAccounts, banks } from "./db/schema";

/**
 * Tài khoản có ảnh khách nhận quà chưa, cho trường `giftPhoto` của
 * `ScoringAccount`. Câu dùng phải đọc thẳng `bank_accounts`, không đặt bí danh.
 */
export const giftPhotoSql = sql<boolean>`exists (
  select 1 from ${bankAccountPhotos} p where p.account_id = ${bankAccounts.id} and p.kind = 'gift'
)`;

/** Chỉ dòng ShopeePay có ảnh nhận quà, nên "Chưa có" phải loại các ngân hàng khác. */
export function giftPhotoFilter(raw: string): SQL | undefined {
  const parsed = GiftPhotoFilter.safeParse(raw);
  if (!parsed.success) return undefined;
  return and(
    inArray(
      bankAccounts.bankId,
      db.select({ id: banks.id }).from(banks).where(inArray(banks.code, NON_BANK_CODES)),
    ),
    parsed.data === "yes" ? giftPhotoSql : not(giftPhotoSql),
  );
}
