import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Cấp hai quyền phôi bảo hiểm cho tài khoản đã có trong database (migration 0154):
 *
 *   - Tài khoản TOÀN QUYỀN: `*:allocate-blanks` và `*:split-blanks`, phạm vi `company`.
 *     Thiếu thì `isFullAccess` không còn đúng và lưới cấp quyền thôi hiện "Toàn quyền".
 *   - Trưởng phòng đang làm: `insurance:split-blanks`, phạm vi `managed`, khớp `lib/roles.ts`.
 *
 * Vì sao là script chứ không phải migration: Postgres cấm dùng giá trị enum vừa
 * thêm trong cùng transaction với `ALTER TYPE … ADD VALUE`. Cùng lối với
 * `db-grant-exclude-department-points.ts`.
 *
 * Văn phòng cần quyền "Cấp phôi cho phòng" thì cấp tay ở lưới cấp quyền.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:grant-insurance-blanks -- --dry-run
 *
 * Ghi thật thì BẮT BUỘC khai tên đăng nhập của người chịu trách nhiệm:
 *   bun run db:grant-insurance-blanks -- --as=admin
 *
 * Chạy lại được: đã có dòng nào thì bỏ qua dòng đó.
 */

type Grant = { id: string; full_name: string; module: string; action: string; scope: string };

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const grants = await db.execute<Grant>(sql`
    with wanted as (
      select u.id, u.full_name, '*' as module, a.action, 'company' as scope
      from users u
      cross join (values ('allocate-blanks'), ('split-blanks')) as a(action)
      where u.active
        and exists (
          select 1 from user_permissions p
          where p.user_id = u.id and p.module = '*'
            and p.action = 'grant-permission' and p.scope = 'company'
        )
      union all
      select u.id, u.full_name, 'insurance', 'split-blanks', 'managed'
      from users u
      where u.active and u.role = 'head'
    )
    select w.* from wanted w
    where not exists (
      select 1 from user_permissions p
      where p.user_id = w.id and p.module::text = w.module and p.action::text = w.action
    )
    order by w.full_name, w.action`);

  if (grants.rows.length === 0) {
    console.log("Mọi tài khoản cần quyền phôi bảo hiểm đã có quyền.");
    await pool.end();
    return;
  }

  console.log(`${grants.rows.length} quyền sắp cấp${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}:`);
  for (const g of grants.rows) console.log(`  ${g.full_name} · ${g.module}:${g.action} (${g.scope})`);

  if (dryRun) {
    await pool.end();
    return;
  }

  if (!asArg) {
    console.error(
      "Thiếu --as=<tên đăng nhập>. Cấp quyền phải có người chịu trách nhiệm, và tên đó đi vào nhật ký truy vết.\nVí dụ:  bun run db:grant-insurance-blanks -- --as=admin",
    );
    await pool.end();
    process.exit(1);
  }

  const actor = await db.execute<{ id: string }>(sql`select id from users where username = ${asArg} and active limit 1`);
  const actorId = actor.rows[0]?.id;
  if (!actorId) {
    console.error(`Không tìm thấy tài khoản đang hoạt động nào có tên đăng nhập "${asArg}".`);
    await pool.end();
    process.exit(1);
  }

  for (const g of grants.rows) {
    await db.execute(sql`
      insert into user_permissions (user_id, module, action, scope)
      values (${g.id}, ${g.module}::module_key, ${g.action}::action_key, ${g.scope}::scope_key)
      on conflict (user_id, module, action) do nothing
    `);
    await db.execute(sql`
      insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
      values (
        ${actorId}, 'system'::module_key, 'grant-permission'::action_key,
        ${`db:grant-insurance-blanks cấp ${g.module}:${g.action} (${g.scope}) cho ${g.full_name}`},
        'user_permissions', ${g.id}
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
