-- Lý do không mở ngân hàng bắt buộc, mỗi hồ sơ khách một dòng cho mỗi ngân hàng (chốt 2026-10-26).
-- Ngân hàng bắt buộc đang là MB; có `bank_id` để đổi sang ngân hàng khác mà lý do cũ vẫn gắn với MB.
-- Ghi chú bắt buộc, ảnh từ 1 đến 3.
-- Xoá hồ sơ thì xoá luôn lý do: nút xoá hồ sơ và job xoá hồ sơ trống không biết bảng này.
CREATE TABLE IF NOT EXISTS "bank_skip_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
	"bank_id" uuid NOT NULL REFERENCES "banks"("id"),
	"note" text NOT NULL,
	"photo_urls" text[] NOT NULL,
	"created_by" uuid NOT NULL REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL REFERENCES "users"("id"),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_skip_reasons_note" CHECK (length(btrim("note")) > 0),
	CONSTRAINT "bank_skip_reasons_photos" CHECK (cardinality("photo_urls") BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_skip_reasons_customer_bank" ON "bank_skip_reasons" ("customer_id", "bank_id");
