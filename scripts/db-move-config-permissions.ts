import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { Action } from "../src/lib/types";

/**
 * Dời quyền cấu hình về module `system`, và thu hồi chúng khỏi Trưởng/Phó phòng.
 *
 * Chạy MỘT LẦN sau khi cập nhật `lib/roles.ts` và `lib/types.ts` (chốt
 * 2026-08-24). `ROLE_PERMISSIONS` chỉ áp lúc TẠO người, nên sửa file không đụng
 * tới tài khoản đã có — dòng quyền cũ vẫn nằm nguyên trong `user_permissions`.
 *
 * Các dòng cần xử lý:
 *
 *   `*:<hành động cấu hình>`       →  vai quản lý phòng: XOÁ · vai khác: đổi thành `system`
 *   `insurance:configure-catalog`  →  đổi module thành `system`
 *   `services:configure-catalog`   →  đổi module thành `system`
 *   `banking:manage-bank-catalog`  →  đổi module thành `system`
 *   `banking:manage-referral-codes`→  đổi module thành `system`
 *
 * ⚠️ KHÔNG đụng tài khoản TOÀN QUYỀN. Bộ toàn quyền là một dòng `*` cho MỌI
 * hành động; rút bốn dòng trong số đó ra là phá bộ, và công tắc "Toàn quyền" ở
 * P-92 sẽ hiện TẮT trong khi người đó vẫn giữ mọi quyền còn lại.
 *
 * Nhận diện bằng số dòng `*` phải ĐỦ số hành động, không phải "nhiều hơn bốn":
 * tài khoản quản trị hệ thống mang 4 dòng `*` (`view-detail`, `update`, hai
 * quyền cấu hình) và nó KHÔNG phải toàn quyền — bỏ qua nó là bỏ sót đúng tài
 * khoản cần dời.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun --env-file=.env.local scripts/db-move-config-permissions.ts --dry-run
 *
 * Ghi thật thì BẮT BUỘC khai tên đăng nhập của người chịu trách nhiệm:
 *   bun --env-file=.env.local scripts/db-move-config-permissions.ts --as=admin
 */

/** Bốn hành động cấu hình phải nằm ở module `system`. */
const CONFIG_ACTIONS = [
  "configure-catalog",
  "configure-gift-rules",
  "manage-bank-catalog",
  "manage-referral-codes",
];

/** Số dòng `*` của một bộ TOÀN QUYỀN — đọc từ `lib/types.ts`, không gõ số cứng. */
const FULL_ACCESS_ROWS = Action.options.length;

/** Vai bị thu hồi hẳn, không dời sang `system`. */
const REVOKE_ROLES = ["head", "deputy-head"];

type Row = {
  userId: string;
  name: string;
  username: string;
  role: string;
  module: string;
  action: string;
  scope: string;
  wildcardCount: number;
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  /**
   * `wildcard_count` đếm TỔNG số dòng `*` của người đó, không phải số dòng khớp
   * `CONFIG_ACTIONS` — đó là cách duy nhất phân biệt "toàn quyền" với "vai quản
   * lý mang đúng ba dòng `*` của bộ cũ".
   *
   * Danh sách hành động nối từ `CONFIG_ACTIONS`, không gõ lại trong câu SQL:
   * gõ hai lần là có ngày sửa một chỗ quên chỗ kia, và đã xảy ra đúng vậy.
   */
  const { rows } = (await db.execute(sql`
    select
      p.user_id, u.full_name, u.username, u.role, p.module, p.action, p.scope,
      (select count(*) from user_permissions w where w.user_id = p.user_id and w.module = '*') as wildcard_count
    from user_permissions p
    join users u on u.id = p.user_id
    where p.action in (${sql.join(
      CONFIG_ACTIONS.map((a) => sql`${a}::action_key`),
      sql`, `,
    )})
      and p.module <> 'system'
    order by u.full_name, p.action
  `)) as unknown as { rows: Record<string, unknown>[] };

  const all: Row[] = rows.map((r) => ({
    userId: String(r.user_id),
    name: String(r.full_name),
    username: String(r.username),
    role: String(r.role),
    module: String(r.module),
    action: String(r.action),
    scope: String(r.scope),
    wildcardCount: Number(r.wildcard_count),
  }));

  // Toàn quyền = MỌI hành động trên `*`. Bỏ qua trọn tài khoản đó.
  const isFullAccess = (r: Row) => r.module === "*" && r.wildcardCount >= FULL_ACCESS_ROWS;
  const fullAccess = all.filter(isFullAccess);
  const touched = all.filter((r) => !isFullAccess(r));

  const toRevoke = touched.filter((r) => REVOKE_ROLES.includes(r.role));
  const toMove = touched.filter((r) => !REVOKE_ROLES.includes(r.role));

  if (fullAccess.length > 0) {
    const names = [...new Set(fullAccess.map((r) => r.name))];
    console.log(`Bỏ qua ${names.length} tài khoản toàn quyền: ${names.join(", ")}`);
  }

  console.log(`\nTHU HỒI (${toRevoke.length} dòng) — Trưởng phòng, Phó phòng:`);
  for (const r of toRevoke) console.log(`  ${r.name} (${r.username}, ${r.role})  ${r.module}:${r.action}`);

  console.log(`\nDỜI SANG system (${toMove.length} dòng):`);
  for (const r of toMove) console.log(`  ${r.name} (${r.username}, ${r.role})  ${r.module}:${r.action} → system:${r.action}`);

  if (toRevoke.length === 0 && toMove.length === 0) {
    console.log("\nKhông có dòng nào phải sửa.");
    await pool.end();
    return;
  }

  if (dryRun) {
    console.log("\n--dry-run: không ghi gì.");
    await pool.end();
    return;
  }

  if (!asArg) {
    console.error(
      "\nThiếu --as=<tên đăng nhập>. Đổi quyền phải có người chịu trách nhiệm, và tên đó đi vào nhật ký truy vết.",
    );
    await pool.end();
    process.exit(1);
  }

  const actorRows = (await db.execute(
    sql`select id from users where username = ${asArg} and active limit 1`,
  )) as unknown as { rows: { id: string }[] };
  const actorId = actorRows.rows[0]?.id;
  if (!actorId) {
    console.error(`Không tìm thấy tài khoản đang hoạt động nào có tên đăng nhập "${asArg}".`);
    await pool.end();
    process.exit(1);
  }

  // Bảng không có cột `id`; khoá chính là bộ ba (user_id, module, action).
  const dropRow = (r: Row) =>
    db.execute(sql`
      delete from user_permissions
      where user_id = ${r.userId} and module = ${r.module}::module_key and action = ${r.action}::action_key
    `);

  for (const r of toRevoke) await dropRow(r);

  /**
   * Dời bằng XOÁ rồi CHÈN, không `update ... set module = 'system'`.
   *
   * Người đang có cả `banking:manage-bank-catalog` lẫn một dòng `system` cùng
   * hành động thì `update` đụng khoá duy nhất `(user_id, module, action)` và cả
   * lệnh dừng giữa chừng. `on conflict do nothing` bỏ qua đúng ca đó.
   */
  for (const r of toMove) {
    await dropRow(r);
    await db.execute(sql`
      insert into user_permissions (user_id, module, action, scope)
      values (${r.userId}, 'system'::module_key, ${r.action}::action_key, ${r.scope}::scope_key)
      on conflict (user_id, module, action) do nothing
    `);
  }

  const byUser = new Map<string, { name: string; lines: string[] }>();
  for (const r of toRevoke) {
    const kept = byUser.get(r.userId) ?? { name: r.name, lines: [] };
    kept.lines.push(`thu hồi ${r.module}:${r.action}`);
    byUser.set(r.userId, kept);
  }
  for (const r of toMove) {
    const kept = byUser.get(r.userId) ?? { name: r.name, lines: [] };
    kept.lines.push(`${r.module}:${r.action} → system:${r.action}`);
    byUser.set(r.userId, kept);
  }
  for (const [userId, entry] of byUser) {
    await db.execute(sql`
      insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
      values (
        ${actorId}, 'system'::module_key, 'grant-permission'::action_key,
        ${`db:move-config-permissions ${entry.name}: ${entry.lines.join(", ")}`},
        'user_permissions', ${userId}
      )
    `);
  }

  await pool.end();
  console.log(
    `\nXong: thu hồi ${toRevoke.length} dòng, dời ${toMove.length} dòng — đã ghi nhật ký truy vết.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
