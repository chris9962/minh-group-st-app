import { and, eq } from "drizzle-orm";
import { businessMonth } from "../src/lib/format";
import { db } from "../src/server/db/client";
import {
  bankAccountPhotos,
  bankAccounts,
  banks,
  customers,
  giftGrants,
  kpiScores,
  referralCodes,
} from "../src/server/db/schema";
import { recomputeGiftCase } from "../src/server/gift";
import { recomputeKpiForCustomer } from "../src/server/kpi";

/**
 * Xoá MỘT dòng `bank_accounts` và chỉnh lại đúng phần lưu sẵn của dòng đó —
 * `bun run db:delete-bank-account <id> [--yes]`.
 *
 * App KHÔNG có đường xoá tài khoản đã hoàn thành (`deleteDraft` chỉ nhận
 * `creating`), nên ca đối soát phải xoá tay. Xoá tay bằng `psql` thì hai cột
 * lưu sẵn không có trigger giữ nằm lại số cũ: `customers.gift_basket` và
 * `kpi_scores`.
 *
 * Hẹp có chủ đích, khác hai lệnh sẵn có:
 *
 * | Lệnh | Phạm vi |
 * |---|---|
 * | `kpi:recompute` | mọi nhân viên của một tháng |
 * | `db:recount` | mọi khách, mọi mã giới thiệu |
 * | lệnh này | 1 khách + 1 nhân viên + 1 tháng |
 *
 * Không chạy `--yes` thì script chỉ ĐỌC và in ra những gì sắp đổi.
 */

/** Ba cột này do trigger DB giữ, script không đụng tới — đọc chỉ để in ra đối chiếu. */
async function countsOf(customerId: string, referralCodeId: string) {
  const [customer] = await db
    .select({ accountCount: customers.accountCount, giftBasket: customers.giftBasket })
    .from(customers)
    .where(eq(customers.id, customerId));
  const [code] = await db
    .select({ usedCount: referralCodes.usedCount, holdingCount: referralCodes.holdingCount })
    .from(referralCodes)
    .where(eq(referralCodes.id, referralCodeId));
  return { customer, code };
}

async function kpiOf(ownerId: string | null, yearMonth: string | null) {
  if (!ownerId || !yearMonth) return null;
  const [row] = await db
    .select({ banking: kpiScores.bankingPoints, service: kpiScores.servicePoints })
    .from(kpiScores)
    .where(and(eq(kpiScores.userId, ownerId), eq(kpiScores.yearMonth, yearMonth)));
  return row ? { yearMonth, ...row } : { yearMonth, banking: "0", service: "0" };
}

async function main() {
  const id = process.argv[2];
  const confirmed = process.argv.includes("--yes");
  if (!id) throw new Error("Thiếu id tài khoản — bun run db:delete-bank-account <id> [--yes]");

  const [row] = await db
    .select({
      id: bankAccounts.id,
      status: bankAccounts.status,
      accountNumber: bankAccounts.accountNumber,
      openedDate: bankAccounts.openedDate,
      accountType: bankAccounts.accountType,
      errorNote: bankAccounts.errorNote,
      bankCode: banks.code,
      customerId: bankAccounts.customerId,
      customerName: customers.fullName,
      ownerId: customers.createdBy,
      referralCodeId: bankAccounts.referralCodeId,
      referralCode: referralCodes.code,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .innerJoin(referralCodes, eq(referralCodes.id, bankAccounts.referralCodeId))
    .where(eq(bankAccounts.id, id));

  if (!row) throw new Error(`Không có tài khoản ${id}`);

  const photos = await db
    .select({ url: bankAccountPhotos.url })
    .from(bankAccountPhotos)
    .where(eq(bankAccountPhotos.accountId, id));

  const [grant] = await db
    .select({ grantedAt: giftGrants.grantedAt, chosenItem: giftGrants.chosenItem })
    .from(giftGrants)
    .where(eq(giftGrants.customerId, row.customerId));

  // Điểm tính theo THÁNG CỦA NGÀY MỞ và về CHỦ HỒ SƠ khách, không phải tháng
  // hiện tại và không phải người tạo dòng (chốt 2026-08-07, câu 7.11).
  const yearMonth = row.openedDate
    ? businessMonth(new Date(`${row.openedDate}T00:00:00+07:00`))
    : null;

  const before = await countsOf(row.customerId, row.referralCodeId);
  const kpiBefore = await kpiOf(row.ownerId, yearMonth);

  console.log("Tài khoản sắp xoá:");
  console.log(`  ngân hàng      ${row.bankCode}${row.accountType === "HKD" ? " (HKD)" : ""}`);
  console.log(`  số tài khoản   ${row.accountNumber ?? "(chưa có)"}`);
  console.log(`  trạng thái     ${row.status}${row.errorNote ? ` — ${row.errorNote}` : ""}`);
  console.log(`  ngày mở        ${row.openedDate ?? "(chưa có)"}`);
  console.log(`  khách          ${row.customerName} (${row.customerId})`);
  console.log(`  mã giới thiệu  ${row.referralCode}`);
  console.log(`  ảnh kèm theo   ${photos.length} tấm, xoá theo cascade`);
  for (const p of photos) console.log(`    ${p.url}`);

  console.log("\nSố lưu sẵn trước khi xoá:");
  console.log(`  customers.account_count        ${before.customer?.accountCount}`);
  console.log(`  customers.gift_basket          [${before.customer?.giftBasket.join(", ")}]`);
  console.log(`  referral_codes.used_count      ${before.code?.usedCount}`);
  console.log(`  referral_codes.holding_count   ${before.code?.holdingCount}`);
  if (kpiBefore)
    console.log(`  kpi_scores ${kpiBefore.yearMonth}         ngân hàng ${kpiBefore.banking}`);

  // Cảnh báo đứng TRƯỚC lượt ghi: rổ quà đã phát đóng băng trong
  // `gift_grants.snapshot`, không lượt tính lại nào sửa được nó.
  if (grant)
    console.log(
      `\n⚠️  Khách ĐÃ nhận quà ngày ${grant.grantedAt.toISOString().slice(0, 10)} — "${grant.chosenItem}".` +
        "\n   `gift_grants.snapshot` đóng băng lúc phát, script này KHÔNG sửa được nó." +
        "\n   Rổ quà tính lại sẽ lệch với rổ đã phát.",
    );

  if (!confirmed) {
    console.log("\nChạy thử, chưa ghi gì. Thêm --yes để xoá thật.");
    process.exit(0);
  }

  await db.delete(bankAccounts).where(eq(bankAccounts.id, id));
  console.log("\nĐã xoá dòng bank_accounts.");

  /**
   * Chỉ dòng `done` mới nằm trong điểm KPI và rổ quà — `scoringAccountsOf` và
   * `giftInputFor` đều lọc `status = 'done'`.
   *
   * Dòng `error` là ca CỐ Ý lệch: `markAccountErrorByBankManager` không tính
   * lại rổ quà lúc đánh lỗi, nên rổ hiện tại vẫn là rổ của lúc còn `done`. Gọi
   * tính lại ở đây là ghi đè quyết định đó và co rổ quà của khách — cùng lý do
   * `db:recount-codes` tồn tại tách khỏi `db:recount`.
   */
  if (row.status === "done") {
    await recomputeGiftCase(row.customerId);
    console.log("Đã tính lại rổ quà của khách.");
    if (yearMonth) {
      await recomputeKpiForCustomer(row.customerId, yearMonth);
      console.log(`Đã tính lại điểm KPI tháng ${yearMonth} cho chủ hồ sơ khách.`);
    }
  } else {
    console.log(
      `Bỏ qua rổ quà và điểm KPI: dòng ở trạng thái '${row.status}', không nằm trong hai phép tính đó.`,
    );
  }

  const after = await countsOf(row.customerId, row.referralCodeId);
  const kpiAfter = await kpiOf(row.ownerId, yearMonth);

  console.log("\nSố lưu sẵn sau khi xoá:");
  console.log(
    `  customers.account_count        ${before.customer?.accountCount} → ${after.customer?.accountCount}`,
  );
  console.log(
    `  customers.gift_basket          [${before.customer?.giftBasket.join(", ")}] → [${after.customer?.giftBasket.join(", ")}]`,
  );
  console.log(
    `  referral_codes.used_count      ${before.code?.usedCount} → ${after.code?.usedCount}`,
  );
  console.log(
    `  referral_codes.holding_count   ${before.code?.holdingCount} → ${after.code?.holdingCount}`,
  );
  if (kpiBefore && kpiAfter)
    console.log(
      `  kpi_scores ${kpiAfter.yearMonth}         ngân hàng ${kpiBefore.banking} → ${kpiAfter.banking}`,
    );

  if (photos.length > 0)
    console.log(
      `\nCòn lại thủ công: ${photos.length} file ảnh trong kho không ai xoá, dòng audit_log cũ trỏ tới id đã mất.`,
    );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
