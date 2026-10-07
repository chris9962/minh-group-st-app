import { inArray } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { users } from "../src/server/db/schema";

/**
 * Gán thời hạn bản nháp tài khoản ngân hàng 60 phút cho danh sách nhân viên
 * chủ dự án gửi ngày 2026-10-07. Người khác giữ mặc định 30 phút.
 *
 * Chạy khô, in những gì sẽ ghi:
 *   bun run db:set-draft-ttl
 * Ghi thật:
 *   bun run db:set-draft-ttl -- --apply
 *
 * Là script chứ không nằm trong migration: danh sách người là dữ liệu của công
 * ty, đổi theo thời gian. Thêm bớt người thì sửa `USERNAMES` rồi chạy lại. Thiếu
 * một mã nhân viên thì dừng, không ghi gì. Chạy lại nhiều lần vô hại. Cần
 * migration 0129.
 */

const TTL_MINUTES = 60;

const USERNAMES = [
  "516longlb", // Lê Bá Long
  "517oanhtth", // Trần Thị Hoàng Oanh
  "518quangnt", // Nguyễn Thanh Quang
  "519tainlm", // Nguyễn Lý Minh Tài
  "520nganttc", // Trần Thị Cẩm Ngân
  "521loidtp", // Đỗ Trường Phước Lợi
  "522hangnt", // Nguyễn Thanh Hằng
  "523tunht", // Nguyễn Hoàng Thái Tú
  "525hoanntk", // Nguyễn Trần Kim Hoàn
  "526nhungqth", // Quách Thị Hồng Nhung
  "527nhonqt", // Quách Thành Nhơn
  "528phuph", // Phạm Hoàng Phú
  "529namlq", // Lê Quốc Nam
  "531tamnv", // Nguyễn Văn Tâm
  "532tuyenttt", // Tạ Thị Thanh Tuyền
  "533huongntk", // Nguyễn Thị Kim Hương
  "534thupta", // Phan Thị Anh Thư
  "535linhnta", // Nguyễn Thị Ánh Linh
  "536duytn", // Trần Nhất Duy
  "537huynq", // Nguyễn Quốc Huy
  // Ba người dưới chủ dự án gửi theo tên, mã tra trên production 2026-10-07.
  "508thuycnp", // Cao Nguyễn Phương Thuỳ
  "471nguyenltn", // Lê Trần Nam Nguyễn
  "509hoadtc", // Dương Thị Cẩm Hoà
];

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await db
    .select({ id: users.id, username: users.username, fullName: users.fullName, ttl: users.draftTtlMinutes })
    .from(users)
    .where(inArray(users.username, USERNAMES));

  const found = new Set(rows.map((r) => r.username));
  const missing = USERNAMES.filter((u) => !found.has(u));
  if (missing.length > 0) throw new Error(`Không tìm thấy mã nhân viên: ${missing.join(", ")}. Không ghi gì.`);

  for (const r of rows)
    console.log(`  ${r.username.padEnd(14)} ${r.fullName.padEnd(26)} ${r.ttl ?? "mặc định"} -> ${TTL_MINUTES} phút`);
  console.log(`${rows.length} người${apply ? "" : " (CHẠY KHÔ, không ghi gì)"}.`);
  if (!apply) {
    console.log("Thêm --apply để ghi.");
    process.exit(0);
  }

  await db.update(users).set({ draftTtlMinutes: TTL_MINUTES }).where(inArray(users.username, USERNAMES));
  console.log(`Đã gán ${TTL_MINUTES} phút cho ${rows.length} người.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
