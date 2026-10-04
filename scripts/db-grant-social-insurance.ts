import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Cấp quyền trang BHYT/BHXH (migration 0121) cho người đang hoạt động của Phòng
 * An Sinh (spec docs/spec-bhyt-bhxh-an-sinh.md mục 1.2).
 *
 * Trưởng phòng, Phó phòng nhận phạm vi `managed`; nhân viên nhận `own`, tức chỉ
 * thấy dòng mình tải lên. Người khác cần thì cấp tay ở P-92.
 *
 * Bỏ qua dòng người đó đã có, ở `social-insurance` hoặc ở `*`.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:grant-social-insurance -- --dry-run
 *
 * Ghi thật thì BẮT BUỘC khai tên đăng nhập của người chịu trách nhiệm:
 *   bun run db:grant-social-insurance -- --as=admin
 *
 * Chạy lại được: đã có dòng nào thì bỏ qua dòng đó.
 */

const DEPARTMENT_CODE = "PHONG-AN-SINH";
const ACTIONS = ["view-detail", "create", "update", "delete", "export"] as const;

type Grant = { userId: string; name: string; scope: "own" | "managed"; actions: string[] };

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const people = await db.execute<{ id: string; full_name: string; role: string; has: string[] }>(
    sql`select u.id, u.full_name, u.role,
               coalesce(array_agg(p.action::text) filter (where p.module in ('social-insurance', '*')), '{}') as has
        from users u
        join departments d on d.id = u.department_id and d.code = ${DEPARTMENT_CODE}
        left join user_permissions p on p.user_id = u.id
        where u.active
        group by u.id, u.full_name, u.role
        order by u.full_name`,
  );

  const toAdd: Grant[] = people.rows
    .map((u) => ({
      userId: u.id,
      name: u.full_name,
      scope: u.role === "head" || u.role === "deputy-head" ? ("managed" as const) : ("own" as const),
      actions: ACTIONS.filter((a) => !u.has.includes(a)),
    }))
    .filter((g) => g.actions.length > 0);

  if (toAdd.length === 0) {
    console.log("Mọi người đang hoạt động của Phòng An Sinh đã có quyền BHYT/BHXH.");
    await pool.end();
    return;
  }

  console.log(`${toAdd.length} người sắp được cấp${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}:`);
  for (const g of toAdd)
    console.log(`  ${g.name} - ${g.actions.map((a) => `social-insurance:${a}`).join(", ")} (${g.scope})`);

  if (dryRun) {
    await pool.end();
    return;
  }

  if (!asArg) {
    console.error(
      "Thiếu --as=<tên đăng nhập>. Cấp quyền phải có người chịu trách nhiệm, và tên đó đi vào nhật ký truy vết.\nVí dụ:  bun run db:grant-social-insurance -- --as=admin",
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
    for (const action of g.actions)
      await db.execute(sql`
        insert into user_permissions (user_id, module, action, scope)
        values (${g.userId}, 'social-insurance'::module_key, ${action}::action_key, ${g.scope}::scope_key)
        on conflict (user_id, module, action) do nothing
      `);
    await db.execute(sql`
      insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
      values (
        ${actorId}, 'system'::module_key, 'grant-permission'::action_key,
        ${`db:grant-social-insurance cấp ${g.actions.join(", ")} (${g.scope}) cho ${g.name}`},
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
