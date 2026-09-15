import { purgeDraftAccounts } from "../src/server/banking";
import { businessDay } from "../src/lib/format";

/**
 * Dọn bản nháp tài khoản ngân hàng cuối ngày (chốt 2026-09-15).
 *
 * Timer `mgst-purge-drafts.timer` gọi lúc 00:00 giờ Việt Nam. Xoá mọi tài khoản
 * `creating` mở TRƯỚC 00:00 của ngày làm việc hiện tại: đúng nửa đêm thì trọn
 * kho nháp; timer chạy bù trễ thì chừa bản nháp mở sau nửa đêm. Chủ mỗi bản
 * nháp nhận một thông báo, xem `purgeDraftAccounts`.
 *
 *   bun --env-file=.env.local scripts/purge-draft-accounts.ts --dry-run
 *   bun --env-file=.env.local scripts/purge-draft-accounts.ts
 *
 * `--dry-run` chỉ liệt kê, không xoá, không báo ai. Chạy trên máy chủ trước khi
 * bật timer để biết sẽ mất bao nhiêu dòng.
 */

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const today = businessDay();
  const before = new Date(`${today}T00:00:00+07:00`);

  const { removed } = await purgeDraftAccounts(before, dryRun);

  console.log(
    `${removed.length} bản nháp mở trước ${today} 00:00${dryRun ? " (CHẠY KHÔ — không xoá gì)" : " đã xoá"}.`,
  );
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
