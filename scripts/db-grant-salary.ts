import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Chuyển quyền lương cũ sang module Lương (migration 0177, chốt 2026-11-16).
 * Quyền Nhân sự KHÔNG kéo theo quyền Lương: xem lương phòng quản, toàn công ty và
 * xuất lương do chủ dự án tự cấp ở P-92.
 *
 *   - Trưởng phòng, Phó phòng, PGĐ         → `salary:view-detail` phạm vi `managed`
 *   - mọi người còn lại, kể cả đang khoá   → `salary:view-detail` phạm vi `own`
 *   - `system:close-salary`                → `salary:close-salary` và `salary:pay-advance`, rồi xoá dòng cũ
 *   - `staff:approve-advance` phạm vi X    → `salary:approve-advance` phạm vi X, rồi xoá dòng cũ
 *   - tài khoản TOÀN QUYỀN                 → `*:pay-advance`, không thì `isFullAccess` thôi đúng
 *
 * Vì sao là script chứ không phải migration: Postgres cấm dùng giá trị enum vừa
 * thêm trong cùng transaction với `ALTER TYPE … ADD VALUE`.
 *
 * Chỉ chạy MỘT lần: chạy lại sau khi đã gỡ quyền Lương của ai đó là cấp lại cho
 * người đó. Script dừng khi nhật ký truy vết đã có dòng do chính nó ghi. Không
 * dừng theo dòng quyền `salary` có sẵn, vì tài khoản tạo sau deploy đã mang quyền
 * Lương mặc định của chức vụ.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:grant-salary -- --dry-run
 *
 * Ghi thật thì BẮT BUỘC khai tên đăng nhập của người chịu trách nhiệm:
 *   bun run db:grant-salary -- --as=admin
 */

type Row = { id: string; full_name: string; module: string; action: string; scope: string };

const AUDIT_PREFIX = "db:grant-salary";

const FULL_ACCESS = sql`exists (
  select 1 from user_permissions f
  where f.user_id = u.id and f.module = '*' and f.action = 'grant-permission' and f.scope = 'company'
)`;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
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
      select u.id, u.full_name, 'salary' as module, 'view-detail' as action,
        case when u.role in ('head', 'deputy-head', 'deputy-director') then 'managed' else 'own' end as scope
      from users u
      where not ${FULL_ACCESS}
      union all
      select u.id, u.full_name, 'salary', a.action, 'company'
      from users u
      join user_permissions p on p.user_id = u.id
      cross join (values ('close-salary'), ('pay-advance')) as a(action)
      where p.module = 'system' and p.action = 'close-salary'
      union all
      select u.id, u.full_name, 'salary', 'approve-advance', p.scope::text
      from users u
      join user_permissions p on p.user_id = u.id
      where p.module = 'staff' and p.action = 'approve-advance'
      union all
      select u.id, u.full_name, '*', 'pay-advance', 'company'
      from users u
      where ${FULL_ACCESS}
    )
    select w.* from wanted w
    where not exists (
      select 1 from user_permissions p
      where p.user_id = w.id and p.module::text = w.module and p.action::text = w.action
    )
    order by w.full_name, w.module, w.action`);

  const removals = await db.execute<Row>(sql`
    select u.id, u.full_name, p.module::text as module, p.action::text as action, p.scope::text as scope
    from user_permissions p
    join users u on u.id = p.user_id
    where (p.module = 'system' and p.action = 'close-salary')
       or (p.module = 'staff' and p.action = 'approve-advance')
    order by u.full_name, p.module`);

  console.log(`${grants.rows.length} quyền sắp cấp${dryRun ? " (CHẠY KHÔ, không ghi gì)" : ""}:`);
  for (const g of grants.rows) console.log(`  + ${g.full_name} - ${g.module}:${g.action} (${g.scope})`);
  console.log(`${removals.rows.length} quyền cũ sắp xoá:`);
  for (const r of removals.rows) console.log(`  - ${r.full_name} - ${r.module}:${r.action} (${r.scope})`);

  if (dryRun) {
    await pool.end();
    return;
  }

  if (!asArg) {
    console.error(
      "Thiếu --as=<tên đăng nhập>. Cấp quyền phải có người chịu trách nhiệm, và tên đó đi vào nhật ký truy vết.\nVí dụ:  bun run db:grant-salary -- --as=admin",
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

  const audit = (userId: string, label: string) => sql`
    insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
    values (${actorId}, 'system'::module_key, 'grant-permission'::action_key, ${label}, 'user_permissions', ${userId})`;

  await db.transaction(async (tx) => {
    for (const g of grants.rows) {
      await tx.execute(sql`
        insert into user_permissions (user_id, module, action, scope)
        values (${g.id}, ${g.module}::module_key, ${g.action}::action_key, ${g.scope}::scope_key)
        on conflict (user_id, module, action) do nothing`);
      await tx.execute(audit(g.id, `${AUDIT_PREFIX} cấp ${g.module}:${g.action} (${g.scope}) cho ${g.full_name}`));
    }
    for (const r of removals.rows) {
      await tx.execute(sql`
        delete from user_permissions
        where user_id = ${r.id} and module = ${r.module}::module_key and action = ${r.action}::action_key`);
      await tx.execute(audit(r.id, `${AUDIT_PREFIX} bỏ ${r.module}:${r.action} (${r.scope}) của ${r.full_name}, đã chuyển sang module Lương`));
    }
  });

  await pool.end();
  console.log("Xong, đã ghi nhật ký truy vết.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
