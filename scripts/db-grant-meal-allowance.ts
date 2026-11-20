import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Cấp quyền Lương ăn ca lúc deploy (migration 0184, chủ dự án chốt 2026-11-20):
 *
 *   - Trưởng phòng đang làm                 → `salary:approve-meal` phạm vi `managed`. Phó phòng không cấp.
 *   - người đang có `salary:pay-advance`    → `salary:pay-meal`
 *   - người đang có `*:pay-advance`         → `*:pay-meal`
 *   - tài khoản TOÀN QUYỀN                 → `*:approve-meal`, không thì `isFullAccess` thôi đúng
 *
 * Vì sao là script chứ không phải migration: Postgres cấm dùng giá trị enum vừa
 * thêm trong cùng transaction với `ALTER TYPE … ADD VALUE`.
 *
 * Chỉ chạy MỘT lần: chạy lại sau khi chủ dự án gỡ quyền của ai đó là cấp lại
 * cho người đó. Script dừng khi nhật ký truy vết đã có dòng do chính nó ghi.
 *
 * Mặc định chạy khô, in danh sách, không ghi gì:
 *   bun run db:grant-meal-allowance
 *
 * Ghi thật, khai tên đăng nhập của người chịu trách nhiệm:
 *   bun run db:grant-meal-allowance -- --apply --as=admin
 */

type Row = { id: string; full_name: string; module: string; action: string; scope: string };

const AUDIT_PREFIX = "db:grant-meal-allowance";

const FULL_ACCESS = sql`exists (
  select 1 from user_permissions f
  where f.user_id = u.id and f.module = '*' and f.action = 'grant-permission' and f.scope = 'company'
)`;

async function main() {
  const apply = process.argv.includes("--apply");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt, tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const ran = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from audit_log where target_label like ${`${AUDIT_PREFIX} %`}`,
  );
  if ((ran.rows[0]?.n ?? 0) > 0) {
    console.log(`Nhật ký truy vết đã có ${ran.rows[0]!.n} dòng của ${AUDIT_PREFIX}. Script không chạy lại.`);
    await pool.end();
    return;
  }

  const grants = await db.execute<Row>(sql`
    with wanted as (
      select u.id, u.full_name, 'salary' as module, 'approve-meal' as action, 'managed' as scope
      from users u
      where u.role = 'head' and u.active
      union all
      select u.id, u.full_name, p.module::text, 'pay-meal', 'company'
      from users u
      join user_permissions p on p.user_id = u.id
      where p.module in ('salary', '*') and p.action = 'pay-advance'
      union all
      select u.id, u.full_name, '*', 'approve-meal', 'company'
      from users u
      where ${FULL_ACCESS}
    )
    select w.* from wanted w
    where not exists (
      select 1 from user_permissions p
      where p.user_id = w.id and p.module::text = w.module and p.action::text = w.action
    )
    order by w.action, w.full_name`);

  // Phạm vi `managed` đọc danh sách phòng quản; thiếu phòng của chính họ thì họ không thấy dòng nào.
  const blind = await db.execute<{ full_name: string; department: string | null }>(sql`
    select u.full_name, d.name as department
    from users u
    left join departments d on d.id = u.department_id
    where u.role = 'head' and u.active
      and not exists (
        select 1 from user_managed_departments m
        where m.user_id = u.id and m.department_id = u.department_id
      )
    order by u.full_name`);

  console.log(`${grants.rows.length} quyền sắp cấp${apply ? "" : " (CHẠY KHÔ, không ghi gì)"}:`);
  for (const g of grants.rows) console.log(`  + ${g.full_name} - ${g.module}:${g.action} (${g.scope})`);
  console.log(`${blind.rows.length} Trưởng phòng có danh sách phòng quản không gồm phòng của chính họ:`);
  for (const b of blind.rows) console.log(`  ! ${b.full_name} - ${b.department ?? "không thuộc phòng nào"}`);

  if (!apply) {
    console.log("Chạy khô xong. Ghi thật: thêm --apply --as=<tên đăng nhập>.");
    await pool.end();
    return;
  }

  if (!asArg) {
    console.error(
      "Thiếu --as=<tên đăng nhập>. Cấp quyền phải có người chịu trách nhiệm, và tên đó đi vào nhật ký truy vết.\nVí dụ:  bun run db:grant-meal-allowance -- --apply --as=admin",
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

  await db.transaction(async (tx) => {
    for (const g of grants.rows) {
      await tx.execute(sql`
        insert into user_permissions (user_id, module, action, scope)
        values (${g.id}, ${g.module}::module_key, ${g.action}::action_key, ${g.scope}::scope_key)
        on conflict (user_id, module, action) do nothing`);
      await tx.execute(sql`
        insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
        values (${actorId}, 'system'::module_key, 'grant-permission'::action_key,
          ${`${AUDIT_PREFIX} cấp ${g.module}:${g.action} (${g.scope}) cho ${g.full_name}`}, 'user_permissions', ${g.id})`);
    }
  });

  await pool.end();
  console.log("Xong, đã ghi nhật ký truy vết.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
