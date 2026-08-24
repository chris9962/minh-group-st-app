import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Tách quyền ngân hàng thành hai, rồi bỏ cột `users.bank_scope`.
 *
 * Chạy MỘT LẦN sau `bun run db:migrate` (migration 0042 thêm giá trị enum).
 *
 * Vì sao là script chứ không phải migration: Postgres không cho dùng một giá
 * trị enum vừa `ADD VALUE` trong CÙNG transaction, mà drizzle bọc trọn lượt
 * migrate vào một transaction. Tách ra hai lượt chạy là cách duy nhất.
 *
 * Ba việc, đúng thứ tự:
 *
 *   1. Ai đang `bank_scope = 'listed'` → đổi `manage-bank` thành
 *      `manage-assigned-banks`. Chỉ dòng `module = 'system'`: dòng `*` thuộc bộ
 *      toàn quyền, rút một dòng ra là công tắc "Toàn quyền" ở P-92 hiện TẮT
 *      trong khi người đó vẫn giữ mọi quyền còn lại.
 *   2. Dọn dòng nối của người `all` — với họ danh sách ngân hàng không có nghĩa.
 *   3. Bỏ cột và kiểu. Không còn nơi nào đọc.
 *
 * Chạy khô:
 *   bun --env-file=.env.local scripts/db-split-bank-permission.ts --dry-run
 *
 * Ghi thật thì bắt buộc khai người chịu trách nhiệm:
 *   bun --env-file=.env.local scripts/db-split-bank-permission.ts --as=admin
 */

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const hasColumn = (
    (await db.execute(sql`
      select 1 from information_schema.columns
      where table_name = 'users' and column_name = 'bank_scope'
    `)) as unknown as { rows: unknown[] }
  ).rows.length > 0;

  if (!hasColumn) {
    console.log("Cột `bank_scope` đã bỏ rồi — lệnh này chạy xong từ trước.");
    await pool.end();
    return;
  }

  const { rows } = (await db.execute(sql`
    select u.username, u.full_name, u.role, u.bank_scope, p.module
    from users u
    join user_permissions p on p.user_id = u.id
    where p.action = 'manage-bank'
    order by u.bank_scope, u.full_name
  `)) as unknown as { rows: Record<string, unknown>[] };

  const listed = rows.filter((r) => r.bank_scope === "listed" && r.module === "system");
  const all = rows.filter((r) => r.bank_scope === "all");

  console.log(`ĐỔI sang manage-assigned-banks (${listed.length} tài khoản):`);
  for (const r of listed) console.log(`  ${r.full_name} (${r.username}, ${r.role})`);

  console.log(`\nGIỮ manage-bank — quản mọi ngân hàng (${all.length} tài khoản):`);
  for (const r of all) console.log(`  ${r.full_name} (${r.username}, ${r.role}) module=${r.module}`);

  if (dryRun) {
    console.log("\n--dry-run: không ghi gì.");
    await pool.end();
    return;
  }

  if (!asArg) {
    console.error("\nThiếu --as=<tên đăng nhập>. Đổi quyền phải có người chịu trách nhiệm.");
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

  await db.execute(sql`
    update user_permissions p
    set action = 'manage-assigned-banks'
    from users u
    where u.id = p.user_id
      and u.bank_scope = 'listed'
      and p.module = 'system'
      and p.action = 'manage-bank'
  `);

  await db.execute(sql`
    delete from user_managed_banks m
    using users u
    where u.id = m.user_id and u.bank_scope = 'all'
  `);

  if (listed.length > 0) {
    await db.execute(sql`
      insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
      values (
        ${actorId}, 'system'::module_key, 'grant-permission'::action_key,
        ${`db:split-bank-permission — ${listed.length} tài khoản chuyển sang manage-assigned-banks`},
        'user_permissions', ${actorId}
      )
    `);
  }

  await db.execute(sql`alter table "users" drop column "bank_scope"`);
  await db.execute(sql`drop type "bank_scope"`);

  await pool.end();
  console.log(`\nXong: ${listed.length} tài khoản chuyển quyền, đã bỏ cột bank_scope.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
