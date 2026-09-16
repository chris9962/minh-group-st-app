import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { notifications, users } from "../src/server/db/schema";
import { notifyUsers } from "../src/server/notifications";
import { RELEASES } from "../src/lib/releases";

/**
 * Gửi thông báo bản cập nhật MỚI NHẤT (phần tử đầu của `RELEASES`) cho mọi
 * nhân viên đang hoạt động. Chạy sau khi deploy xong, trên máy chủ:
 *
 *   bun --env-file=.env.local scripts/db-announce-release.ts
 *   bun --env-file=.env.local scripts/db-announce-release.ts --dry-run
 *
 * Vì sao là script chứ không tự gửi lúc app khởi động: database local là bản
 * dump production kèm khoá push thật. Tự gửi lúc khởi động thì mở `bun dev` ở
 * local là đẩy tin tới điện thoại thật của nhân viên.
 *
 * Chạy lại được: đã có dòng `release` nào mang `payload.release` trùng `id`
 * thì coi như đã gửi và dừng. Người mới tạo sau lần gửi không nhận bản cũ,
 * và đó là chủ ý: họ chưa dùng luật cũ nên không cần biết luật đổi gì.
 *
 * ⚠️ KHÔNG hỏi `notification_prefs`, cùng luật với `announcement`: bản cập
 * nhật không cho tắt, xem `SwitchableKind`.
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const release = RELEASES[0];
  if (!release) throw new Error("RELEASES rỗng, chưa có bản nào để gửi");

  const [sent] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.kind, "release"),
        sql`${notifications.payload} ->> 'release' = ${release.id}`,
      ),
    )
    .limit(1);
  if (sent) {
    console.log(`Bản ${release.id} đã gửi rồi, không gửi lại.`);
    return;
  }

  const people = await db.select({ id: users.id }).from(users).where(eq(users.active, true));
  console.log(
    `Bản ${release.id} "${release.title}" sắp gửi cho ${people.length} người${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}.`,
  );
  if (dryRun) return;

  const count = await notifyUsers(
    people.map((p) => p.id),
    "release",
    {
      title: release.title,
      body: release.summary,
      url: `/releases/${release.id}`,
      release: release.id,
    },
  );
  console.log(`Đã gửi cho ${count} người.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
