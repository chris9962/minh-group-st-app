import { and, eq } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { zaloOutbox } from "../src/server/db/schema";
import { enqueueZaloGroupText } from "../src/server/zaloBot";
import { RELEASES, type Release } from "../src/lib/releases";

/**
 * Báo bản cập nhật MỚI NHẤT vào nhóm Zalo của công ty, dạng
 * "Cập nhật ngày 12/10/2026 https://app.mgst.com.vn/releases/2026-10-12".
 * `db-announce-release.ts` gọi hàm này sau khi gửi thông báo trong app; chạy
 * riêng được:
 *
 *   bun --env-file=.env.local scripts/zalo-announce-release.ts
 *   bun --env-file=.env.local scripts/zalo-announce-release.ts --dry-run
 *
 * Tin vào `zalo_outbox`, worker bot Zalo gửi đi. Bot chưa đăng nhập thì tin
 * nằm chờ tới lúc đăng nhập.
 *
 * Chạy lại được: nhóm đã có đúng nội dung này trong hàng chờ thì không thêm.
 */
const RELEASE_GROUP_ID = "673549101771269815";
const APP_ORIGIN = "https://app.mgst.com.vn";

export async function announceReleaseToZalo(release: Release, dryRun: boolean): Promise<void> {
  const body = `${release.title} ${APP_ORIGIN}/releases/${release.id}`;

  const [queued] = await db
    .select({ id: zaloOutbox.id })
    .from(zaloOutbox)
    .where(and(eq(zaloOutbox.threadId, RELEASE_GROUP_ID), eq(zaloOutbox.body, body)))
    .limit(1);
  if (queued) {
    console.log(`Nhóm Zalo ${RELEASE_GROUP_ID} đã có tin bản ${release.id}, không gửi lại.`);
    return;
  }

  console.log(`Gửi nhóm Zalo ${RELEASE_GROUP_ID}: "${body}"${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}.`);
  if (dryRun) return;

  await enqueueZaloGroupText([RELEASE_GROUP_ID], body);
  console.log("Đã đưa tin vào hàng chờ của bot Zalo.");
}

// Chỉ tự chạy khi gọi thẳng file này; `db-announce-release.ts` import vào thì không.
if (process.argv[1]?.endsWith("zalo-announce-release.ts")) {
  const release = RELEASES[0];
  if (!release) throw new Error("RELEASES rỗng, chưa có bản nào để gửi");
  announceReleaseToZalo(release, process.argv.includes("--dry-run"))
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
