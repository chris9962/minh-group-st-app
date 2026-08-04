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

/**
 * Tên ràng buộc bị vi phạm nếu lỗi này là trùng khoá (Postgres `23505`), ngược
 * lại `null`.
 *
 * ⚠️ Phải đi dọc chuỗi `cause`. Drizzle bọc MỌI lỗi truy vấn trong
 * `DrizzleQueryError`, và lớp bọc đó chỉ có `query`/`params`/`cause` — không có
 * `code`, không có `constraint`. So thẳng `e.code === '23505'` thì không bao giờ
 * khớp, nên mọi lần trùng tên đăng nhập / mã nhân viên / tên phòng rơi thành
 * 500 thay vì 422 có mã lỗi mà biểu mẫu đang chờ.
 */
export function uniqueViolationOf(e: unknown): string | null {
  for (let cur: unknown = e, depth = 0; cur && depth < 4; depth++) {
    const err = cur as { code?: string; constraint?: string; cause?: unknown };
    if (err.code === "23505") return err.constraint ?? "";
    cur = err.cause;
  }
  return null;
}
