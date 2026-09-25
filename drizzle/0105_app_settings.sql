-- Cấu hình vận hành đổi được lúc app đang chạy, không cần khởi động lại (2026-09-25).
--
-- Khoá đầu tiên là `pvi_route`: đơn bảo hiểm mới đi làm tay, qua API hay qua bot.
-- Màn Vận hành P-99 ghi khoá này. Migration KHÔNG chèn dòng nào: thiếu dòng thì
-- app đọc biến `PVI_ROUTE` như trước, nên deploy xong production chưa đổi hành
-- vi cho tới lần lưu đầu tiên trên màn.
CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_by" uuid REFERENCES "users"("id"),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
