import { expireDraftAccounts } from "../src/server/banking";

/**
 * Dọn bản nháp tài khoản ngân hàng quá hạn (chốt 2026-10-06).
 *
 * Timer `mgst-purge-drafts.timer` gọi mỗi phút. Bản nháp `creating` đủ 25 phút
 * thì chủ bản nháp nhận thông báo "sắp bị xoá" một lần; đủ 30 phút thì hệ thống
 * xoá và báo "đã xoá". Luật và cách làm ở `expireDraftAccounts`.
 *
 *   bun --env-file=.env.local scripts/purge-draft-accounts.ts --dry-run
 *   bun --env-file=.env.local scripts/purge-draft-accounts.ts
 *
 * `--dry-run` chỉ liệt kê hai danh sách, không gửi, không ghi, không xoá.
 */

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const now = new Date();

  const { warned, removed } = await expireDraftAccounts(now, dryRun);

  const suffix = dryRun ? " (CHẠY KHÔ, không gửi, không xoá)" : "";
  console.log(`${warned.length} bản nháp đã báo trước${suffix}.`);
  for (const row of warned) {
    console.log(`  ${row.id}  ${row.bankCode}  ${row.referralCode}  ${row.createdByName ?? "?"}`);
  }
  console.log(`${removed.length} bản nháp đã xoá${suffix}.`);
  for (const row of removed) {
    console.log(`  ${row.id}  ${row.bankCode}  ${row.referralCode}  ${row.createdByName ?? "?"}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
