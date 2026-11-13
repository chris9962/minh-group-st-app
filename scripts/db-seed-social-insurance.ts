import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Bộ % hoa hồng BHYT/BHXH và mức điểm KPI An Sinh tháng 2026-10. Mức điểm theo
 * bảng chủ dự án gửi 2026-10-04 (spec docs/spec-bhyt-bhxh-an-sinh.md mục 2), %
 * hoa hồng theo luật gửi 2026-11-13, áp dụng từ đầu. Là script chứ không nằm trong
 * migration: mức % là dữ liệu của công ty và đổi theo tháng. Đổi về sau ở trang
 * cấu hình.
 *
 * % ghi theo đơn vị 0,001%: 9,000% là 9000. Mỗi gói một mức cho mọi số tháng,
 * lưu ở `months = 0`.
 *
 * Chạy khô, in những gì sẽ ghi:
 *   bun run db:seed-social-insurance
 * Ghi thật:
 *   bun run db:seed-social-insurance -- --apply
 *
 * Bảng nào tháng đó đã có dòng thì bỏ qua cả bảng, không chèn bù: dòng thiếu có
 * thể là dòng người dùng đã xoá ở trang cấu hình. Chạy lại nhiều lần vô hại.
 */

const MONTH = "2026-10";

const RATES: [kind: "bhyt" | "bhxh", plan: "new" | "renewal", months: number, receive: number, pay: number][] = [
  ["bhyt", "new", 0, 9000, 7200],
  ["bhyt", "renewal", 0, 3500, 2800],
  ["bhxh", "new", 0, 17000, 13600],
  ["bhxh", "renewal", 0, 6000, 4800],
];

/** Mức điểm KPI An Sinh (spec mục 2.2): doanh thu bao nhiêu đồng được 1 điểm. */
const KPI: [kind: "bhyt" | "bhxh", plan: "new" | "renewal", revenuePerPoint: number][] = [
  ["bhxh", "new", 9_000_000],
  ["bhxh", "renewal", 12_000_000],
  ["bhyt", "new", 12_000_000],
  ["bhyt", "renewal", 24_000_000],
];

async function main() {
  const apply = process.argv.includes("--apply");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const existing = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from social_insurance_rates where year_month = ${MONTH}`,
  );
  const rateCount = existing.rows[0].count;
  if (rateCount > 0) console.log(`Bỏ qua % hoa hồng: tháng ${MONTH} đã có ${rateCount} dòng.`);
  const toAdd = rateCount > 0 ? [] : RATES;

  const existingKpi = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from social_insurance_kpi_rates where year_month = ${MONTH}`,
  );
  const kpiCount = existingKpi.rows[0].count;
  if (kpiCount > 0) console.log(`Bỏ qua mức điểm KPI: tháng ${MONTH} đã có ${kpiCount} dòng.`);
  const kpiToAdd = kpiCount > 0 ? [] : KPI;

  if (toAdd.length === 0 && kpiToAdd.length === 0) {
    await pool.end();
    return;
  }

  console.log(
    `${toAdd.length} dòng %, ${kpiToAdd.length} mức điểm sắp ghi cho tháng ${MONTH}${apply ? "" : " (CHẠY KHÔ — thêm --apply để ghi)"}:`,
  );
  for (const [kind, plan, , receive, pay] of toAdd)
    console.log(
      `  ${kind.toUpperCase()} ${plan === "new" ? "tăng mới" : "tái tục"}: nhận ${receive / 1000}%, chi ${pay / 1000}%`,
    );
  for (const [kind, plan, revenue] of kpiToAdd)
    console.log(`  KPI ${kind.toUpperCase()} ${plan === "new" ? "tăng mới" : "tái tục"}: ${revenue}đ = 1 điểm`);

  if (!apply) {
    await pool.end();
    return;
  }

  for (const [kind, plan, months, receive, pay] of toAdd)
    await db.execute(sql`
      insert into social_insurance_rates (year_month, kind, plan, months, receive_rate, pay_rate)
      values (${MONTH}, ${kind}::social_insurance_kind, ${plan}::social_insurance_plan, ${months}, ${receive}, ${pay})
      on conflict do nothing
    `);
  for (const [kind, plan, revenue] of kpiToAdd)
    await db.execute(sql`
      insert into social_insurance_kpi_rates (year_month, kind, plan, revenue_per_point)
      values (${MONTH}, ${kind}::social_insurance_kind, ${plan}::social_insurance_plan, ${revenue})
      on conflict do nothing
    `);

  await pool.end();
  console.log("Ghi xong.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
