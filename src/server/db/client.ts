import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Pool duy nhất cho cả app. Cache lên globalThis vì `next dev` hot-reload
 * module liên tục — không cache thì mỗi lần sửa file lại thêm một pool treo
 * cho tới khi cạn kết nối của Postgres.
 */
const globalForDb = globalThis as unknown as { mgstPool?: Pool };

const pool =
  globalForDb.mgstPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.mgstPool = pool;

export const db = drizzle(pool, { schema });
