import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { bankAccountPhotos, bankAccounts, banks, referralCodes, users } from "../src/server/db/schema";
import { notify, notifyEveryone } from "../src/server/notifications";
import { MAX_DRAFTS_PER_STAFF_PER_BANK } from "../src/lib/api/bankAccounts";

/**
 * Cưỡng chế trần bản nháp theo người mở (BGĐ chốt 2026-09-16), chạy MỘT LẦN
 * cho các bản nháp mở trước khi luật lên máy chủ. Từ đó `startBankAccount` tự
 * chặn, script này không cần chạy lại.
 *
 * Mỗi nhân viên ở mỗi ngân hàng giữ lại tối đa `MAX_DRAFTS_PER_STAFF_PER_BANK`
 * dòng `creating`; phần dư bị xoá. Giữ dòng CÓ ẢNH trước, rồi dòng mở SAU: bản
 * nháp đã tải ảnh là bản nhân viên đang làm dở.
 *
 * Chủ mỗi dòng bị xoá nhận một thông báo. Có `--announce` thì gửi thêm thông
 * báo chung về luật cho mọi nhân viên đang hoạt động.
 *
 *   bun --env-file=.env.local scripts/db-trim-drafts-per-bank.ts --dry-run
 *   bun --env-file=.env.local scripts/db-trim-drafts-per-bank.ts [--announce]
 */

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const announce = process.argv.includes("--announce");

  const photoCount = sql<number>`(select count(*) from ${bankAccountPhotos} where ${bankAccountPhotos.accountId} = ${bankAccounts.id})::int`;
  const drafts = await db
    .select({
      id: bankAccounts.id,
      bankId: bankAccounts.bankId,
      bankCode: banks.code,
      referralCode: referralCodes.displayName,
      createdBy: bankAccounts.createdBy,
      createdByName: users.fullName,
      photos: photoCount,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .innerJoin(referralCodes, eq(referralCodes.id, bankAccounts.referralCodeId))
    .leftJoin(users, eq(users.id, bankAccounts.createdBy))
    .where(eq(bankAccounts.status, "creating"))
    .orderBy(desc(photoCount), desc(bankAccounts.createdAt), asc(bankAccounts.id));

  const kept = new Map<string, number>();
  const excess = drafts.filter((d) => {
    const key = `${d.createdBy}|${d.bankId}`;
    const n = (kept.get(key) ?? 0) + 1;
    kept.set(key, n);
    return n > MAX_DRAFTS_PER_STAFF_PER_BANK;
  });

  console.log(
    `${excess.length} bản nháp vượt trần ${MAX_DRAFTS_PER_STAFF_PER_BANK}/ngân hàng${dryRun ? " (CHẠY KHÔ — không xoá gì)" : ""}.`,
  );
  for (const d of excess) {
    console.log(`  ${d.id}  ${d.bankCode}  ${d.referralCode}  ảnh=${d.photos}  ${d.createdByName ?? "?"}`);
  }
  if (dryRun) return;

  if (excess.length > 0) {
    // Khoá trạng thái trong chính câu xoá, cùng lối `purgeDraftAccounts`: giữa
    // lúc đọc và lúc xoá, nhân viên có thể vừa bấm Hoàn thành một bản nháp.
    const removed = await db
      .delete(bankAccounts)
      .where(and(inArray(bankAccounts.id, excess.map((d) => d.id)), eq(bankAccounts.status, "creating")))
      .returning({ id: bankAccounts.id });
    const removedIds = new Set(removed.map((r) => r.id));
    console.log(`Đã xoá ${removed.length} dòng.`);

    for (const d of excess) {
      if (!removedIds.has(d.id) || !d.createdBy) continue;
      await notify(d.createdBy, "bank-deleted", {
        title: "Tài khoản đang tạo đã bị xoá",
        body: `${d.bankCode} · ${d.referralCode} · vượt trần ${MAX_DRAFTS_PER_STAFF_PER_BANK} mã đang tạo mỗi ngân hàng`,
        url: "/banking",
      }).catch(() => undefined);
    }
  }

  if (announce) {
    const n = await notifyEveryone({
      title: "Thông báo: tối đa 2 mã đang tạo mỗi ngân hàng",
      body:
        `Từ 2026-09-16, mỗi nhân viên chỉ giữ tối đa ${MAX_DRAFTS_PER_STAFF_PER_BANK} tài khoản Đang tạo ở mỗi ngân hàng. ` +
        "Muốn mở thêm thì hoàn thành hoặc xoá bớt bản đang tạo. Bản đang tạo chưa hoàn thành trong ngày bị xoá lúc 00:00.",
      url: "/banking",
    });
    console.log(`Đã gửi thông báo chung cho ${n} nhân viên.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
