import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Cấp bù `configure-wards` (migration 0072) cho tài khoản đã có trong database.
 *
 * Hai nhóm, mỗi nhóm một dòng:
 *
 *   Phó giám đốc đang hoạt động   →  `system:configure-wards` (company), khớp
 *                                     `deputyDirectorPermissions` ở `lib/roles.ts`
 *   Tài khoản toàn quyền           →  `*:configure-wards` (company), vì
 *                                     `isFullAccess` đòi đủ MỌI hành động trên `*`
 *
 * Vì sao là script chứ không phải migration: cùng lý do với
 * `db-grant-department-read.ts` — drizzle bọc cả loạt migration vào MỘT
 * transaction, mà Postgres cấm dùng giá trị enum vừa thêm trong cùng
 * transaction với `ALTER TYPE … ADD VALUE`.
 *
 * Mốc nhận diện tài khoản toàn quyền là `*:grant-permission` phạm vi `company`:
 * hành động duy nhất KHÔNG bao giờ được cấp tự động (xem `db-grant-adjust-kpi.ts`).
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:grant-configure-wards -- --dry-run
 *
 * Ghi thật thì BẮT BUỘC khai tên đăng nhập của người chịu trách nhiệm — nó vào
 * `audit_log` để tháng sau còn tra được quyền tới từ đâu:
 *   bun run db:grant-configure-wards -- --as=admin
 *
 * Chạy lại được: đã có dòng nào thì bỏ qua dòng đó.
 */

type Grant = { userId: string; name: string; module: "system" | "*" };

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const deputies = await db.execute<{ id: string; full_name: string }>(
    sql`select u.id, u.full_name from users u
        where u.role = 'deputy-director' and u.active
          and not exists (
            select 1 from user_permissions p
            where p.user_id = u.id and p.module = 'system' and p.action = 'configure-wards'
          )
        order by u.full_name`,
  );

  const fullAccess = await db.execute<{ id: string; full_name: string }>(
    sql`select u.id, u.full_name from users u
        where u.active
          and exists (
            select 1 from user_permissions p
            where p.user_id = u.id and p.module = '*'
              and p.action = 'grant-permission' and p.scope = 'company'
          )
          and not exists (
            select 1 from user_permissions p
            where p.user_id = u.id and p.module = '*' and p.action = 'configure-wards'
          )
        order by u.full_name`,
  );

  const toAdd: Grant[] = [
    ...deputies.rows.map((r) => ({ userId: r.id, name: r.full_name, module: "system" as const })),
    ...fullAccess.rows.map((r) => ({ userId: r.id, name: r.full_name, module: "*" as const })),
  ];

  if (toAdd.length === 0) {
    console.log("Mọi Phó giám đốc và tài khoản toàn quyền đang hoạt động đã có `configure-wards`.");
    await pool.end();
    return;
  }

  // In ra TỪNG dòng sắp cấp trước khi ghi. Cấp quyền im lặng hàng loạt là thứ
  // không ai muốn phát hiện sau, lúc đọc nhật ký truy vết.
  console.log(`${toAdd.length} quyền sắp cấp${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}:`);
  for (const g of toAdd) console.log(`  ${g.name} · ${g.module}:configure-wards (company)`);

  if (dryRun) {
    await pool.end();
    return;
  }

  if (!asArg) {
    console.error(
      "Thiếu --as=<tên đăng nhập>. Cấp quyền phải có người chịu trách nhiệm, và tên đó đi vào nhật ký truy vết.\nVí dụ:  bun run db:grant-configure-wards -- --as=admin",
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
    await db.execute(sql`
      insert into user_permissions (user_id, module, action, scope)
      values (${g.userId}, ${g.module}::module_key, 'configure-wards'::action_key, 'company'::scope_key)
      on conflict (user_id, module, action) do nothing
    `);
    await db.execute(sql`
      insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
      values (
        ${actorId}, 'system'::module_key, 'grant-permission'::action_key,
        ${`db:grant-configure-wards cấp ${g.module}:configure-wards (company) cho ${g.name}`},
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
