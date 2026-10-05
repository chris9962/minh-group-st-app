import { purgeEmptyCustomers } from "../src/server/customers";
import { businessMonth } from "../src/lib/format";

/**
 * Xoá hồ sơ khách chỉ có hồ sơ, không có tài khoản, đơn bảo hiểm, dịch vụ, VNeID,
 * BHYT/BHXH hay đợt phát quà (chốt 2026-10-05).
 *
 * Timer `mgst-purge-customers.timer` gọi lúc 00:00 ngày 1 hằng tháng, giờ Việt
 * Nam, sau job dọn nháp tài khoản. Chỉ xoá hồ sơ mở TRƯỚC ngày 1 của tháng hiện
 * tại, nên chạy tay giữa tháng không đụng hồ sơ của tháng đang chạy. Xem
 * `purgeEmptyCustomers`.
 *
 *   bun --env-file=.env.local scripts/purge-empty-customers.ts --dry-run
 *   bun --env-file=.env.local scripts/purge-empty-customers.ts
 *
 * `--dry-run` chỉ đếm, không xoá. Chạy trên máy chủ trước khi bật timer để biết
 * sẽ mất bao nhiêu hồ sơ.
 */

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const month = businessMonth();
  const before = new Date(`${month}-01T00:00:00+07:00`);

  const { removed } = await purgeEmptyCustomers(before, dryRun);

  console.log(
    `${removed.length} hồ sơ khách không có bản ghi nghiệp vụ, mở trước ${month}-01${dryRun ? " (CHẠY KHÔ, không xoá gì)" : " đã xoá"}.`,
  );
  const byMonth = new Map<string, number>();
  for (const row of removed) {
    const key = row.createdAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
  }
  for (const [key, n] of [...byMonth].sort()) console.log(`  tháng ${key}: ${n} hồ sơ`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
