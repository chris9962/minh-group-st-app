import { and, asc, desc, eq, exists, inArray, ne, notExists, sql, type SQL } from "drizzle-orm";
import type { PendingSkipReason } from "@/lib/api/bankAccounts";
import type { BankSkipReason, BankSkipReasonForm, CustomerBankSkipReason } from "@/lib/api/customers";
import { BUSINESS_TIMEZONE, businessDay } from "@/lib/format";
import { recordInScope, recordVisibility } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { bankTierFor, rulePeriodStarts } from "@/rules";
import { ageFits, ageOf } from "./age";
import { customerDay } from "./customerDay";
import { db } from "./db/client";
import { bankAccounts, bankSkipReasons, banks, customers, users } from "./db/schema";
import { imageKeyOf, imageUrl } from "./storage";

/**
 * Lý do không mở bank ưu tiên (chốt 2026-10-29, thay luật riêng MB của
 * 2026-10-26). Hồ sơ cần lý do khi đủ cả ba điều kiện:
 *
 *   1. Hồ sơ có ít nhất 1 tài khoản ngân hàng.
 *   2. Khách đủ tuổi mở ít nhất 1 bank ưu tiên. Bank ưu tiên lấy theo kỳ thể lệ
 *      của ngày hồ sơ, tuổi tính tới ngày hồ sơ.
 *   3. Khách chưa có bank ưu tiên nào Hoàn thành, Lỗi hoặc Chờ duyệt lại ở mọi
 *      hồ sơ của người đó. Đang tạo tính là chưa có.
 *
 * App hỏi ở hai chỗ: tặng quà hỏi hồ sơ được tặng (`grantGift`), mở tài khoản
 * hỏi các hồ sơ KHÁC của người mở (`pendingSkipReasons`). Chỗ thứ hai có vì
 * khách nhận tiền mặt không qua bước Tặng quà.
 */

/** Ngày áp dụng luật. Lúc mở tài khoản, app chỉ quét hồ sơ tạo từ ngày này. */
const SCAN_FROM = "2026-10-30";

const OPENED_STATUSES = ["done", "error", "fixed"] as const;

export const SKIP_REASON_BEFORE_GIFT = "Khách chưa có bank ưu tiên. Ghi lý do không mở bank ưu tiên rồi tặng quà.";

type BankRow = { id: string; code: string; active: boolean; minAge: number | null; maxAge: number | null };

const allBanks = (): Promise<BankRow[]> =>
  db
    .select({ id: banks.id, code: banks.code, active: banks.active, minAge: banks.minAge, maxAge: banks.maxAge })
    .from(banks)
    .orderBy(desc(banks.priority), asc(banks.code));

const isPriority = (code: string, day: string) => bankTierFor(code, day) === "priority";

/** Mã bank ưu tiên theo ngày hồ sơ, viết thành `case` để lọc ngay trong câu SQL. */
function priorityCodesSql(codes: string[]): SQL {
  const branches = rulePeriodStarts()
    .reverse()
    .map((start) => {
      const list = codes.filter((code) => isPriority(code, start));
      return sql`when ${customerDay} >= ${start}::date then array[${sql.join(
        list.map((code) => sql`${code}`),
        sql`, `,
      )}]::text[]`;
    });
  return sql`(case ${sql.join(branches, sql` `)} else array[]::text[] end)`;
}

/**
 * Lọc điều kiện 1 và 3 trong SQL, điều kiện 2 ở JS: hồ sơ còn lại sau bước
 * SQL chỉ là hồ sơ không có bank ưu tiên, nên số dòng nhỏ.
 */
async function pendingOf(bankRows: BankRow[], where: SQL): Promise<PendingSkipReason[]> {
  const priorityCodes = priorityCodesSql(bankRows.map((b) => b.code));
  const rows = await db
    .select({ id: customers.id, fullName: customers.fullName, dob: customers.dob, createdAt: customers.createdAt })
    .from(customers)
    .where(
      and(
        where,
        notExists(
          db
            .select({ one: sql`1` })
            .from(bankAccounts)
            .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
            .where(
              and(
                eq(bankAccounts.rootCustomerId, customers.rootCustomerId),
                inArray(bankAccounts.status, [...OPENED_STATUSES]),
                sql`${banks.code} = any(${priorityCodes})`,
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(customers.createdAt));

  const profiles = rows
    .map((row) => {
      const day = businessDay(row.createdAt);
      const age = ageOf(row.dob, day);
      const bankCodes = bankRows
        .filter((b) => b.active && isPriority(b.code, day) && ageFits(age, b))
        .map((b) => b.code);
      return { ...row, day, bankCodes };
    })
    .filter((p) => p.bankCodes.length > 0);
  if (profiles.length === 0) return [];

  const drafts = await db
    .select({ id: bankAccounts.id, customerId: bankAccounts.customerId, bankCode: banks.code })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .where(
      and(
        inArray(
          bankAccounts.customerId,
          profiles.map((p) => p.id),
        ),
        eq(bankAccounts.status, "creating"),
      ),
    );

  return profiles.map((p) => ({
    customerId: p.id,
    fullName: p.fullName,
    bankCodes: p.bankCodes,
    creating: drafts
      .filter((d) => d.customerId === p.id && isPriority(d.bankCode, p.day))
      .map(({ id, bankCode }) => ({ id, bankCode })),
  }));
}

/**
 * Hồ sơ của người mở còn thiếu lý do, hồ sơ cũ trước. "Hồ sơ của người mở" là
 * hồ sơ có tài khoản do chính người đó tạo. Mọi hồ sơ của khách đang được mở
 * tài khoản không tính: nhân viên đang làm với chính khách đó.
 */
export async function pendingSkipReasons(
  actorId: string,
  current: { rootCustomerId: string },
): Promise<PendingSkipReason[]> {
  const from = sql`((${SCAN_FROM}::date)::timestamp at time zone ${BUSINESS_TIMEZONE})`;
  return pendingOf(
    await allBanks(),
    and(
      inArray(
        customers.id,
        db
          .select({ id: bankAccounts.customerId })
          .from(bankAccounts)
          .where(and(eq(bankAccounts.createdBy, actorId), sql`${bankAccounts.createdAt} >= ${from}`)),
      ),
      sql`${customers.createdAt} >= ${from}`,
      ne(customers.rootCustomerId, current.rootCustomerId),
      notExists(db.select({ one: sql`1` }).from(bankSkipReasons).where(eq(bankSkipReasons.customerId, customers.id))),
    )!,
  );
}

async function reasonOf(customerId: string): Promise<BankSkipReason | null> {
  const [row] = await db
    .select({
      note: bankSkipReasons.note,
      photoUrls: bankSkipReasons.photoUrls,
      bankCodes: sql<string[]>`array(select ${banks.code} from ${banks} where ${banks.id} = any(${bankSkipReasons.bankIds}) order by ${banks.priority} desc, ${banks.code})`,
      updatedByName: users.fullName,
      updatedAt: bankSkipReasons.updatedAt,
    })
    .from(bankSkipReasons)
    .innerJoin(users, eq(users.id, bankSkipReasons.updatedBy))
    .where(eq(bankSkipReasons.customerId, customerId))
    .limit(1);
  return row ? { ...row, photoUrls: row.photoUrls.map(imageUrl) } : null;
}

export async function bankSkipReasonState(customerId: string): Promise<CustomerBankSkipReason> {
  const [[pending], reason] = await Promise.all([
    allBanks().then((bankRows) =>
      pendingOf(
        bankRows,
        and(
          eq(customers.id, customerId),
          exists(db.select({ one: sql`1` }).from(bankAccounts).where(eq(bankAccounts.customerId, customers.id))),
        )!,
      ),
    ),
    reasonOf(customerId),
  ]);
  return {
    needed: Boolean(pending),
    bankCodes: pending?.bankCodes ?? [],
    creating: pending?.creating ?? [],
    reason,
  };
}

/** Hồ sơ đang phải có lý do mà chưa ghi. */
export async function bankSkipReasonMissingOf(customerId: string): Promise<boolean> {
  const state = await bankSkipReasonState(customerId);
  return state.needed && !state.reason;
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
 *
 * Danh sách bank do máy chủ tính lúc lưu, không nhận từ trình duyệt. Sửa lý do
 * của hồ sơ đã hết cần lý do thì giữ danh sách cũ.
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

  const photoKeys = photoKeysOf(form.photoUrls);
  if (!photoKeys) return { ok: false, message: "Ảnh không hợp lệ" };

  const state = await bankSkipReasonState(customerId);
  if (state.needed) {
    const bankIds = (await allBanks()).filter((b) => state.bankCodes.includes(b.code)).map((b) => b.id);
    await db
      .insert(bankSkipReasons)
      .values({
        customerId,
        bankIds,
        note: form.note,
        photoUrls: photoKeys,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .onConflictDoUpdate({
        target: bankSkipReasons.customerId,
        set: { bankIds, note: form.note, photoUrls: photoKeys, updatedBy: actor.id, updatedAt: new Date() },
      });
  } else if (state.reason) {
    await db
      .update(bankSkipReasons)
      .set({ note: form.note, photoUrls: photoKeys, updatedBy: actor.id, updatedAt: new Date() })
      .where(eq(bankSkipReasons.customerId, customerId));
  } else {
    return { ok: false, message: "Hồ sơ này không cần lý do không mở bank ưu tiên" };
  }

  return { ok: true, reason: (await reasonOf(customerId))!, fullName: customer.fullName };
}
