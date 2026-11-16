import { sql } from "drizzle-orm";
import { bankAccountPhotos, bankAccounts } from "./db/schema";

/**
 * Tài khoản có ảnh khách nhận quà chưa, cho trường `giftPhoto` của
 * `ScoringAccount`. Câu dùng phải đọc thẳng `bank_accounts`, không đặt bí danh.
 */
export const giftPhotoSql = sql<boolean>`exists (
  select 1 from ${bankAccountPhotos} p where p.account_id = ${bankAccounts.id} and p.kind = 'gift'
)`;
