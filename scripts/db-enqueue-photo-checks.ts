import { and, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { bankAccountChecks, bankAccounts, banks } from "../src/server/db/schema";
import { hasPhotoChecker, PHOTO_CHECK_CHANNEL } from "../src/server/photoCheck";

/**
 * Xếp hàng kiểm ảnh cho tài khoản ĐÃ CÓ trước lúc bật tính năng.
 *
 * `enqueuePhotoCheck` chỉ chạy lúc nhân viên hoàn thành hay đổi ảnh, nên tài
 * khoản hoàn thành trước deploy không có lượt nào. Script này ghi một dòng
 * `pending` cho mỗi tài khoản chưa từng được kiểm, worker tự chạy tiếp.
 *
 *   bun --env-file=.env.local scripts/db-enqueue-photo-checks.ts --bank=TPB --from=2026-09-01
 *   bun --env-file=.env.local scripts/db-enqueue-photo-checks.ts --bank=TPB --from=2026-09-01 --dry-run
 *
 * Chạy lại bao nhiêu lần cũng an toàn: tài khoản đã có lượt kiểm thì bỏ qua.
 */

const arg = (name: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";

async function main() {
  const bankCode = arg("bank");
  const from = arg("from");
  const dryRun = process.argv.includes("--dry-run");

  if (!bankCode || !hasPhotoChecker(bankCode))
    throw new Error(`--bank phải là ngân hàng đã có bộ nhãn OCR, ví dụ --bank=TPB. Nhận: "${bankCode}"`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("--from phải là YYYY-MM-DD.");

  const rows = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .leftJoin(bankAccountChecks, eq(bankAccountChecks.accountId, bankAccounts.id))
    .where(
      and(
        eq(banks.code, bankCode),
        ne(bankAccounts.status, "creating"),
        gte(bankAccounts.createdAt, new Date(`${from}T00:00:00+07:00`)),
        isNull(bankAccountChecks.id),
      ),
    );

  console.log(
    `${rows.length} tài khoản ${bankCode} từ ${from} chưa có lượt kiểm${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}.`,
  );
  if (rows.length === 0 || dryRun) return;

  await db.transaction(async (tx) => {
    await tx.insert(bankAccountChecks).values(rows.map((r) => ({ accountId: r.id })));
    await tx.execute(sql`select pg_notify(${PHOTO_CHECK_CHANNEL}, '')`);
  });
  console.log("Đã xếp hàng. Worker mgst-photo-check tự chạy.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
