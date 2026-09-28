import { sql } from "drizzle-orm";
import { photoCheckIssueLabels, PhotoCheckResult } from "@/lib/api/photoCheck";
import {
  PhotoCheckFixBy,
  type PhotoCheckStats,
  type PhotoCheckStatsReason,
} from "@/lib/api/photoCheckStats";
import { BUSINESS_TIMEZONE } from "@/lib/format";
import { isRealIsoDate } from "@/lib/types";
import { accountOpenedDayBetween } from "./banking";
import { db } from "./db/client";

/**
 * Bot chấm đạt / không đạt và người duyệt xử lý ra sao, của một ngân hàng.
 *
 * "Đạt" ở đây là điểm MÁY, không tính xác nhận tay: tab này đo độ đúng của bot,
 * khác `photoCheckFilter` là bộ lọc cho người duyệt.
 *
 * Người duyệt xếp một nhóm cho mỗi tài khoản: xác nhận đạt thắng đánh lỗi, vì
 * xác nhận nằm trên lượt kiểm mới nhất, còn đánh lỗi có thể thuộc bộ ảnh cũ.
 *
 * "Bot đạt, người duyệt đánh lỗi" xét lúc đánh lỗi, không xét lượt mới nhất:
 * tài khoản bị đánh lỗi rồi sửa xong được bot chấm đạt thì lượt mới nhất đạt,
 * mà lúc bị đánh lỗi bot đang chấm không đạt (TPB 2026-09-21..27: 87 so với 1).
 */
export async function photoCheckStatsOfBank(
  bankId: string,
  from: string,
  to: string,
): Promise<PhotoCheckStats> {
  const dayFilter =
    isRealIsoDate(from) || isRealIsoDate(to)
      ? sql`and ${accountOpenedDayBetween(
          isRealIsoDate(from) ? from : "1970-01-01",
          isRealIsoDate(to) ? to : "9999-12-31",
        )}`
      : sql``;

  const everError = sql`bank_accounts.id in (
    select h.account_id from bank_account_status_history h where h.to_status = 'error'
  )`;

  // Không đặt bí danh cho `bank_accounts`: `accountOpenedDayBetween` viết cột
  // theo tên bảng thật. Đánh lỗi dùng `in` chứ không `exists`: Postgres băm tập
  // tài khoản bị đánh lỗi một lần thay vì tra từng dòng (TPB 33.041 tài khoản:
  // 445 ms còn 190 ms). Câu con tương quan chỉ chạy sau khi `in` đã lọc.
  //
  // Lượt 1 và lần sửa chỉ đếm lượt `notify`: lượt của script quét lại hàng
  // loạt không phải do ai sửa, và nhân viên không nhận thông báo của lượt đó.
  // Đổi mã chỉ nhận ra qua ghi chú mà `changeReferralCodeByBankManager` ghi
  // cùng giao dịch với lượt kiểm; hai mốc giờ lệch nhau vài giây nên so trong 5 giây.
  const accounts = sql`
    select
      coalesce(
        bank_accounts.opened_date,
        (bank_accounts.created_at at time zone ${BUSINESS_TIMEZONE})::date
      ) as day,
      case
        when ck.status = 'done' and ck.total > 0 and ck.passed = ck.total then 'pass'
        when ck.status = 'done' and ck.passed < ck.total then 'fail'
        else 'none'
      end as bot,
      ck.confirmed_at is not null as confirmed,
      ${everError} as ever_error,
      case when ${everError} then exists (
        select 1 from bank_account_status_history h
        where h.account_id = bank_accounts.id and h.to_status = 'error' and (
          select c.total > 0 and c.passed = c.total
          from bank_account_checks c
          where c.account_id = bank_accounts.id and c.status = 'done' and c.checked_at < h.changed_at
          order by c.checked_at desc
          limit 1
        )
      ) else false end as error_on_pass,
      case
        when first_ck.ok is distinct from false then null
        when fix_ck.created_at is null then 'none'
        when exists (
          select 1 from bank_account_status_history h
          where h.account_id = bank_accounts.id
            and h.note like 'Đổi mã giới thiệu%'
            and h.changed_at between fix_ck.created_at - interval '5 seconds'
              and fix_ck.created_at + interval '5 seconds'
        ) then 'code-change'
        when exists (
          select 1 from bank_account_status_history h
          where h.account_id = bank_accounts.id and h.to_status = 'error'
            and h.changed_at > first_ck.created_at and h.changed_at < fix_ck.created_at
        ) then 'after-error'
        else 'self'
      end as fix_by,
      extract(epoch from fix_ck.created_at - first_ck.created_at) / 60 as fix_minutes,
      ck.result
    from bank_accounts
    left join lateral (
      select c.status, c.passed, c.total, c.confirmed_at, c.result
      from bank_account_checks c
      where c.account_id = bank_accounts.id
      order by c.created_at desc
      limit 1
    ) ck on true
    left join lateral (
      select c.created_at, c.total > 0 and c.passed = c.total as ok
      from bank_account_checks c
      where c.account_id = bank_accounts.id and c.notify and c.status = 'done'
      order by c.created_at
      limit 1
    ) first_ck on true
    left join lateral (
      select c.created_at
      from bank_account_checks c
      where c.account_id = bank_accounts.id and c.notify and c.created_at > first_ck.created_at
      order by c.created_at
      limit 1
    ) fix_ck on true
    where bank_accounts.bank_id = ${bankId}
      and bank_accounts.status <> 'creating'
      ${dayFilter}
  `;

  const [dayRows, failRows, fixRows] = await Promise.all([
    db.execute<{
      day: string;
      total: string;
      passed: string;
      failed: string;
      failed_confirmed: string;
      failed_error: string;
      passed_error: string;
    }>(sql`
      with a as (${accounts})
      select
        day::text as day,
        count(*) as total,
        count(*) filter (where bot = 'pass') as passed,
        count(*) filter (where bot = 'fail') as failed,
        count(*) filter (where bot = 'fail' and confirmed) as failed_confirmed,
        count(*) filter (where bot = 'fail' and not confirmed and ever_error) as failed_error,
        count(*) filter (where error_on_pass) as passed_error
      from a
      group by day
      order by day
    `),
    db.execute<{ result: unknown }>(sql`
      with a as (${accounts})
      select result from a where bot = 'fail'
    `),
    db.execute<{ fix_by: PhotoCheckFixBy; total: string; passed: string; median: number | null }>(sql`
      with a as (${accounts})
      select
        fix_by,
        count(*) as total,
        count(*) filter (where bot = 'pass') as passed,
        percentile_cont(0.5) within group (order by fix_minutes) as median
      from a
      where fix_by is not null
      group by fix_by
    `),
  ]);

  const sum = (key: keyof (typeof dayRows.rows)[number]) =>
    dayRows.rows.reduce((acc, r) => acc + Number(r[key]), 0);
  const total = sum("total");
  const passed = sum("passed");
  const failed = sum("failed");
  const failedConfirmed = sum("failed_confirmed");
  const failedMarkedError = sum("failed_error");

  // Lý do đọc qua `photoCheckIssueLabels`, không đếm chuỗi trong SQL: kết quả
  // lưu trước khi có trường `issues` chỉ còn câu `note`, hàm đó đọc được cả hai.
  const counts = new Map<string, number>();
  for (const { result } of failRows.rows) {
    const parsed = PhotoCheckResult.safeParse(result);
    if (!parsed.success) continue;
    const labels = new Set(
      parsed.data.items.filter((item) => item.verdict !== "pass").flatMap(photoCheckIssueLabels),
    );
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const reasons: PhotoCheckStatsReason[] = [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "vi"));

  return {
    total,
    passed,
    failed,
    unchecked: total - passed - failed,
    failedConfirmed,
    failedMarkedError,
    failedUnreviewed: failed - failedConfirmed - failedMarkedError,
    passedMarkedError: sum("passed_error"),
    reasons,
    fixes: PhotoCheckFixBy.options.map((by) => {
      const row = fixRows.rows.find((r) => r.fix_by === by);
      return {
        by,
        count: Number(row?.total ?? 0),
        passed: Number(row?.passed ?? 0),
        medianMinutes: row?.median == null ? null : Math.round(Number(row.median)),
      };
    }),
    days: dayRows.rows.map((r) => ({
      day: r.day,
      total: Number(r.total),
      passed: Number(r.passed),
      failed: Number(r.failed),
    })),
  };
}
