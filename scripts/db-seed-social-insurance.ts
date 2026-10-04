import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Bộ % hoa hồng BHYT/BHXH và mức điểm KPI An Sinh tháng 2026-10, theo bảng chủ
 * dự án gửi 2026-10-04 (spec docs/spec-bhyt-bhxh-an-sinh.md mục 2). Là script chứ không nằm trong
 * migration: mức % là dữ liệu của công ty và đổi theo tháng. Đổi về sau ở trang
 * cấu hình.
 *
 * % ghi theo đơn vị 0,001%: 7,350% là 7350. Tái tục lưu `months = 0`, dùng cho
 * mọi số tháng.
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
  ["bhyt", "new", 3, 7350, 5880],
  ["bhyt", "new", 6, 8820, 7056],
  ["bhyt", "new", 12, 9800, 7840],
  ["bhyt", "renewal", 0, 4200, 3360],
  ["bhxh", "new", 1, 11400, 9120],
  ["bhxh", "new", 3, 14300, 11440],
  ["bhxh", "new", 6, 17100, 13680],
  ["bhxh", "new", 12, 19000, 15200],
  ["bhxh", "renewal", 0, 8000, 6400],
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
  for (const [kind, plan, months, receive, pay] of toAdd)
    console.log(
      `  ${kind.toUpperCase()} ${plan === "new" ? `tăng mới ${months} tháng` : "tái tục"}: nhận ${receive / 1000}%, chi ${pay / 1000}%`,
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
