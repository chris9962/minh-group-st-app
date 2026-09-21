import { and, asc, count, desc, eq, exists, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { GIFT_DECLINED, GIFT_NONE, GIFT_UNCHOSEN } from "@/lib/api/customers";
import type { GiftExcessQuery, GiftExcessRow } from "@/lib/api/exports";
import type { GiftSimulateResult } from "@/lib/api/settings";
import { BUSINESS_TIMEZONE } from "@/lib/format";
import { recordVisibility } from "@/lib/permissions";
import { isRealIsoDate, type User } from "@/lib/types";
import { giftFor, type GiftInput } from "@/rules";
import { customerDayText } from "./customerDay";
import { db } from "./db/client";
import { bankAccounts, banks, channels, customers, departments, giftGrants, users } from "./db/schema";
import { grantedItemLabel } from "./gift";

/**
 * P-73 báo cáo #6 · Quà cấp dư do app lỗi (chốt 2026-09-19).
 *
 * Tài khoản `error` không vào rổ quà (migration 0074), nên khách đã phát quà mà
 * sau đó app lỗi có thể đang giữ món vượt bậc. Báo cáo so ĐỢT ĐÃ PHÁT trong
 * `gift_grants` với rổ chạy lại trên tài khoản `done` hiện tại, đúng phép tính
 * của cột "QUÀ TẶNG THEO COMBO HIỆN TẠI" ở báo cáo #1.
 *
 * Chỉ lấy `error`, không lấy `fixed`: dòng chờ duyệt lại về `done` là quà hết
 * dư, đưa vào là thu oan nhân viên.
 */

/**
 * Trần ứng viên một lượt xuất. Phần dư chỉ biết sau khi chạy luật trong bộ nhớ,
 * nên trần đặt lên số khách kéo về chứ không lên số dòng ra file.
 */
const CANDIDATE_LIMIT = 20_000;

/** Ba mã không phải món thật — không có gì để dư. */
const NOT_AN_ITEM = new Set<string>([GIFT_DECLINED, GIFT_NONE, GIFT_UNCHOSEN]);

const snapshotOf = (raw: unknown): Partial<GiftSimulateResult> =>
  raw && typeof raw === "object" ? (raw as Partial<GiftSimulateResult>) : {};

export async function listGiftExcessExport(
  actor: User,
  filters: GiftExcessQuery,
): Promise<{ rows: GiftExcessRow[]; scanned: number; total: number }> {
  const visible = recordVisibility(actor, "banking", "export");
  if (visible.kind === "none") return { rows: [], scanned: 0, total: 0 };

  // Phạm vi áp lên NGƯỜI LẬP HỒ SƠ khách: quà đi theo hồ sơ, và người lập cũng
  // là người phát (chốt 2026-09-19).
  const scope =
    visible.kind === "all"
      ? undefined
      : visible.kind === "departments"
        ? visible.departmentIds.length > 0
          ? inArray(customers.createdByDepartmentId, visible.departmentIds)
          : sql`false`
        : eq(customers.createdBy, visible.userId);

  const bankCodes = filters.bankCode.split(",").map((c) => c.trim()).filter(Boolean);
  const errorAccount = alias(bankAccounts, "error_account");
  const errorBank = alias(banks, "error_bank");
  const hasError = exists(
    db
      .select({ one: sql`1` })
      .from(errorAccount)
      .innerJoin(errorBank, eq(errorBank.id, errorAccount.bankId))
      .where(
        and(
          eq(errorAccount.customerId, customers.id),
          eq(errorAccount.status, "error"),
          bankCodes.length > 0 ? inArray(errorBank.code, bankCodes) : undefined,
        ),
      ),
  );

  const where = and(
    ...([
      scope,
      hasError,
      filters.staffId ? eq(customers.createdBy, filters.staffId) : undefined,
      filters.departmentId ? eq(customers.createdByDepartmentId, filters.departmentId) : undefined,
      // Ngày sai định dạng thì bỏ qua, không trả 400 — cùng lối với `giftGrantWhere`.
      isRealIsoDate(filters.from)
        ? sql`(${giftGrants.grantedAt} at time zone ${BUSINESS_TIMEZONE})::date >= ${filters.from}::date`
        : undefined,
      isRealIsoDate(filters.to)
        ? sql`(${giftGrants.grantedAt} at time zone ${BUSINESS_TIMEZONE})::date <= ${filters.to}::date`
        : undefined,
    ].filter(Boolean) as SQL[]),
  );

  const candidates = db
    .select({
      id: customers.id,
      fullName: customers.fullName,
      idNumber: customers.idNumber,
      recordDay: customerDayText,
      channelCode: channels.code,
      departmentCode: departments.code,
      departmentName: departments.name,
      createdByName: users.fullName,
      createdByStaffCode: users.staffCode,
      grantedAt: giftGrants.grantedAt,
      cashTotal: giftGrants.cashTotal,
      chosenItem: giftGrants.chosenItem,
      extraItem: giftGrants.extraItem,
      snapshot: giftGrants.snapshot,
    })
    .from(giftGrants)
    .innerJoin(customers, eq(customers.id, giftGrants.customerId))
    // leftJoin cả ba: hồ sơ cũ nhập từ file có thể không kênh, không phòng, và
    // người lập có thể đã bị xoá khỏi hệ thống.
    .leftJoin(channels, eq(channels.id, customers.channelId))
    .leftJoin(users, eq(users.id, customers.createdBy))
    .leftJoin(departments, eq(departments.id, customers.createdByDepartmentId))
    .where(where);

  const [batch, [totals]] = await Promise.all([
    candidates.orderBy(desc(giftGrants.grantedAt), asc(giftGrants.id)).limit(CANDIDATE_LIMIT),
    db
      .select({ value: count() })
      .from(giftGrants)
      .innerJoin(customers, eq(customers.id, giftGrants.customerId))
      .where(where),
  ]);
  const total = totals?.value ?? 0;
  if (batch.length === 0) return { rows: [], scanned: 0, total };

  /**
   * Kéo tài khoản của cả lô về một lượt rồi chạy luật trong bộ nhớ, cùng lối với
   * `recountGiftCases`. `done` vào rổ, `error` ra cột "App lỗi"; hai trạng thái
   * còn lại không dùng tới.
   */
  const ids = batch.map((c) => c.id);
  const accountChannel = alias(channels, "account_channel");
  const accountRows = await db
    .select({
      id: bankAccounts.id,
      customerId: bankAccounts.customerId,
      status: bankAccounts.status,
      bankCode: banks.code,
      appInstalled: bankAccounts.appInstalled,
      accountType: bankAccounts.accountType,
      channelCode: accountChannel.code,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .leftJoin(accountChannel, eq(accountChannel.id, bankAccounts.channelId))
    .where(and(inArray(bankAccounts.customerId, ids), inArray(bankAccounts.status, ["done", "error"])));

  const doneOf = new Map<string, GiftInput["accounts"]>();
  const errorOf = new Map<string, { id: string; bankCode: string }[]>();
  const channelsOf = new Map<string, Set<string>>();
  const recordDayOf = new Map(batch.map((c) => [c.id, c.recordDay]));
  for (const row of accountRows) {
    if (row.status === "error") {
      const list = errorOf.get(row.customerId) ?? [];
      list.push({ id: row.id, bankCode: row.bankCode });
      errorOf.set(row.customerId, list);
      continue;
    }
    const list = doneOf.get(row.customerId) ?? [];
    list.push({
      customerId: row.customerId,
      bankCode: row.bankCode,
      appInstalled: row.appInstalled,
      openedDate: recordDayOf.get(row.customerId) ?? "",
      household: row.accountType,
    });
    doneOf.set(row.customerId, list);
    if (row.channelCode) {
      const set = channelsOf.get(row.customerId) ?? new Set<string>();
      set.add(row.channelCode);
      channelsOf.set(row.customerId, set);
    }
  }

  const rows: GiftExcessRow[] = [];
  for (const c of batch) {
    const codes = channelsOf.get(c.id) ?? new Set<string>();
    if (c.channelCode) codes.add(c.channelCode);
    const accounts = doneOf.get(c.id) ?? [];

    // Món đã phát vào hàm luật y như `giftForCustomer`, vì nó đổi phần tiền mặt
    // (`soloCashOf` kỳ 2026-09); rổ không đọc nó. Luật tra theo NGÀY HỒ SƠ,
    // cùng mốc với đợt phát.
    const live = giftFor(
      { accounts, channelCodes: [...codes], departmentCode: c.departmentCode, grantedItem: c.chosenItem },
      c.recordDay,
    );
    const liveMain = new Set((live?.basket ?? []).map((b) => b.code));
    const liveExtra = new Set((live?.extraBasket ?? []).map((b) => b.code));

    const mainIsItem = !NOT_AN_ITEM.has(c.chosenItem);
    const extraIsItem = Boolean(c.extraItem) && !NOT_AN_ITEM.has(c.extraItem as string);

    const excessItem = mainIsItem && !liveMain.has(c.chosenItem) ? grantedItemLabel(c.chosenItem, c.snapshot) : "";
    const excessExtra =
      extraIsItem && !liveExtra.has(c.extraItem as string)
        ? grantedItemLabel(c.extraItem as string, c.snapshot)
        : "";
    // Rổ chạy lại có thể RA NHIỀU tiền hơn (tick app sau lượt phát); phần đó
    // không phải dư, chỉ lấy chiều thiếu.
    const excessCash = Math.max(0, c.cashTotal - (live?.cashTotal ?? 0));

    if (!excessItem && !excessExtra && excessCash === 0) continue;

    const frozen = snapshotOf(c.snapshot);
    rows.push({
      customerId: c.id,
      customerName: c.fullName,
      idNumber: c.idNumber ?? "",
      errorAccounts: (errorOf.get(c.id) ?? []).sort((a, b) => a.bankCode.localeCompare(b.bankCode)),
      grantedAt: c.grantedAt.toISOString(),
      grantedItem: mainIsItem ? grantedItemLabel(c.chosenItem, c.snapshot) : "",
      grantedExtra: extraIsItem ? grantedItemLabel(c.extraItem as string, c.snapshot) : "",
      grantedCash: c.cashTotal,
      caseAtGrant: frozen.caseCode ?? "",
      caseNow: live?.caseCode ?? "",
      excessItem,
      excessExtra,
      excessCash,
      createdByName: c.createdByName ?? "",
      createdByStaffCode: c.createdByStaffCode ?? "",
      departmentName: c.departmentName ?? "",
    });
  }

  return { rows, scanned: batch.length, total };
}
