import { and, eq } from "drizzle-orm";
import {
  SKIP_REASON_BANK_CODE,
  type BankSkipReason,
  type BankSkipReasonForm,
  type CustomerBankSkipReason,
} from "@/lib/api/customers";
import { recordInScope, recordVisibility } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { ageFits, ageOf } from "./age";
import { db } from "./db/client";
import { bankAccounts, bankSkipReasons, banks, customers, users } from "./db/schema";
import { imageKeyOf, imageUrl } from "./storage";

/**
 * Lý do không mở ngân hàng bắt buộc (chốt 2026-10-26), ngân hàng đó là
 * `SKIP_REASON_BANK_CODE`. Khách đủ tuổi mở mà chưa có tài khoản ngân hàng đó ở
 * hồ sơ nào thì nhân viên ghi lý do kèm ảnh. App bắt ở hai chỗ: tạo ngân hàng
 * thứ 3 của hồ sơ (`startBankAccount`) và tặng quà (`grantGift`). Mỗi hồ sơ một
 * lý do cho mỗi ngân hàng.
 *
 * Chỉ xét tuổi của ngân hàng, không xét mã giới thiệu. Chỉ tài khoản Hoàn thành
 * mới tính là đã có (chốt 2026-10-26): bản nháp tự xoá sau 60 phút, tính nháp
 * thì tạo nháp rồi tặng quà là không cần lý do. Ngân hàng được tích trong chính
 * lượt tạo thì `startBankAccount` tự bỏ qua.
 */

export type SkipReasonCustomerRef = { id: string; rootCustomerId: string; dob: string | null };

export const SKIP_REASON_BEFORE_THIRD_BANK = `Hồ sơ đủ 3 ngân hàng mà chưa có ${SKIP_REASON_BANK_CODE}. Ghi lý do không mở ${SKIP_REASON_BANK_CODE} rồi tạo tài khoản.`;
export const SKIP_REASON_BEFORE_GIFT = `Khách chưa có ${SKIP_REASON_BANK_CODE}. Ghi lý do không mở ${SKIP_REASON_BANK_CODE} rồi tặng quà.`;

async function skipReasonBank() {
  const [bank] = await db
    .select({ id: banks.id, minAge: banks.minAge, maxAge: banks.maxAge })
    .from(banks)
    .where(eq(banks.code, SKIP_REASON_BANK_CODE))
    .limit(1);
  return bank ?? null;
}

type SkipReasonBank = NonNullable<Awaited<ReturnType<typeof skipReasonBank>>>;

async function bankExpected(bank: SkipReasonBank, customer: SkipReasonCustomerRef): Promise<boolean> {
  if (!ageFits(ageOf(customer.dob), bank)) return false;
  const [owned] = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.rootCustomerId, customer.rootCustomerId),
        eq(bankAccounts.bankId, bank.id),
        eq(bankAccounts.status, "done"),
      ),
    )
    .limit(1);
  return !owned;
}

const reasonWhere = (customerId: string, bankId: string) =>
  and(eq(bankSkipReasons.customerId, customerId), eq(bankSkipReasons.bankId, bankId));

async function reasonOf(customerId: string, bankId: string): Promise<BankSkipReason | null> {
  const [row] = await db
    .select({
      note: bankSkipReasons.note,
      photoUrls: bankSkipReasons.photoUrls,
      updatedByName: users.fullName,
      updatedAt: bankSkipReasons.updatedAt,
    })
    .from(bankSkipReasons)
    .innerJoin(users, eq(users.id, bankSkipReasons.updatedBy))
    .where(reasonWhere(customerId, bankId))
    .limit(1);
  return row ? { ...row, photoUrls: row.photoUrls.map(imageUrl) } : null;
}

async function customerRef(id: string): Promise<SkipReasonCustomerRef | null> {
  const [row] = await db
    .select({ id: customers.id, rootCustomerId: customers.rootCustomerId, dob: customers.dob })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  return row ?? null;
}

/** Khách đang phải có lý do mà hồ sơ chưa ghi. */
export async function bankSkipReasonMissing(customer: SkipReasonCustomerRef): Promise<boolean> {
  const bank = await skipReasonBank();
  if (!bank || !(await bankExpected(bank, customer))) return false;
  const [row] = await db
    .select({ id: bankSkipReasons.id })
    .from(bankSkipReasons)
    .where(reasonWhere(customer.id, bank.id))
    .limit(1);
  return !row;
}

export async function bankSkipReasonMissingOf(customerId: string): Promise<boolean> {
  const customer = await customerRef(customerId);
  return customer ? bankSkipReasonMissing(customer) : false;
}

export async function bankSkipReasonState(customerId: string): Promise<CustomerBankSkipReason> {
  const [customer, bank] = await Promise.all([customerRef(customerId), skipReasonBank()]);
  if (!customer || !bank) return { needed: false, reason: null };
  const [needed, reason] = await Promise.all([bankExpected(bank, customer), reasonOf(customerId, bank.id)]);
  return { needed, reason };
}

/** Chỉ nhận khoá trong thư mục `bank-skip-reasons/`, cùng luật với ảnh VNeID. */
function photoKeysOf(urls: string[]): string[] | null {
  const keys = urls.map(imageKeyOf);
  return keys.every((key) => key?.replace(/^demo\//, "").startsWith("bank-skip-reasons/"))
    ? (keys as string[])
    : null;
}

export type SaveBankSkipReasonOutcome =
  | { ok: true; reason: BankSkipReason; fullName: string }
  | { ok: false; message: string };

/**
 * Cùng điều kiện với sửa ghi chú khách: quyền sửa hồ sơ khách theo phạm vi mức
 * dòng. `null` = không có khách đó, hoặc ngoài phạm vi.
 */
export async function saveBankSkipReason(
  actor: User,
  customerId: string,
  form: BankSkipReasonForm,
): Promise<SaveBankSkipReasonOutcome | null> {
  const [customer] = await db
    .select({
      fullName: customers.fullName,
      createdById: customers.createdBy,
      createdByDepartmentId: customers.createdByDepartmentId,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!customer || !recordInScope(recordVisibility(actor, "customer", "update"), customer)) return null;

  const bank = await skipReasonBank();
  if (!bank) return { ok: false, message: `Không tìm thấy ngân hàng ${SKIP_REASON_BANK_CODE}` };

  const photoKeys = photoKeysOf(form.photoUrls);
  if (!photoKeys) return { ok: false, message: "Ảnh không hợp lệ" };

  await db
    .insert(bankSkipReasons)
    .values({
      customerId,
      bankId: bank.id,
      note: form.note,
      photoUrls: photoKeys,
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .onConflictDoUpdate({
      target: [bankSkipReasons.customerId, bankSkipReasons.bankId],
      set: { note: form.note, photoUrls: photoKeys, updatedBy: actor.id, updatedAt: new Date() },
    });

  return { ok: true, reason: (await reasonOf(customerId, bank.id))!, fullName: customer.fullName };
}
