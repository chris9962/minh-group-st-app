import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Luật hoa hồng BHYT/BHXH chủ dự án gửi 2026-11-13: Tăng mới và Tái tục mỗi gói
 * một mức cho mọi số tháng, áp dụng từ đầu. Script thay MỌI bộ % đã lưu, kể cả
 * tháng đã chốt lương, bằng 4 dòng `months = 0`. Từ bản này app bỏ qua dòng
 * `months > 0`, nên chạy ngay sau migrate: chưa chạy thì gói Tăng mới báo "Chưa
 * cấu hình % hoa hồng".
 *
 * % ghi theo đơn vị 0,001%: 9,000% là 9000. Không đụng mức điểm KPI.
 *
 * Chạy khô, in bộ cũ và bộ mới:
 *   bun run db:flat-social-insurance-rates
 * Ghi thật:
 *   bun run db:flat-social-insurance-rates -- --apply
 */

const RATES: [kind: "bhyt" | "bhxh", plan: "new" | "renewal", receive: number, pay: number][] = [
  ["bhyt", "new", 9000, 7200],
  ["bhyt", "renewal", 3500, 2800],
  ["bhxh", "new", 17000, 13600],
  ["bhxh", "renewal", 6000, 4800],
];

const label = (kind: string, plan: string, months: number) =>
  `${kind.toUpperCase()} ${plan === "new" ? "tăng mới" : "tái tục"}${months > 0 ? ` ${months} tháng` : ""}`;

async function main() {
  const apply = process.argv.includes("--apply");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const current = await db.execute<{
    year_month: string;
    kind: string;
    plan: string;
    months: number;
    receive_rate: number;
    pay_rate: number;
  }>(sql`
    select year_month, kind::text, plan::text, months, receive_rate, pay_rate
    from social_insurance_rates
    order by year_month, kind, plan, months
  `);
  const months = [...new Set(current.rows.map((r) => r.year_month))];
  if (months.length === 0) {
    console.log("Chưa có bộ % nào. Nhập ở trang Cấu hình BHYT/BHXH.");
    await pool.end();
    return;
  }

  for (const month of months) {
    console.log(`Tháng ${month}:`);
    for (const r of current.rows.filter((row) => row.year_month === month))
      console.log(`  bỏ  ${label(r.kind, r.plan, r.months)}: nhận ${r.receive_rate / 1000}%, chi ${r.pay_rate / 1000}%`);
    for (const [kind, plan, receive, pay] of RATES)
      console.log(`  ghi ${label(kind, plan, 0)}: nhận ${receive / 1000}%, chi ${pay / 1000}%`);
  }

  if (!apply) {
    console.log(`\n${months.length} tháng (CHẠY KHÔ — thêm --apply để ghi).`);
    await pool.end();
    return;
  }

  await db.transaction(async (tx) => {
    for (const month of months) {
      await tx.execute(sql`delete from social_insurance_rates where year_month = ${month}`);
      for (const [kind, plan, receive, pay] of RATES)
        await tx.execute(sql`
          insert into social_insurance_rates (year_month, kind, plan, months, receive_rate, pay_rate)
          values (${month}, ${kind}::social_insurance_kind, ${plan}::social_insurance_plan, 0, ${receive}, ${pay})
        `);
    }
  });

  await pool.end();
  console.log(`Ghi xong ${months.length} tháng.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
