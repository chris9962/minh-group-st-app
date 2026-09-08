import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Thu hồi `handle-fallback` của MỌI tài khoản, trừ tài khoản toàn quyền và trừ
 * người của Phòng Kinh doanh tổng hợp.
 *
 * Quyền này mở kho chung: ai có nó cũng thấy và nhận được đơn ở `manual-queued`
 * hay `pending-approval` của bất kỳ phòng nào, không kẹp phạm vi (xem
 * `CLAIMABLE_STATUSES` ở `src/server/insurance.ts`). Cấp đại trà là mọi nhân
 * viên đọc được đơn của mọi phòng.
 *
 * Chốt 2026-08-29: thu hồi hết rồi cấp tay lại cho đúng người ở màn P-92.
 * Chốt 2026-09-07: chỉ Phòng Kinh doanh tổng hợp xử lý đơn tay, nên giữ nguyên
 * quyền của mọi người thuộc phòng đó (nhân viên, Trưởng phòng, Phó phòng), nhận
 * ra bằng mã phòng `PHONG-KDTH`. Bộ quyền mặc định ở `lib/roles.ts` cũng bỏ
 * quyền này cùng ngày, nên tài khoản lập sau đó không tự có nữa.
 *
 * MỐC GIỮ LẠI là `*:grant-permission` phạm vi `company` — hành động duy nhất
 * không bao giờ được cấp tự động, nên ai đang cầm nó trên `*` chắc chắn là tài
 * khoản toàn quyền do người thật cấp. Xoá `*:handle-fallback` của họ còn làm
 * `isFullAccess` trả `false` và họ rớt khỏi trạng thái toàn quyền ở lưới P-92
 * mà không ai báo.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:revoke-handle-fallback -- --dry-run
 *
 * Ghi thật thì BẮT BUỘC khai tên đăng nhập của người chịu trách nhiệm — nó vào
 * `audit_log` để tháng sau còn tra được quyền mất đi từ đâu:
 *   bun run db:revoke-handle-fallback -- --as=giamdoc
 *
 * Chạy lại được: không còn dòng nào thì báo rồi thoát.
 */

type Row = { id: string; username: string; full_name: string; module: string; scope: string };

/** Mã phòng trong `departments.code`, không tra theo tên vì tên đổi được ở P-91. */
const GENERAL_SALES_CODE = "PHONG-KDTH";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const fullAccess = sql`exists (
    select 1 from user_permissions g
    where g.user_id = u.id and g.module = '*'
      and g.action = 'grant-permission' and g.scope = 'company'
  )`;
  const generalSales = sql`exists (
    select 1 from departments d
    where d.id = u.department_id and d.code = ${GENERAL_SALES_CODE}
  )`;

  const doomed = await db.execute<Row>(
    sql`select u.id, u.username, u.full_name, p.module, p.scope
        from users u
        join user_permissions p on p.user_id = u.id
        where p.action = 'handle-fallback'
          and not ${fullAccess}
          and not ${generalSales}
        order by u.full_name`,
  );

  const kept = await db.execute<{ full_name: string; reason: string }>(
    sql`select distinct u.full_name,
               case when ${fullAccess} then 'toàn quyền' else 'Phòng Kinh doanh tổng hợp' end as reason
        from users u
        join user_permissions p on p.user_id = u.id
        where p.action = 'handle-fallback'
          and (${fullAccess} or ${generalSales})
        order by 2, 1`,
  );

  console.log(`Giữ lại ${kept.rows.length} tài khoản:`);
  for (const k of kept.rows) console.log(`  ${k.full_name} · ${k.reason}`);
  console.log();

  if (doomed.rows.length === 0) {
    console.log("Không tài khoản thường nào còn `handle-fallback`.");
    await pool.end();
    return;
  }

  // In số dòng, không in trọn 300 tên. Chạy khô thì in đủ để soi.
  console.log(`${doomed.rows.length} quyền sắp thu hồi${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}:`);
  const show = dryRun ? doomed.rows : doomed.rows.slice(0, 10);
  for (const p of show) console.log(`  ${p.full_name} · ${p.module}:handle-fallback (${p.scope})`);
  if (!dryRun && doomed.rows.length > show.length)
    console.log(`  … còn ${doomed.rows.length - show.length} dòng nữa`);

  if (dryRun) {
    await pool.end();
    return;
  }

  if (!asArg) {
    console.error(
      "\nThiếu --as=<tên đăng nhập>. Thu hồi quyền phải có người chịu trách nhiệm, và tên đó đi vào nhật ký truy vết.\nVí dụ:  bun run db:revoke-handle-fallback -- --as=giamdoc",
    );
    await pool.end();
    process.exit(1);
  }

  const actor = await db.execute<{ id: string }>(
    sql`select id from users where username = ${asArg} and active limit 1`,
  );
  const actorId = actor.rows[0]?.id;
  if (!actorId) {
    console.error(`\nKhông tìm thấy tài khoản đang hoạt động nào có tên đăng nhập "${asArg}".`);
    await pool.end();
    process.exit(1);
  }

  for (const p of doomed.rows) {
    await db.execute(sql`
      delete from user_permissions
      where user_id = ${p.id} and module = ${p.module}::module_key
        and action = 'handle-fallback'::action_key
    `);
    await db.execute(sql`
      insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
      values (
        ${actorId}, 'system'::module_key, 'grant-permission'::action_key,
        ${`db:revoke-handle-fallback thu hồi ${p.module}:handle-fallback (${p.scope}) của ${p.full_name}`},
        'user_permissions', ${p.id}
      )
    `);
  }

  await pool.end();
  console.log(`\nThu hồi xong ${doomed.rows.length} dòng — đã ghi nhật ký truy vết.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
