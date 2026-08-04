import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Pool duy nhất cho cả app. Cache lên globalThis vì `next dev` hot-reload
 * module liên tục — không cache thì mỗi lần sửa file lại thêm một pool treo
 * cho tới khi cạn kết nối của Postgres.
 */
const globalForDb = globalThis as unknown as { mgstPool?: Pool };

/**
 * Thiếu biến này thì `pg` KHÔNG báo lỗi: nó lặng lẽ rơi về mặc định của libpq
 * (`localhost:5432`, user = tên đăng nhập máy) và app nối vào một database
 * hoàn toàn khác — đúng cái instance mà cổng 5433 trong docker-compose sinh ra
 * để tránh. Hỏng sớm ở đây dễ hiểu hơn nhiều so với "sao dữ liệu trống trơn".
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

const pool = globalForDb.mgstPool ?? new Pool({ connectionString, max: 10 });

if (!globalForDb.mgstPool) {
  /**
   * BẮT BUỘC phải có listener. `pg-pool` phát sự kiện `error` khi một kết nối
   * đang NHÀN RỖI bị đứt (Postgres restart, máy ngủ dậy, mạng chớp). Node coi
   * sự kiện `error` không ai nghe là exception chưa bắt, và giết cả tiến trình
   * Next — không phải chỉ hỏng một request.
   *
   * Gắn trong nhánh này để hot-reload không chồng listener lên pool cũ.
   */
  pool.on("error", (err) => {
    console.error("[db] kết nối nhàn rỗi gặp lỗi:", err);
  });
}

if (process.env.NODE_ENV !== "production") globalForDb.mgstPool = pool;

export const db = drizzle(pool, { schema });
