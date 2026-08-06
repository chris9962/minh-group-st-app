import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ROLE_PERMISSIONS } from "../src/lib/roles";
import type { RoleKey } from "../src/lib/types";

/**
 * Cấp bù những quyền mà bộ mặc định theo chức vụ CÓ nhưng tài khoản đang thiếu.
 *
 * Vì sao cần: `ROLE_PERMISSIONS` chỉ được áp một lần LÚC TẠO người. Quyền thật
 * của mỗi người nằm ở các dòng riêng trong `user_permissions` và không bao giờ
 * đọc lại từ chức vụ (spec §1.1.0). Nên thêm một hành động vào `lib/roles.ts`
 * chỉ có tác dụng với tài khoản lập SAU đó — người cũ vẫn thiếu, im lặng.
 *
 * Đó đúng là cách `banking:update` biến mất: không một ai trong 11 tài khoản có
 * nó, nên bước 2 của luồng mở tài khoản không ai làm nổi, và không có gì báo.
 *
 * ⚠️ CHỈ HOÀN THIỆN MODULE NGƯỜI ĐÓ ĐÃ LÀM VIỆC, không giới thiệu module mới.
 *
 * Ai đã có ít nhất một quyền trong `banking` thì được cấp bù những hành động
 * còn thiếu của `banking`. Ai KHÔNG có quyền nào trong module đó thì lệnh này
 * bỏ qua hoàn toàn — vì "không có quyền nào" thường là quyết định, không phải
 * thiếu sót. Tài khoản `User Admin` mang chức vụ `staff` nhưng bị cắt sạch
 * quyền kinh doanh là ví dụ đúng: cấp bù mù quáng biến quản trị hệ thống thành
 * nhân viên bán hàng đầy đủ quyền.
 *
 * Cần cấp trọn bộ theo chức vụ cho ai đó thì dùng nút "Đặt lại theo chức vụ" ở
 * màn P-92 — ở đó có người nhìn và chịu trách nhiệm cho từng tài khoản.
 *
 * Ba điều lệnh này KHÔNG làm, cả ba đều có chủ đích:
 *
 * 1. KHÔNG gỡ quyền thừa. Admin gán tay đè lên bộ mặc định là việc hợp lệ
 *    (spec §1.1.0) — lệnh này không có cách nào phân biệt "gán tay có lý do"
 *    với "sót lại từ bộ cũ", nên không đụng.
 * 2. KHÔNG nới phạm vi của dòng đã có. Ai đó đã hạ một quyền từ `managed` xuống
 *    `own` thì đó là quyết định, không phải lỗi.
 * 3. KHÔNG cấp `grant-permission`. Đây là hành động DUY NHẤT tự nâng quyền được
 *    cho chính mình, và `can()` cố ý không cho nó đi qua bộ mặc định theo chức
 *    vụ (`lib/permissions.ts`). Một lệnh chạy hàng loạt mà cấp được nó thì chốt
 *    chặn ấy vô nghĩa. Cần thì cấp tay từng người ở màn P-92.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:grant-missing -- --dry-run
 *
 * Ghi thật thì BẮT BUỘC khai tên đăng nhập của người chịu trách nhiệm — nó vào
 * `audit_log` để tháng sau còn tra được quyền tới từ đâu:
 *   bun run db:grant-missing -- --as=admin
 */

const NEVER_AUTO_GRANT = new Set(["grant-permission"]);

/**
 * ⚠️ KHÔNG BAO GIỜ tự cấp quyền trên module `*`.
 *
 * `*` không phải một module — nó là MỌI module, kể cả module chưa tồn tại. Quy
 * tắc "chỉ hoàn thiện module người đó đã làm việc" vỡ đúng ở đây: một tài khoản
 * còn ĐÚNG MỘT dòng `*:configure-catalog` sẽ được coi là "đã làm việc trong
 * module `*`" và nhận thêm 13 quyền toàn công ty, trong đó có
 * `*:access-id-number` (mở CCCD đầy đủ) và `*:manage-org` (cổng gác Nhật ký
 * truy vết).
 *
 * Hệ quả: admin cố ý gỡ hai quyền đó khỏi một tài khoản theo spec §10.2, chạy
 * lệnh này lần sau là trả lại hết — im lặng. Quyền `*` chỉ cấp bằng tay ở P-92,
 * nơi có người nhìn và chịu trách nhiệm.
 */
const NEVER_AUTO_GRANT_MODULE = "*";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const people = await db.execute<{ id: string; full_name: string; role: RoleKey }>(
    // Chỉ người đang làm. Tài khoản đã khoá không đăng nhập được nên cấp thêm
    // quyền cho họ chỉ làm bảng quyền nở ra vô cớ.
    sql`select id, full_name, role from users where active order by role, full_name`,
  );
  const existing = await db.execute<{
    user_id: string;
    module: string;
    action: string;
    scope: string;
  }>(sql`select user_id, module, action, scope from user_permissions`);

  const held = new Set(existing.rows.map((r) => `${r.user_id}|${r.module}|${r.action}`));

  /**
   * Phạm vi người này ĐANG dùng trong từng module — lấy hẹp nhất trong các dòng
   * đã có, và đó là phạm vi dùng cho quyền cấp bù.
   *
   * KHÔNG lấy phạm vi mặc định của chức vụ, và đây là lỗi đã trả giá một lần:
   * bộ mặc định của cấp quản lý ghi `managed`, nhưng một trưởng phòng có
   * `manage_scope = 'none'` thì `managed` trỏ vào DANH SÁCH RỖNG — quyền cấp
   * xong không thấy được dòng nào, mà sáu quyền anh em của nó trong cùng module
   * lại là `own`. Cấp một quyền vô dụng còn tệ hơn không cấp: nhìn bảng quyền
   * thì tưởng đã có.
   *
   * Lấy HẸP NHẤT chứ không rộng nhất: cấp bù là hoàn thiện bộ hành động, không
   * phải dịp nới quyền cho ai.
   */
  const rank: Record<string, number> = { own: 0, managed: 1, company: 2 };
  const scopeInModule = new Map<string, string>();
  for (const r of existing.rows) {
    const key = `${r.user_id}|${r.module}`;
    const current = scopeInModule.get(key);
    if (!current || rank[r.scope] < rank[current]) scopeInModule.set(key, r.scope);
  }

  const toAdd: { userId: string; name: string; module: string; action: string; scope: string }[] = [];
  const skipped: string[] = [];

  for (const person of people.rows) {
    for (const perm of ROLE_PERMISSIONS[person.role] ?? []) {
      if (NEVER_AUTO_GRANT.has(perm.action)) continue;
      if (perm.module === NEVER_AUTO_GRANT_MODULE) continue;
      if (held.has(`${person.id}|${perm.module}|${perm.action}`)) continue;

      // Chưa có quyền nào trong module đó = quyết định, không phải thiếu sót.
      const scope = scopeInModule.get(`${person.id}|${perm.module}`);
      if (!scope) {
        skipped.push(`${person.full_name} · ${perm.module}:${perm.action}`);
        continue;
      }

      toAdd.push({
        userId: person.id,
        name: person.full_name,
        module: perm.module,
        action: perm.action,
        scope,
      });
    }
  }

  // Nói ra phần đã bỏ qua, đừng để im: "cấp bù xong" mà thực ra bỏ qua 20 dòng
  // thì người đọc hiểu là đã đủ.
  if (skipped.length > 0) {
    console.log(`Bỏ qua ${skipped.length} quyền — người này chưa có quyền nào trong module đó:`);
    for (const s of skipped) console.log(`  ${s}`);
    console.log("  (cần cấp thì dùng nút \"Đặt lại theo chức vụ\" ở màn P-92)\n");
  }

  if (toAdd.length === 0) {
    console.log("Không ai thiếu quyền nào trong những module họ đang làm việc.");
    await pool.end();
    return;
  }

  // In ra TỪNG dòng sắp cấp trước khi ghi. Cấp quyền im lặng hàng loạt là thứ
  // không ai muốn phát hiện sau, lúc đọc nhật ký truy vết.
  console.log(`${toAdd.length} quyền sắp cấp bù${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}:`);
  for (const a of toAdd) console.log(`  ${a.name} · ${a.module}:${a.action} (${a.scope})`);

  if (dryRun) {
    await pool.end();
    return;
  }

  /**
   * Không có người đứng tên thì KHÔNG ghi.
   *
   * `audit_log.actor_id` là NOT NULL, và đó là ràng buộc đúng: cấp quyền là
   * việc phải truy được về một con người. Chạy ẩn danh rồi tháng sau không ai
   * biết ai bấm là đúng thứ nhật ký truy vết sinh ra để chặn.
   */
  if (!asArg) {
    console.error(
      "Thiếu --as=<tên đăng nhập>. Cấp quyền phải có người chịu trách nhiệm, và tên đó đi vào nhật ký truy vết.\nVí dụ:  bun run db:grant-missing -- --as=admin",
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
      values (${a.userId}, ${a.module}::module_key, ${a.action}::action_key, ${a.scope}::scope_key)
      on conflict (user_id, module, action) do nothing
    `);
  }

  /**
   * Để lại vết cho từng người được cấp bù.
   *
   * Cấp quyền qua P-92 có ghi `audit_log`; lệnh chạy hàng loạt mà không ghi thì
   * tháng sau ai hỏi "vì sao tài khoản này có `services:export`" là không tra
   * được — mở P-93 không thấy gì, và không biết quyền tới từ lệnh hay từ một
   * người bấm tay.
   *
   * `actor_id` là người khai qua `--as=`; `target_label` nói rõ lệnh nào đã cấp
   * những gì.
   */
  const byUser = new Map<string, { name: string; perms: string[] }>();
  for (const a of toAdd) {
    const kept = byUser.get(a.userId) ?? { name: a.name, perms: [] };
    kept.perms.push(`${a.module}:${a.action} (${a.scope})`);
    byUser.set(a.userId, kept);
  }
  for (const [userId, entry] of byUser) {
    await db.execute(sql`
      insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
      values (
        ${actorId}, 'system'::module_key, 'grant-permission'::action_key,
        ${`db:grant-missing cấp bù ${entry.perms.length} quyền cho ${entry.name}: ${entry.perms.join(", ")}`},
        'user_permissions', ${userId}
      )
    `);
  }

  await pool.end();
  console.log("Cấp bù xong — đã ghi nhật ký truy vết.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
