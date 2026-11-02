import { sql } from "drizzle-orm";
import { businessMonth } from "../src/lib/format";
import { db } from "../src/server/db/client";

/**
 * Đếm lại hai cột đếm do trigger giữ (migration 0160, 0161):
 * `insurance_blank_staff_quotas.used_orders` từ đơn bảo hiểm Hoàn thành và
 * `bank_blank_staff_quotas.used_orders` từ tài khoản đã tính phiếu. Cùng vai
 * `db:recount` với `customers.account_count`: bình thường không cần chạy, chạy
 * khi vừa nạp dữ liệu, vừa dọn bảng phôi, hay nghi số lệch.
 *
 * Chỉ sửa dòng ĐANG MỞ. Dòng đã khoá lúc chuyển phòng là lịch sử. Phôi: đơn không
 * ghi phòng đã tính, nên số đúng của dòng mở = tổng đơn Hoàn thành trừ số các dòng
 * đã khoá cùng (tháng, người, loại). Phiếu: tài khoản ghi `blank_department_id`,
 * nên so được từng dòng, kể cả dòng khoá; dòng khoá lệch thì chỉ in ra.
 *
 * Phiếu ngân hàng: tài khoản Hoàn thành, Lỗi, Đã sửa lỗi mà chưa ghi
 * `blank_department_id` thì ghi phòng hiện tại của người lập rồi đếm. Sau khi
 * dọn bảng phiếu trên máy chủ, đây là bước lấp số cho tháng đầu.
 *
 *   bun run db:recount-blanks                      # in chỗ lệch, không ghi
 *   bun run db:recount-blanks -- --apply           # ghi
 *   bun run db:recount-blanks -- --from=2026-11    # tháng bắt đầu
 *
 * Không có `--from` thì đếm từ tháng đầu tiên văn phòng cấp hoặc Trưởng phòng nhập,
 * cùng mốc với màn đọc; bảng còn trống thì từ tháng hiện tại. Đơn và tài khoản trước
 * tháng đó không tính phôi.
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const first = await db.execute<{ month: string | null }>(sql`
    select min(year_month) as month from (
      select year_month from insurance_blank_department_quotas
      union all select year_month from bank_blank_department_quotas
      union all select year_month from insurance_blank_staff_quotas where issued > 0 or used is not null
      union all select year_month from bank_blank_staff_quotas where issued > 0 or used is not null
    ) months`);
  const from = process.argv.find((a) => a.startsWith("--from="))?.slice(7) ?? first.rows[0]?.month ?? businessMonth();
  if (!/^\d{4}-\d{2}$/.test(from)) throw new Error("--from phải có dạng YYYY-MM");
  const fromDay = `${from}-01`;
  console.log(`Đếm lại phôi và phiếu từ tháng ${from}${apply ? "" : " (chưa ghi, thêm --apply để ghi)"}.`);

  await db.transaction(async (tx) => {
    // Đơn Hoàn thành gom theo (tháng của order_date, người lập, loại phôi), chọn loại như trigger.
    const insurance = await tx.execute<{
      year_month: string;
      user_id: string;
      blank_type_id: string;
      department_id: string | null;
      expected: number;
      stored: number | null;
      full_name: string;
      type_code: string;
    }>(sql`
      with orders as (
        select to_char(o.order_date, 'YYYY-MM') as year_month, o.created_by as user_id, t.id as blank_type_id, count(*)::int as total
        from insurance_orders o
        cross join lateral (
          select id from insurance_blank_types t
          where t.active and t.product = o.product and (t.sum_insured is null or t.sum_insured = o.sum_insured)
          order by t.sort, t.code limit 1
        ) t
        where o.status = 'done' and o.created_by is not null and o.order_date >= ${fromDay}::date
        group by 1, 2, 3
      ),
      closed as (
        select year_month, user_id, blank_type_id, sum(used_orders)::int as n
        from insurance_blank_staff_quotas where closed_at is not null and year_month >= ${from}
        group by 1, 2, 3
      ),
      expected as (
        select coalesce(o.year_month, c.year_month) as year_month, coalesce(o.user_id, c.user_id) as user_id,
          coalesce(o.blank_type_id, c.blank_type_id) as blank_type_id, coalesce(o.total, 0) - coalesce(c.n, 0) as expected
        from orders o
        full join closed c on c.year_month = o.year_month and c.user_id = o.user_id and c.blank_type_id = o.blank_type_id
      ),
      open_rows as (
        select year_month, user_id, blank_type_id, department_id, used_orders
        from insurance_blank_staff_quotas where closed_at is null and year_month >= ${from}
      )
      select coalesce(e.year_month, r.year_month) as year_month,
        coalesce(e.user_id, r.user_id) as user_id,
        coalesce(e.blank_type_id, r.blank_type_id) as blank_type_id,
        coalesce(r.department_id, u.department_id) as department_id,
        coalesce(e.expected, 0) as expected, r.used_orders as stored,
        u.full_name, t.code as type_code
      from expected e
      full join open_rows r on r.year_month = e.year_month and r.user_id = e.user_id and r.blank_type_id = e.blank_type_id
      join users u on u.id = coalesce(e.user_id, r.user_id)
      join insurance_blank_types t on t.id = coalesce(e.blank_type_id, r.blank_type_id)
      where coalesce(r.used_orders, 0) <> coalesce(e.expected, 0)
      order by 1, u.full_name, t.sort`);

    console.log(`Phôi bảo hiểm: ${insurance.rows.length} dòng lệch.`);
    for (const row of insurance.rows) {
      console.log(`- ${row.year_month} ${row.full_name} ${row.type_code}: đang ${row.stored ?? "chưa có dòng"}, đúng ${row.expected}`);
      if (!apply) continue;
      if (row.stored === null) {
        if (!row.department_id) continue;
        await tx.execute(sql`
          insert into insurance_blank_staff_quotas (year_month, user_id, blank_type_id, department_id, issued, used_orders)
          values (${row.year_month}, ${row.user_id}, ${row.blank_type_id}, ${row.department_id}, 0, ${row.expected})
          on conflict (year_month, user_id, blank_type_id, department_id) do update set used_orders = ${row.expected}, updated_at = now()`);
      } else {
        await tx.execute(sql`
          update insurance_blank_staff_quotas set used_orders = ${row.expected}, updated_at = now()
          where year_month = ${row.year_month} and user_id = ${row.user_id} and blank_type_id = ${row.blank_type_id} and closed_at is null`);
      }
    }

    // Tài khoản chưa ghi phòng tính phiếu: ghi phòng hiện tại của người lập.
    const unmarked = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from bank_accounts a
      join customers c on c.id = a.customer_id
      join users u on u.id = a.created_by
      where a.status in ('done', 'error', 'fixed') and a.blank_department_id is null and u.department_id is not null
        and c.created_at >= ((${fromDay}::date)::timestamp at time zone 'Asia/Ho_Chi_Minh')`);
    console.log(`Phiếu ngân hàng: ${unmarked.rows[0].n} tài khoản chưa ghi phòng tính phiếu.`);
    if (apply && unmarked.rows[0].n > 0)
      // Trigger không chạy: cột này không nằm trong `UPDATE OF` của nó, phần đếm làm ở dưới.
      await tx.execute(sql`
        update bank_accounts a set blank_department_id = u.department_id
        from customers c, users u
        where c.id = a.customer_id and u.id = a.created_by
          and a.status in ('done', 'error', 'fixed') and a.blank_department_id is null and u.department_id is not null
          and c.created_at >= ((${fromDay}::date)::timestamp at time zone 'Asia/Ho_Chi_Minh')`);

    const bank = await tx.execute<{
      year_month: string;
      user_id: string;
      bank_id: string;
      department_id: string;
      expected: number;
      stored: number | null;
      closed: boolean;
      full_name: string;
      bank_code: string;
    }>(sql`
      with expected as (
        select to_char(c.created_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM') as year_month,
          a.created_by as user_id, a.bank_id, a.blank_department_id as department_id, count(*)::int as expected
        from bank_accounts a join customers c on c.id = a.customer_id
        where a.blank_department_id is not null and a.created_by is not null
          and c.created_at >= ((${fromDay}::date)::timestamp at time zone 'Asia/Ho_Chi_Minh')
        group by 1, 2, 3, 4
      ),
      all_rows as (
        select year_month, user_id, bank_id, department_id, used_orders, closed_at is not null as closed
        from bank_blank_staff_quotas where year_month >= ${from}
      )
      select coalesce(e.year_month, r.year_month) as year_month,
        coalesce(e.user_id, r.user_id) as user_id,
        coalesce(e.bank_id, r.bank_id) as bank_id,
        coalesce(e.department_id, r.department_id) as department_id,
        coalesce(e.expected, 0) as expected, r.used_orders as stored, coalesce(r.closed, false) as closed,
        u.full_name, b.code as bank_code
      from expected e
      full join all_rows r on r.year_month = e.year_month and r.user_id = e.user_id and r.bank_id = e.bank_id and r.department_id = e.department_id
      join users u on u.id = coalesce(e.user_id, r.user_id)
      join banks b on b.id = coalesce(e.bank_id, r.bank_id)
      where coalesce(r.used_orders, 0) <> coalesce(e.expected, 0)
      order by 1, u.full_name, b.code`);

    console.log(`Phiếu ngân hàng: ${bank.rows.length} dòng lệch.`);
    for (const row of bank.rows) {
      console.log(`- ${row.year_month} ${row.full_name} ${row.bank_code}: đang ${row.stored ?? "chưa có dòng"}, đúng ${row.expected}${row.closed ? " (dòng đã khoá, không ghi)" : ""}`);
      if (!apply || row.closed) continue;
      await tx.execute(sql`
        insert into bank_blank_staff_quotas (year_month, user_id, bank_id, department_id, issued, used_orders)
        values (${row.year_month}, ${row.user_id}, ${row.bank_id}, ${row.department_id}, 0, ${row.expected})
        on conflict (year_month, user_id, bank_id, department_id) do update set used_orders = ${row.expected}, updated_at = now()
        where bank_blank_staff_quotas.closed_at is null`);
    }

    // Dòng chỉ do trigger tạo mà về 0 thì bỏ, để bảng người của phòng không hiện dòng trống.
    if (apply) {
      await tx.execute(sql`delete from insurance_blank_staff_quotas where issued = 0 and used is null and used_orders = 0 and returned = 0 and closed_at is null`);
      await tx.execute(sql`delete from bank_blank_staff_quotas where issued = 0 and used is null and used_orders = 0 and returned = 0 and closed_at is null`);
    }
  });
  console.log(apply ? "Đã ghi." : "Chưa ghi gì.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
