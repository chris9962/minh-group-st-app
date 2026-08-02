import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** Chạy các file trong ./drizzle theo thứ tự version — idempotent, đã chạy thì bỏ qua. */
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("Migrate xong.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
