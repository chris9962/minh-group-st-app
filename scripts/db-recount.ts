import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { recountGiftCases } from "../src/server/gift";

/**
 * Đếm lại mọi cột lưu sẵn từ dữ liệu gốc:
 * `customers.account_count` / `insurance_count` / `gift_case` và
 * `referral_codes.used_count` / `holding_count`.
 *
 * `gift_case` khác ba cột kia ở chỗ KHÔNG có trigger nào giữ: giá trị của nó do
 * hàm luật JavaScript quyết định (`src/rules/`), nên tầng ứng dụng phải tự ghi
 * mỗi lần tài khoản của khách lên/rời `done`. Vì vậy nó là cột dễ lệch nhất —
 * chạy lệnh này sau mỗi lần thêm file luật của kỳ mới.
 *
 * Bình thường KHÔNG cần chạy: các cột đó do trigger `mgst_sync_account_count` /
 * `mgst_sync_insurance_count` / `mgst_sync_referral_counts` giữ, nên ghi từ
 * đường nào số cũng đúng.
 *
 * Chạy khi: vừa nạp dữ liệu bằng `COPY` (trigger vẫn chạy, nhưng chậm nên có
 * người tắt đi), vừa khôi phục từ bản sao lưu cũ, hoặc nghi số lệch. Lệnh này
 * an toàn để chạy bất cứ lúc nào — nó ghi đè bằng số đếm thật.
 *
 * In ra những dòng ĐANG lệch trước khi sửa. Sửa im lặng thì lần sau lệch nữa
 * cũng không ai biết là đã lệch bao nhiêu lần rồi.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const drift = await db.execute(sql`
    select c.id, c.full_name,
           c.account_count as stored_accounts,
           coalesce(a.n, 0) as real_accounts,
           c.insurance_count as stored_insurance,
           coalesce(i.n, 0) as real_insurance
    from customers c
    left join (select customer_id, count(*)::int n from bank_accounts where status = 'done' group by customer_id) a
           on a.customer_id = c.id
    left join (select customer_id, count(*)::int n from insurance_orders group by customer_id) i
           on i.customer_id = c.id
    where c.account_count <> coalesce(a.n, 0) or c.insurance_count <> coalesce(i.n, 0)
  `);

  if (drift.rows.length === 0) {
    console.log("Không có hồ sơ khách nào lệch — hai cột đếm đang khớp dữ liệu gốc.");
  } else {
    console.log(`${drift.rows.length} hồ sơ khách lệch:`);
    for (const r of drift.rows) console.log(" ", JSON.stringify(r));
  }

  await db.execute(sql`
    update customers c
    set account_count = coalesce(a.n, 0), insurance_count = coalesce(i.n, 0)
    from (select id from customers) x
    left join (select customer_id, count(*)::int n from bank_accounts where status = 'done' group by customer_id) a
           on a.customer_id = x.id
    left join (select customer_id, count(*)::int n from insurance_orders group by customer_id) i
           on i.customer_id = x.id
    where c.id = x.id
      and (c.account_count <> coalesce(a.n, 0) or c.insurance_count <> coalesce(i.n, 0))
  `);

  // `imported_used` KHÔNG đụng tới: nó là số nhập tay ở P-62, không có dòng
  // `bank_accounts` nào để đếm lại. Gộp nó vào `used_count` là xoá sạch phần đó.
  const codeDrift = await db.execute(sql`
    select r.id, r.code,
           r.used_count as stored_used, coalesce(a.done, 0) as real_used,
           r.holding_count as stored_holding, coalesce(a.creating, 0) as real_holding
    from referral_codes r
    left join (
      select referral_code_id,
             count(*) filter (where status = 'done')::int as done,
             count(*) filter (where status = 'creating')::int as creating
      from bank_accounts group by referral_code_id
    ) a on a.referral_code_id = r.id
    where r.used_count <> coalesce(a.done, 0) or r.holding_count <> coalesce(a.creating, 0)
  `);

  if (codeDrift.rows.length === 0) {
    console.log("Không có mã giới thiệu nào lệch.");
  } else {
    console.log(`${codeDrift.rows.length} mã giới thiệu lệch:`);
    for (const r of codeDrift.rows) console.log(" ", JSON.stringify(r));
  }

  await db.execute(sql`
    update referral_codes r
    set used_count = coalesce(a.done, 0), holding_count = coalesce(a.creating, 0)
    from (select id from referral_codes) x
    left join (
      select referral_code_id,
             count(*) filter (where status = 'done')::int as done,
             count(*) filter (where status = 'creating')::int as creating
      from bank_accounts group by referral_code_id
    ) a on a.referral_code_id = x.id
    where r.id = x.id
      and (r.used_count <> coalesce(a.done, 0) or r.holding_count <> coalesce(a.creating, 0))
  `);

  const giftDrift = await recountGiftCases();
  if (giftDrift.length === 0) {
    console.log("Không có khách nào lệch trường hợp quà.");
  } else {
    console.log(`${giftDrift.length} khách lệch trường hợp quà:`);
    for (const r of giftDrift) console.log(" ", JSON.stringify(r));
  }

  await pool.end();
  console.log("Đếm lại xong.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
