import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { MAX_BANK_ACCOUNTS_PER_CUSTOMER } from "@/lib/api/bankAccounts";
import type { CustomerLookupResult } from "@/lib/api/customers";
import { businessDay } from "@/lib/format";
import type { User } from "@/lib/types";
import { openBlockReasonAt } from "@/rules";
import { slotConflict, slotConflictMessage } from "./banking";
import { closedMonthAmong, closedMonthMessage } from "./closedMonths";
import { lookupCustomers } from "./customers";
import { db } from "./db/client";
import {
  bankAccounts,
  banks,
  customers,
  giftGrants,
  insuranceOrders,
  services,
  users,
  vneidRecords,
} from "./db/schema";
import { recomputeGiftCase } from "./gift";
import { recomputeKpi, recomputeKpiForCustomer } from "./kpi";
import { enqueuePhotoCheck } from "./photoCheck";
import { recomputeEmployeeWorkDay } from "./workDays";

type Outcome<T> = { ok: true; value: T } | { ok: false; message: string } | null;

/**
 * Chuyển hồ sơ khách sang nhân viên khác CÙNG PHÒNG.
 *
 * Đổi `created_by` trên hồ sơ và trên mọi bản ghi nghiệp vụ của hồ sơ: điểm KPI
 * ngân hàng đi theo người lập hồ sơ, còn phạm vi xem của màn danh sách đọc người
 * tạo bản ghi. Đổi một nửa thì người nhận có điểm mà không thấy tài khoản.
 *
 * Dịch vụ là ngoại lệ: chỉ chuyển dịch vụ do người tạo cũ làm. Dịch vụ người
 * khác ghi cho khách này vẫn là công của người đó (chủ dự án chốt 2026-10-03).
 *
 * Cùng phòng nên rổ quà Phòng Y không đổi.
 */
export async function transferCustomerOwner(
  customerId: string,
  toUserId: string,
): Promise<Outcome<{ customerName: string; fromName: string; toName: string }>> {
  const [customer] = await db
    .select({
      fullName: customers.fullName,
      ownerId: customers.createdBy,
      departmentId: customers.createdByDepartmentId,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .where(eq(customers.id, customerId));
  if (!customer) return null;

  const [receiver] = await db
    .select({ fullName: users.fullName, departmentId: users.departmentId, active: users.active })
    .from(users)
    .where(eq(users.id, toUserId));
  if (!receiver || !receiver.active) return { ok: false, message: "Nhân viên nhận không còn làm việc." };
  if (customer.ownerId === toUserId) return { ok: false, message: "Hồ sơ này đã thuộc nhân viên đó." };
  if (!customer.departmentId || receiver.departmentId !== customer.departmentId)
    return { ok: false, message: "Chỉ đổi được sang nhân viên cùng phòng với hồ sơ." };

  const [previousOwner] = customer.ownerId
    ? await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, customer.ownerId))
    : [];

  // Lượt nhập liệu BHYT/BHXH đi theo cột NHẬP LIỆU của dòng đó, không theo chủ hồ sơ.
  const ownServices = customer.ownerId
    ? and(
        eq(services.customerId, customerId),
        eq(services.createdBy, customer.ownerId),
        sql`not exists (select 1 from social_insurance_records sir where sir.service_id = ${services.id})`,
      )
    : sql`false`;

  // Điểm dịch vụ tính theo ngày làm dịch vụ, không theo ngày hồ sơ, nên tháng của từng lượt dịch vụ cũng phải tính lại.
  const customerDay = businessDay(customer.createdAt);
  const serviceDays = await db.selectDistinct({ day: services.serviceDate }).from(services).where(ownServices);
  const days = [...new Set([customerDay, ...serviceDays.map((s) => s.day)])];
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];

  const closed = await closedMonthAmong(months);
  if (closed) return { ok: false, message: closedMonthMessage(closed) };

  await db.transaction(async (tx) => {
    const receiverOwns = { createdBy: toUserId, createdByDepartmentId: customer.departmentId };
    await tx.update(customers).set({ createdBy: toUserId }).where(eq(customers.id, customerId));
    await tx.update(bankAccounts).set(receiverOwns).where(eq(bankAccounts.customerId, customerId));
    await tx.update(insuranceOrders).set(receiverOwns).where(eq(insuranceOrders.customerId, customerId));
    await tx.update(services).set(receiverOwns).where(ownServices);
    await tx.update(vneidRecords).set(receiverOwns).where(eq(vneidRecords.customerId, customerId));
  });

  await recomputeGiftCase(customerId);
  const people = [customer.ownerId, toUserId].filter((v): v is string => Boolean(v));
  for (const userId of people) {
    for (const month of months) await recomputeKpi(userId, month);
    for (const day of days) await recomputeEmployeeWorkDay(userId, day);
  }

  return {
    ok: true,
    value: {
      customerName: customer.fullName,
      fromName: previousOwner?.fullName ?? "",
      toName: receiver.fullName,
    },
  };
}

/** Hồ sơ nhận được tài khoản này: cùng người tạo với hồ sơ đang giữ nó. */
export async function moveTargets(
  actor: User,
  accountId: string,
  search: string,
): Promise<CustomerLookupResult | null> {
  const [row] = await db
    .select({
      customerId: customers.id,
      ownerId: customers.createdBy,
      accountType: bankAccounts.accountType,
    })
    .from(bankAccounts)
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .where(eq(bankAccounts.id, accountId));
  if (!row) return null;
  if (!row.ownerId) return { rows: [], hiddenBankFull: 0 };
  return lookupCustomers(actor, search, {
    ownerId: row.ownerId,
    excludeId: row.customerId,
    // Dòng HKD không chiếm trần 3 tài khoản chính, nên hồ sơ đã đủ trần vẫn nhận được.
    forBankAccount: row.accountType !== "HKD",
  });
}

/**
 * Chuyển một tài khoản ngân hàng sang hồ sơ khách khác của CÙNG người tạo.
 *
 * Hồ sơ nguồn phải chưa phát quà: rổ đã phát đóng băng trong `gift_grants`, bớt
 * tài khoản khỏi hồ sơ đó là khách giữ quà của tổ hợp không còn. Hồ sơ nhận đã
 * phát quà thì giữ nguyên quà (chủ dự án chốt 2026-10-03).
 */
export async function moveBankAccount(
  accountId: string,
  toCustomerId: string,
): Promise<Outcome<{ bankCode: string; fromName: string; toName: string }>> {
  const [account] = await db
    .select({
      customerId: bankAccounts.customerId,
      bankId: bankAccounts.bankId,
      accountType: bankAccounts.accountType,
      bankCode: banks.code,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .where(eq(bankAccounts.id, accountId));
  if (!account) return null;
  if (account.customerId === toCustomerId)
    return { ok: false, message: "Tài khoản đã thuộc hồ sơ khách này." };

  const pair = await db
    .select({
      id: customers.id,
      fullName: customers.fullName,
      ownerId: customers.createdBy,
      rootId: customers.rootCustomerId,
      channelId: customers.channelId,
      channelDetail: customers.channelDetail,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .where(inArray(customers.id, [account.customerId, toCustomerId]));
  const source = pair.find((c) => c.id === account.customerId);
  const target = pair.find((c) => c.id === toCustomerId);
  if (!source || !target) return { ok: false, message: "Không tìm thấy hồ sơ khách nhận." };
  if (!source.ownerId || source.ownerId !== target.ownerId)
    return { ok: false, message: "Hai hồ sơ phải cùng người tạo." };

  const sourceDay = businessDay(source.createdAt);
  const targetDay = businessDay(target.createdAt);
  const closed = await closedMonthAmong([sourceDay.slice(0, 7), targetDay.slice(0, 7)]);
  if (closed) return { ok: false, message: closedMonthMessage(closed) };

  const result = await db.transaction(async (tx) => {
    // Khoá dòng tài khoản TRƯỚC hai hồ sơ, cùng thứ tự với đường đổi trạng thái: trigger đếm tài khoản khoá hồ sơ sau dòng tài khoản.
    const locked = await tx.execute<{ customer_id: string }>(
      sql`select customer_id from ${bankAccounts} where id = ${accountId} for update`,
    );
    if (locked.rows[0]?.customer_id !== source.id)
      return { ok: false as const, message: "Tài khoản vừa được đổi sang khách khác. Tải lại trang rồi thử lại." };
    await tx.execute(
      sql`select id from ${customers} where id in (${source.id}, ${target.id}) order by id for update`,
    );

    const [gift] = await tx
      .select({ id: giftGrants.id })
      .from(giftGrants)
      .where(eq(giftGrants.customerId, source.id))
      .limit(1);
    if (gift)
      return { ok: false as const, message: `Khách ${source.fullName} đã nhận quà, không đổi tài khoản sang khách khác được.` };

    // Bỏ chính tài khoản đang chuyển: hai hồ sơ cùng một khách thì nó nằm trong cùng root.
    const ownedByPerson = await tx
      .select({ bankId: bankAccounts.bankId, accountType: bankAccounts.accountType })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.rootCustomerId, target.rootId), ne(bankAccounts.id, accountId)));
    const conflict = slotConflict(ownedByPerson, account);
    if (conflict)
      return { ok: false as const, message: slotConflictMessage(conflict, account.bankCode, account.accountType === "HKD") };

    if (account.accountType !== "HKD") {
      const mainCodesHere = (
        await tx
          .select({ code: banks.code })
          .from(bankAccounts)
          .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
          .where(and(eq(bankAccounts.customerId, target.id), sql`${bankAccounts.accountType} <> 'HKD'`))
      ).map((r) => r.code);
      if (mainCodesHere.length >= MAX_BANK_ACCOUNTS_PER_CUSTOMER)
        return {
          ok: false as const,
          message: `Hồ sơ ${target.fullName} đã đủ ${MAX_BANK_ACCOUNTS_PER_CUSTOMER} tài khoản ngân hàng.`,
        };
      const reason = openBlockReasonAt(mainCodesHere, account.bankCode, targetDay);
      if (reason) return { ok: false as const, message: `${account.bankCode}: ${reason}` };
    }

    // Kênh trên tài khoản là bản chụp kênh của hồ sơ lúc mở, rổ quà đọc nó. Giữ kênh khách cũ là tính quà sai kênh.
    await tx
      .update(bankAccounts)
      .set({
        customerId: target.id,
        rootCustomerId: target.rootId,
        channelId: target.channelId,
        channelDetail: target.channelDetail,
      })
      .where(eq(bankAccounts.id, accountId));
    // Lượt kiểm ảnh cũ so với tên và số của khách nguồn.
    await enqueuePhotoCheck(tx, accountId);
    return { ok: true as const };
  });
  if (!result.ok) return result;

  await recomputeGiftCase(source.id);
  await recomputeGiftCase(target.id);
  await recomputeKpiForCustomer(source.id);
  await recomputeKpiForCustomer(target.id);

  return { ok: true, value: { bankCode: account.bankCode, fromName: source.fullName, toName: target.fullName } };
}
