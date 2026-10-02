import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ROLE_PERMISSIONS } from "../src/lib/roles";
import type { Permission, RoleKey } from "../src/lib/types";

/**
 * Cấp bù quyền Tích hợp VNeID cho mọi tài khoản đang hoạt động (chủ dự án chốt
 * 2026-10-02: ai cũng làm được VNeID).
 *
 * Quyền lấy đúng từ `ROLE_PERMISSIONS` ở `lib/roles.ts`, nên mỗi chức vụ nhận
 * cùng phạm vi với tài khoản tạo mới: Nhân viên `own`; Trưởng phòng, Phó phòng,
 * Phó giám đốc `managed`, riêng `create` là `own`. Giám đốc không cần, đã có qua `*`.
 *
 * Bỏ qua dòng người đó đã có, ở `vneid` hoặc ở `*`: quyền admin cấp tay trước đó
 * giữ nguyên, không bị ghi đè.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:grant-vneid -- --dry-run
 *
 * Ghi thật thì BẮT BUỘC khai tên đăng nhập của người chịu trách nhiệm, tên đó
 * vào `audit_log`:
 *   bun run db:grant-vneid -- --as=admin
 *
 * Chạy lại được: đã có dòng nào thì bỏ qua dòng đó.
 */

type Grant = { userId: string; name: string; perms: Permission[] };

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const users = await db.execute<{ id: string; full_name: string; role: RoleKey; has: string[] }>(
    sql`select u.id, u.full_name, u.role,
               coalesce(array_agg(p.action::text) filter (where p.module in ('vneid', '*')), '{}') as has
        from users u
        left join user_permissions p on p.user_id = u.id
        where u.active
        group by u.id, u.full_name, u.role
        order by u.full_name`,
  );

  const toAdd: Grant[] = [];
  for (const u of users.rows) {
    const perms = ROLE_PERMISSIONS[u.role]
      .filter((p) => p.module === "vneid")
      .filter((p) => !u.has.includes(p.action));
    if (perms.length > 0) toAdd.push({ userId: u.id, name: u.full_name, perms });
  }

  if (toAdd.length === 0) {
    console.log("Mọi tài khoản đang hoạt động đã có quyền VNeID theo chức vụ.");
    await pool.end();
    return;
  }

  const rowCount = toAdd.reduce((n, g) => n + g.perms.length, 0);
  console.log(`${toAdd.length} người, ${rowCount} quyền sắp cấp${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}:`);
  for (const g of toAdd)
    console.log(`  ${g.name} · ${g.perms.map((p) => `vneid:${p.action} (${p.scope})`).join(", ")}`);

  if (dryRun) {
    await pool.end();
    return;
  }

  if (!asArg) {
    console.error(
      "Thiếu --as=<tên đăng nhập>. Cấp quyền phải có người chịu trách nhiệm, và tên đó đi vào nhật ký truy vết.\nVí dụ:  bun run db:grant-vneid -- --as=admin",
    );
    await pool.end();
    process.exit(1);
  }

  const actor = await db.execute<{ id: string }>(
    sql`select id from users where username = ${asArg} and active limit 1`,
  );
  const actorId = actor.rows[0]?.id;
  if (!actorId) {
    console.error(`Không tìm thấy tài khoản đang hoạt động nào có tên đăng nhập "${asArg}".`);
    await pool.end();
    process.exit(1);
  }

  for (const g of toAdd) {
    for (const p of g.perms)
      await db.execute(sql`
        insert into user_permissions (user_id, module, action, scope)
        values (${g.userId}, 'vneid'::module_key, ${p.action}::action_key, ${p.scope}::scope_key)
        on conflict (user_id, module, action) do nothing
      `);
    await db.execute(sql`
      insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
      values (
        ${actorId}, 'system'::module_key, 'grant-permission'::action_key,
        ${`db:grant-vneid cấp ${g.perms.map((p) => `vneid:${p.action} (${p.scope})`).join(", ")} cho ${g.name}`},
        'user_permissions', ${g.userId}
      )
    `);
  }

  await pool.end();
  console.log("Cấp xong — đã ghi nhật ký truy vết.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
