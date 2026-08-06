/**
 * Trần của các kiểu số trong Postgres, để schema zod chặn TRƯỚC khi tới DB.
 *
 * Không chặn thì số vượt trần đi thẳng vào lệnh ghi, Postgres từ chối
 * (`22003 numeric field overflow` hoặc `22P02` với số lẻ vào cột nguyên), route
 * chưa bắt nên thành 500 — người dùng nhận đúng câu "Không lưu được" và không
 * biết mình gõ sai chỗ nào. Chặn ở đây thì lỗi hiện ngay dưới ô nhập.
 *
 * Đặt ở `lib/api/` chứ không ở `server/`: schema zod là hợp đồng dùng chung cho
 * cả hai đầu (AGENTS.md §4), giao diện phải kiểm được mà không cần gọi máy chủ.
 */

export const SMALLINT_MAX = 32_767;
export const INT_MAX = 2_147_483_647;

/** `service_types.coefficient` là `numeric(4,2)` — nhiều nhất 99.99. */
export const COEFFICIENT_MAX = 99.99;
