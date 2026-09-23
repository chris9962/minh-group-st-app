import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Cấp `*:close-salary` cho các tài khoản TOÀN QUYỀN đã có trong database.
 *
 * `system:close-salary` mở nút Chốt lương trên màn Nhân sự & KPI.
 *
 * Vì sao là script chứ không phải migration: drizzle bọc cả loạt migration vào
 * MỘT transaction, mà Postgres cấm dùng giá trị enum vừa thêm trong cùng
 * transaction với `ALTER TYPE … ADD VALUE` (migration 0102 thêm `'close-salary'`).
 * Cùng lối với `db-grant-view-ops.ts`.
 *
 * Vì sao phải cấp bù: `isFullAccess` đòi đủ MỌI hành động trên `*` phạm vi
 * `company`. Thêm một hành động vào enum là mọi tài khoản toàn quyền hiện có
 * thiếu đúng một dòng, và họ rớt khỏi trạng thái toàn quyền ở lưới P-92 mà
 * không có gì báo.
 *
 * Kế toán hay người khác cần chốt lương thì cấp tay ở P-92.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:grant-close-salary -- --dry-run
 *
 * Ghi thật thì BẮT BUỘC khai tên đăng nhập của người chịu trách nhiệm:
 *   bun run db:grant-close-salary -- --as=admin
 *
 * Chạy lại được: đã có dòng nào thì bỏ qua dòng đó.
 */

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const people = await db.execute<{ id: string; full_name: string }>(
    sql`select u.id, u.full_name from users u
        where u.active
          and exists (
            select 1 from user_permissions p
            where p.user_id = u.id and p.module = '*'
              and p.action = 'grant-permission' and p.scope = 'company'
          )
          and not exists (
            select 1 from user_permissions p
            where p.user_id = u.id and p.module = '*' and p.action = 'close-salary'
          )
        order by u.full_name`,
  );

  if (people.rows.length === 0) {
    console.log("Mọi tài khoản toàn quyền đang hoạt động đã có `*:close-salary`.");
    await pool.end();
    return;
  }

  console.log(`${people.rows.length} quyền sắp cấp${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}:`);
  for (const p of people.rows) console.log(`  ${p.full_name} · *:close-salary (company)`);

  if (dryRun) {
    await pool.end();
    return;
  }

  if (!asArg) {
    console.error(
      "Thiếu --as=<tên đăng nhập>. Cấp quyền phải có người chịu trách nhiệm, và tên đó đi vào nhật ký truy vết.\nVí dụ:  bun run db:grant-close-salary -- --as=admin",
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

  for (const p of people.rows) {
    await db.execute(sql`
      insert into user_permissions (user_id, module, action, scope)
      values (${p.id}, '*'::module_key, 'close-salary'::action_key, 'company'::scope_key)
      on conflict (user_id, module, action) do nothing
    `);
    await db.execute(sql`
      insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
      values (
        ${actorId}, 'system'::module_key, 'grant-permission'::action_key,
        ${`db:grant-close-salary cấp *:close-salary (company) cho ${p.full_name}`},
        'user_permissions', ${p.id}
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
