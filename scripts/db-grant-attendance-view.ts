import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Cấp `attendance:view-detail` (migration 0118) phạm vi `managed` cho người xem
 * bảng chấm công Điểm ATM (chốt 2026-10-02): Trưởng phòng, Phó phòng và Phó
 * giám đốc đang hoạt động có quản phòng Dự án. Tài khoản toàn quyền đã xem được
 * qua `*`, không cần cấp.
 *
 * Script chứ không phải migration: drizzle bọc cả loạt migration vào MỘT
 * transaction, mà Postgres cấm dùng giá trị enum vừa thêm trong cùng
 * transaction với `ALTER TYPE … ADD VALUE`.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:grant-attendance-view -- --dry-run
 *
 * Ghi thật thì BẮT BUỘC khai tên đăng nhập của người chịu trách nhiệm:
 *   bun run db:grant-attendance-view -- --as=admin
 *
 * Chạy lại được: đã có dòng nào thì bỏ qua dòng đó.
 */

const DEPARTMENT_CODE = "PHONG-DU-AN";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const toAdd = await db.execute<{ id: string; full_name: string; role: string }>(
    sql`select u.id, u.full_name, u.role from users u
        where u.active
          and u.role in ('head', 'deputy-head', 'deputy-director')
          and exists (
            select 1 from user_managed_departments m
            join departments d on d.id = m.department_id
            where m.user_id = u.id and d.code = ${DEPARTMENT_CODE}
          )
          and not exists (
            select 1 from user_permissions p
            where p.user_id = u.id and p.module = 'attendance' and p.action = 'view-detail'
          )
        order by u.role, u.full_name`,
  );

  if (toAdd.rows.length === 0) {
    console.log("Mọi người quản phòng Dự án đã có quyền xem chấm công.");
    await pool.end();
    return;
  }

  console.log(`${toAdd.rows.length} quyền sắp cấp${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}:`);
  for (const r of toAdd.rows) console.log(`  ${r.full_name} (${r.role}) · attendance:view-detail (managed)`);

  if (dryRun) {
    await pool.end();
    return;
  }

  if (!asArg) {
    console.error(
      "Thiếu --as=<tên đăng nhập>. Cấp quyền phải có người chịu trách nhiệm, và tên đó đi vào nhật ký truy vết.\nVí dụ:  bun run db:grant-attendance-view -- --as=admin",
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

  for (const r of toAdd.rows) {
    await db.execute(sql`
      insert into user_permissions (user_id, module, action, scope)
      values (${r.id}, 'attendance'::module_key, 'view-detail'::action_key, 'managed'::scope_key)
      on conflict (user_id, module, action) do nothing
    `);
    await db.execute(sql`
      insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
      values (
        ${actorId}, 'system'::module_key, 'grant-permission'::action_key,
        ${`db:grant-attendance-view cấp attendance:view-detail (managed) cho ${r.full_name}`},
        'user_permissions', ${r.id}
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
