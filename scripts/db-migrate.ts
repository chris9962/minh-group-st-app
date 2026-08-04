import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** Chạy các file trong ./drizzle theo thứ tự version — idempotent, đã chạy thì bỏ qua. */
async function main() {
  // `pg` không báo lỗi khi thiếu biến này — nó rơi về localhost:5432 và
  // script sẽ tạo bảng / đổ dữ liệu vào NHẦM database mà không ai biết.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const pool = new Pool({ connectionString });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("Migrate xong.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
