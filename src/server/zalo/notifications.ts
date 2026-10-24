import { asc, desc, sql } from "drizzle-orm";
import {
  notificationPeople,
  notificationTakesGroups,
  ZALO_CERT_OVERDUE_MINUTES,
  ZALO_PGD_REPORT_AT,
  type ZaloNotificationKind,
} from "@/lib/api/zaloBot";
import { businessDay, clockNowVn, isValidPhone } from "@/lib/format";
import { db } from "../db/client";
import { pviCancelRuns, zaloNotificationLog } from "../db/schema";
import {
  enqueueZaloGroupText,
  enqueueZaloPhoneText,
  routedZaloGroupIds,
  routedZaloPgds,
} from "../zaloBot";
import { pgdDailyReport, pgdDailyReportMessages } from "./pgdDailyReport";
import { pviCancelReportMessages } from "./pviCancelReport";

/** Một tin cần gửi. Có `phone` thì gửi riêng tới số đó, không thì gửi vào các nhóm của loại. */
export type ZaloNotice = { body: string; phone?: string };

/**
 * Điều kiện và nội dung tin của từng loại thông báo Zalo. Worker gọi mỗi phút,
 * chỉ với loại đang có nơi nhận.
 *
 * Mỗi sự việc báo đúng một lần: khoá của nó vào `zalo_notification_log` trước
 * khi tin đi. Mọi sự việc mới của một lượt gộp vào MỘT tin, vì 20 đơn quá hạn
 * cùng lúc thành 20 tin liên tiếp là làm ngập nhóm.
 */

/** Trần số dòng trong một tin. Phần dư chỉ ghi số lượng. */
const MAX_LINES = 20;

/** Ghi khoá vào sổ, trả các khoá CHƯA từng ghi. */
async function claimKeys(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db
    .insert(zaloNotificationLog)
    .values(keys.map((key) => ({ key })))
    .onConflictDoNothing()
    .returning({ key: zaloNotificationLog.key });
  return new Set(rows.map((r) => r.key));
}

/**
 * `force` là nút "Gửi ngay": báo trọn danh sách đang quá hạn, kể cả đơn đã báo.
 * Vẫn ghi sổ đơn mới để lượt tự động sau không báo lại.
 */
async function certificateOverdueText(force: boolean): Promise<string | null> {
  const kind: ZaloNotificationKind = "insurance-certificate-overdue";
  // Cùng mốc thời gian với cảnh báo của `ops:watch`: lần gần nhất đơn chuyển sang chờ giấy chứng nhận.
  const rows = await db.execute<{ id: string; minutes: string }>(sql`
    select o.id,
      floor(extract(epoch from now() - coalesce(h.changed_at, o.created_at)) / 60) as minutes
    from insurance_orders o
    left join lateral (
      select max(s.changed_at) as changed_at
      from insurance_order_status_history s
      where s.order_id = o.id and s.to_status = 'awaiting-certificate'
    ) h on true
    where o.status = 'awaiting-certificate'
      and coalesce(h.changed_at, o.created_at) < now() - ${`${ZALO_CERT_OVERDUE_MINUTES} minutes`}::interval
      ${force ? sql`` : sql`and not exists (
        select 1 from zalo_notification_log l where l.key = ${`${kind}:`} || o.id
      )`}
    order by minutes desc
    limit 200
  `);
  if (rows.rows.length === 0) return null;

  const fresh = await claimKeys(rows.rows.map((r) => `${kind}:${r.id}`));
  const orders = force ? rows.rows : rows.rows.filter((r) => fresh.has(`${kind}:${r.id}`));
  if (orders.length === 0) return null;

  const lines = orders.slice(0, MAX_LINES).map((r) => `- ${r.id} chờ ${r.minutes} phút`);
  if (orders.length > MAX_LINES) lines.push(`Và ${orders.length - MAX_LINES} đơn khác.`);
  return [`Đơn bảo hiểm chờ giấy chứng nhận quá ${ZALO_CERT_OVERDUE_MINUTES} phút:`, ...lines].join("\n");
}

/**
 * Báo cáo ngày: mỗi PGĐ một tin riêng tới SĐT hồ sơ, mỗi ngày một lần, từ
 * `ZALO_PGD_REPORT_AT` trở đi. Worker tắt qua giờ đó thì bật lại trong ngày vẫn
 * gửi; qua ngày thì bỏ ngày cũ. SĐT sai dạng thì không gửi, màn chọn PGĐ hiện số.
 *
 * `force` là nút "Gửi ngay": gửi số liệu tới lúc bấm, không chờ giờ, không ghi
 * sổ, nên lượt tự động trong ngày vẫn gửi bản cuối ngày.
 */
async function pgdDailyReportNotices(accountId: string, force: boolean): Promise<ZaloNotice[]> {
  const kind: ZaloNotificationKind = "pgd-daily-report";
  const now = new Date();
  if (!force && clockNowVn(now) < ZALO_PGD_REPORT_AT) return [];
  const day = businessDay(now);
  const pgds = (await routedZaloPgds(accountId, kind)).filter((p) => isValidPhone(p.phone));
  const keyOf = (id: string) => `${kind}:${day}:${id}`;
  const fresh = force ? null : await claimKeys(pgds.map((p) => keyOf(p.id)));

  const notices: ZaloNotice[] = [];
  for (const p of pgds) {
    if (fresh && !fresh.has(keyOf(p.id))) continue;
    for (const body of pgdDailyReportMessages(await pgdDailyReport(p.id, day)))
      notices.push({ body, phone: p.phone });
  }
  return notices;
}

/**
 * Kết quả job huỷ đơn trên PVI Connect: mỗi lượt chạy job ghi một dòng
 * `pvi_cancel_runs`, mỗi dòng báo đúng một lần. Lượt tự động chỉ lấy lượt chạy
 * trong 24 giờ gần nhất: chọn người nhận sau vài ngày thì không gửi dồn báo cáo cũ.
 *
 * `force` là nút "Gửi ngay": gửi lại lượt chạy gần nhất, kể cả lượt đã báo. Vẫn ghi
 * sổ, để lượt tự động trong cùng phút không gửi lại lượt đó.
 */
async function pviCancelReportNotices(force: boolean): Promise<ZaloNotice[]> {
  const kind: ZaloNotificationKind = "pvi-cancel-report";
  const runs = force
    ? await db.select().from(pviCancelRuns).orderBy(desc(pviCancelRuns.createdAt)).limit(1)
    : await db
        .select()
        .from(pviCancelRuns)
        .where(sql`${pviCancelRuns.createdAt} > now() - interval '24 hours' and not exists (
          select 1 from zalo_notification_log l where l.key = ${`${kind}:`} || ${pviCancelRuns.id}::text
        )`)
        .orderBy(asc(pviCancelRuns.createdAt))
        .limit(20);
  if (runs.length === 0) return [];

  const fresh = await claimKeys(runs.map((r) => `${kind}:${r.id}`));
  return runs
    .filter((r) => force || fresh.has(`${kind}:${r.id}`))
    .flatMap((r) => pviCancelReportMessages(r).map((body) => ({ body })));
}

/** Các tin cần gửi cho sự việc mới của loại này; mảng rỗng khi không có gì mới. */
async function collectZaloNotice(
  kind: ZaloNotificationKind,
  accountId: string,
  force: boolean,
): Promise<ZaloNotice[]> {
  switch (kind) {
    case "insurance-certificate-overdue": {
      const body = await certificateOverdueText(force);
      return body ? [{ body }] : [];
    }
    case "pgd-daily-report":
      return pgdDailyReportNotices(accountId, force);
    case "pvi-cancel-report":
      return pviCancelReportNotices(force);
  }
}

/**
 * Dựng tin của một loại rồi đưa vào hàng chờ; worker gửi đi. Lượt tự động của
 * worker và nút "Gửi ngay" cùng đi qua đây. Trả số tin đã đưa vào, `null` khi
 * loại này chưa có nơi nhận: chưa chọn nhóm, và chưa chọn người có SĐT đúng.
 *
 * Tin có `phone` đi riêng tới số đó. Tin không có `phone` đi vào các nhóm đã chọn,
 * và tới từng người nhận riêng của loại đó.
 */
export async function queueZaloNotices(
  accountId: string,
  kind: ZaloNotificationKind,
  force = false,
): Promise<number | null> {
  const groupIds = notificationTakesGroups(kind) ? await routedZaloGroupIds(accountId, kind) : [];
  const phones = notificationPeople(kind)
    ? (await routedZaloPgds(accountId, kind)).map((p) => p.phone).filter(isValidPhone)
    : [];
  if (groupIds.length === 0 && phones.length === 0) return null;

  const notices = await collectZaloNotice(kind, accountId, force);
  for (const n of notices) {
    if (n.phone) {
      await enqueueZaloPhoneText([n.phone], n.body);
      continue;
    }
    if (groupIds.length > 0) await enqueueZaloGroupText(groupIds, n.body);
    if (phones.length > 0) await enqueueZaloPhoneText(phones, n.body);
  }
  return notices.length;
}
