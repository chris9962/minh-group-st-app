import { eq } from "drizzle-orm";
import { businessDay } from "../src/lib/format";
import { db } from "../src/server/db/client";
import { users } from "../src/server/db/schema";
import { pgdDailyReport, pgdDailyReportText } from "../src/server/zalo/pgdDailyReport";

/**
 * In thử tin báo cáo ngày của một Phó giám đốc, KHÔNG gửi Zalo. Tin thật do worker
 * Zalo gửi, theo cấu hình loại "Báo cáo ngày cho Phó giám đốc" ở màn Bot Zalo.
 *
 *   bun --env-file=.env.local scripts/pgd-daily-report.ts --as=pgd1
 *   bun --env-file=.env.local scripts/pgd-daily-report.ts --as=pgd1 --day=2026-10-11
 *
 * `--as` là tên đăng nhập của PGĐ. Bỏ `--day` thì lấy ngày hiện tại giờ Việt Nam.
 */
async function main() {
  const username = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const day = process.argv.find((a) => a.startsWith("--day="))?.slice(6) ?? businessDay();
  if (!username) throw new Error("Thiếu --as=<tên đăng nhập của PGĐ>");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("--day phải có dạng YYYY-MM-DD");

  const [pgd] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
  if (!pgd) throw new Error(`Không có tài khoản ${username}`);

  console.log(pgdDailyReportText(await pgdDailyReport(pgd.id, day)));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
