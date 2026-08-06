import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Đếm lại `customers.account_count` / `insurance_count` từ dữ liệu gốc.
 *
 * Bình thường KHÔNG cần chạy: hai cột đó do trigger `mgst_sync_account_count` /
 * `mgst_sync_insurance_count` giữ, nên ghi từ đường nào số cũng đúng.
 *
 * Chạy khi: vừa nạp dữ liệu bằng `COPY` (trigger vẫn chạy, nhưng chậm nên có
 * người tắt đi), vừa khôi phục từ bản sao lưu cũ, hoặc nghi số lệch. Lệnh này
 * an toàn để chạy bất cứ lúc nào — nó ghi đè bằng số đếm thật.
 *
 * In ra những hồ sơ ĐANG lệch trước khi sửa. Sửa im lặng thì lần sau lệch nữa
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
    console.log("Không có hồ sơ nào lệch — hai cột đếm đang khớp dữ liệu gốc.");
  } else {
    console.log(`${drift.rows.length} hồ sơ lệch:`);
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

  await pool.end();
  console.log("Đếm lại xong.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
