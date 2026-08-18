import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Cấp quyền ĐỌC phòng ban cho các Phó giám đốc đã có trong database.
 *
 * Vì sao là script chứ không phải migration: `drizzle` bọc TOÀN BỘ các file
 * migration đang chờ vào MỘT transaction, mà Postgres cấm dùng một giá trị enum
 * vừa thêm trong cùng transaction với lệnh `ALTER TYPE … ADD VALUE`. Migration
 * 0026 thêm `'department'` vào `module_key`; một câu `INSERT … 'department'` đặt
 * ở file 0027 vẫn nằm chung transaction đó và làm cả lượt migrate hỏng rồi
 * rollback — kể cả trên database dựng mới từ 0000.
 *
 * Vì sao `db:grant-missing` không lo được: lệnh đó CỐ Ý bỏ qua module mà người
 * đó chưa có dòng nào, để không giới thiệu module mới cho ai. `department` đúng
 * là một module mới, nên nó bỏ qua sạch.
 *
 * Chỉ hai hành động đọc, phạm vi `managed` — khớp `deputyDirectorPermissions` ở
 * `lib/roles.ts`, tức đúng những phòng ghi trong `user_managed_departments` của
 * người đó. KHÔNG cấp `create` · `update` · `delete`: sửa cơ cấu phòng vẫn là
 * việc của Giám đốc.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:grant-department-read -- --dry-run
 *
 * Ghi thật thì BẮT BUỘC khai tên đăng nhập của người chịu trách nhiệm — nó vào
 * `audit_log` để tháng sau còn tra được quyền tới từ đâu:
 *   bun run db:grant-department-read -- --as=admin
 *
 * Chạy lại được: đã có dòng nào thì bỏ qua dòng đó, không ghi đè phạm vi mà
 * admin đã tự cấp lẻ cho một người cụ thể.
 */

const READ_ACTIONS = ["view-summary", "view-detail"] as const;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  // Chỉ người đang làm. Tài khoản đã khoá không đăng nhập được nên cấp thêm
  // quyền cho họ chỉ làm bảng quyền nở ra vô cớ.
  const people = await db.execute<{ id: string; full_name: string }>(
    sql`select id, full_name from users
        where role = 'deputy-director' and active
        order by full_name`,
  );

  const existing = await db.execute<{ user_id: string; action: string }>(
    sql`select user_id, action from user_permissions where module = 'department'`,
  );
  const held = new Set(existing.rows.map((r) => `${r.user_id}|${r.action}`));

  const toAdd: { userId: string; name: string; action: string }[] = [];
  for (const person of people.rows) {
    for (const action of READ_ACTIONS) {
      if (held.has(`${person.id}|${action}`)) continue;
      toAdd.push({ userId: person.id, name: person.full_name, action });
    }
  }

  if (toAdd.length === 0) {
    console.log("Mọi Phó giám đốc đang hoạt động đã có đủ hai quyền đọc phòng ban.");
    await pool.end();
    return;
  }

  // In ra TỪNG dòng sắp cấp trước khi ghi. Cấp quyền im lặng hàng loạt là thứ
  // không ai muốn phát hiện sau, lúc đọc nhật ký truy vết.
  console.log(`${toAdd.length} quyền sắp cấp${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}:`);
  for (const a of toAdd) console.log(`  ${a.name} · department:${a.action} (managed)`);

  if (dryRun) {
    await pool.end();
    return;
  }

  if (!asArg) {
    console.error(
      "Thiếu --as=<tên đăng nhập>. Cấp quyền phải có người chịu trách nhiệm, và tên đó đi vào nhật ký truy vết.\nVí dụ:  bun run db:grant-department-read -- --as=admin",
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

  for (const a of toAdd) {
    await db.execute(sql`
      insert into user_permissions (user_id, module, action, scope)
      values (${a.userId}, 'department'::module_key, ${a.action}::action_key, 'managed'::scope_key)
      on conflict (user_id, module, action) do nothing
    `);
  }

  const byUser = new Map<string, { name: string; actions: string[] }>();
  for (const a of toAdd) {
    const kept = byUser.get(a.userId) ?? { name: a.name, actions: [] };
    kept.actions.push(`department:${a.action} (managed)`);
    byUser.set(a.userId, kept);
  }
  for (const [userId, entry] of byUser) {
    await db.execute(sql`
      insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
      values (
        ${actorId}, 'system'::module_key, 'grant-permission'::action_key,
        ${`db:grant-department-read cấp ${entry.actions.length} quyền cho ${entry.name}: ${entry.actions.join(", ")}`},
        'user_permissions', ${userId}
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
