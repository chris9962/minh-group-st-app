/**
 * Dọn dữ liệu của các tài khoản nhân viên đã nhập nhầm / đã nghỉ trước khi dùng.
 *
 * Mặc định chỉ KIỂM TRA, trên DB được trỏ bởi DATABASE_URL. Xoá thật:
 *   bun scripts/delete-departed-users.ts --xoa-that
 *
 * Username khớp không phân biệt hoa/thường; nếu còn thiếu dù chỉ một tên thì
 * script dừng, không xoá một phần. Ảnh S3 của các tài khoản ngân hàng bị xoá
 * không thể được xoá trong transaction Postgres;
 * script báo số lượng để dọn riêng sau khi đã xem trước.
 */
import { Pool } from "pg";

const USERNAMES = ["457HUNGPD", "422KHANHNT", "311vyntt", "307phonght", "127MINHNT", "361NGOCLB", "nnt", "mg-nnt"];
const xoaThat = process.argv.includes("--xoa-that");
const connectionString = process.env.DATABASE_URL;
const normalizedUsernames = USERNAMES.map((username) => username.toLowerCase());

if (!connectionString) throw new Error("DATABASE_URL chưa đặt.");

const pool = new Pool({ connectionString });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query("CREATE TEMP TABLE target_users (id uuid primary key, username text not null) ON COMMIT DROP");
  const matched = await client.query<{ id: string; username: string }>(
    "INSERT INTO target_users SELECT id, username FROM users WHERE lower(username) = ANY($1::text[]) RETURNING id, username",
    [normalizedUsernames],
  );
  const found = new Set(matched.rows.map((row) => row.username.toLowerCase()));
  const missing = USERNAMES.filter((username) => !found.has(username.toLowerCase()));
  if (missing.length || matched.rows.length !== USERNAMES.length) {
    const candidates = await client.query<{ username: string }>(
      "SELECT username FROM users WHERE regexp_replace(lower(username), '[^a-z0-9]', '', 'g') = ANY($1::text[]) ORDER BY username",
      [missing.map((username) => username.toLowerCase().replace(/[^a-z0-9]/g, ""))],
    );
    const nearby = candidates.rows.map((row) => row.username).join(", ") || "không có";
    throw new Error(
      `Không khớp đúng đủ 8 username. Thiếu: ${missing.join(", ") || "—"}. ` +
        `Tên có thể tương ứng trong DB: ${nearby}.`,
    );
  }

  await client.query("CREATE TEMP TABLE target_customers (id uuid primary key) ON COMMIT DROP");
  await client.query("INSERT INTO target_customers SELECT id FROM customers WHERE created_by IN (SELECT id FROM target_users)");
  await client.query("CREATE TEMP TABLE target_grants (id uuid primary key) ON COMMIT DROP");
  await client.query("INSERT INTO target_grants SELECT id FROM gift_grants WHERE customer_id IN (SELECT id FROM target_customers) OR granted_by IN (SELECT id FROM target_users)");
  await client.query("CREATE TEMP TABLE target_orders (id uuid primary key) ON COMMIT DROP");
  await client.query("INSERT INTO target_orders SELECT id FROM insurance_orders WHERE customer_id IN (SELECT id FROM target_customers) OR created_by IN (SELECT id FROM target_users) OR gift_grant_id IN (SELECT id FROM target_grants)");

  const summary = await client.query<{ label: string; count: string }>(`
    SELECT 'users' label, count(*)::text count FROM target_users
    UNION ALL SELECT 'customers', count(*)::text FROM target_customers
    UNION ALL SELECT 'bank_accounts', count(*)::text FROM bank_accounts WHERE customer_id IN (SELECT id FROM target_customers)
    UNION ALL SELECT 'bank_account_photos (S3 keys)', count(*)::text FROM bank_account_photos WHERE account_id IN (SELECT id FROM bank_accounts WHERE customer_id IN (SELECT id FROM target_customers))
    UNION ALL SELECT 'insurance_orders', count(*)::text FROM target_orders
    UNION ALL SELECT 'services', count(*)::text FROM services WHERE customer_id IN (SELECT id FROM target_customers) OR created_by IN (SELECT id FROM target_users)
    UNION ALL SELECT 'gift_grants', count(*)::text FROM target_grants
    UNION ALL SELECT 'kpi_scores', count(*)::text FROM kpi_scores WHERE user_id IN (SELECT id FROM target_users)
    UNION ALL SELECT 'audit_log', count(*)::text FROM audit_log WHERE actor_id IN (SELECT id FROM target_users)
  `);
  console.table(summary.rows);

  if (!xoaThat) {
    await client.query("ROLLBACK");
    console.log("Chạy thử, chưa xoá gì. Thêm --xoa-that để xoá thật.");
  } else {
    // Xoá đúng chiều khoá ngoại. Không gọi dịch vụ ngoài transaction để tránh
    // giữ lock lâu; ảnh S3 được báo ở lượt chạy thử và dọn bằng script riêng.
    await client.query("DELETE FROM insurance_order_status_history WHERE order_id IN (SELECT id FROM target_orders)");
    await client.query("UPDATE insurance_order_status_history SET changed_by = NULL WHERE changed_by IN (SELECT id FROM target_users)");
    // Một người có thể đang được ghi là người xử lý đơn do nhân viên khác tạo.
    // Giữ đơn đó, chỉ bỏ tên người xử lý và snapshot phòng của họ.
    await client.query("UPDATE insurance_orders SET handled_by = NULL, handled_by_department_id = NULL WHERE handled_by IN (SELECT id FROM target_users)");
    await client.query("DELETE FROM insurance_orders WHERE id IN (SELECT id FROM target_orders)");
    await client.query("DELETE FROM gift_grant_changes WHERE gift_grant_id IN (SELECT id FROM target_grants) OR changed_by IN (SELECT id FROM target_users)");
    await client.query("DELETE FROM gift_grants WHERE id IN (SELECT id FROM target_grants)");
    await client.query("DELETE FROM services WHERE customer_id IN (SELECT id FROM target_customers) OR created_by IN (SELECT id FROM target_users)");
    await client.query("DELETE FROM bank_accounts WHERE customer_id IN (SELECT id FROM target_customers)");
    await client.query("DELETE FROM customer_phones WHERE customer_id IN (SELECT id FROM target_customers)");
    await client.query("DELETE FROM customers WHERE id IN (SELECT id FROM target_customers)");
    await client.query("DELETE FROM notifications WHERE user_id IN (SELECT id FROM target_users)");
    await client.query("DELETE FROM feedbacks WHERE user_id IN (SELECT id FROM target_users)");
    await client.query("UPDATE feedbacks SET handled_by = NULL, handled_at = NULL WHERE handled_by IN (SELECT id FROM target_users)");
    await client.query("DELETE FROM kpi_adjustments WHERE user_id IN (SELECT id FROM target_users) OR created_by IN (SELECT id FROM target_users)");
    await client.query("DELETE FROM kpi_scores WHERE user_id IN (SELECT id FROM target_users)");
    await client.query("UPDATE kpi_targets SET updated_by = NULL WHERE updated_by IN (SELECT id FROM target_users)");
    await client.query("DELETE FROM audit_log WHERE actor_id IN (SELECT id FROM target_users)");
    await client.query("DELETE FROM sessions WHERE user_id IN (SELECT id FROM target_users)");
    await client.query("DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM target_users)");
    await client.query("DELETE FROM user_managed_departments WHERE user_id IN (SELECT id FROM target_users)");
    await client.query("DELETE FROM user_managed_banks WHERE user_id IN (SELECT id FROM target_users)");
    await client.query("DELETE FROM users WHERE id IN (SELECT id FROM target_users)");
    await client.query("COMMIT");
    console.log("Đã xoá dữ liệu database của 8 tài khoản. Ảnh S3 chưa bị xoá.");
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
