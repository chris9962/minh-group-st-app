-- Nhật ký sửa thông tin khách, và ĐỒNG BỘ TOÀN BỘ giữa các lần (chốt 2026-09-05).
--
-- Migration 0065 chỉ đồng bộ tên, ngày sinh và CCCD; địa chỉ, kênh và số điện
-- thoại giữ riêng từng lần. Nay đồng bộ hết: một người là một bộ thông tin, hai
-- dòng cùng CCCD mà khác địa chỉ thì không dòng nào nói được dòng kia sai.
--
-- Đổi lại phải có dấu vết. Không có nhật ký thì nhân viên A sửa địa chỉ, nhân
-- viên B mở hồ sơ thấy địa chỉ khác lúc mình nhập và không tra được ai đổi.
CREATE TYPE "customer_change_field" AS ENUM (
  'full_name', 'dob', 'id_number', 'address', 'phones', 'channel', 'profile_deleted'
);
--> statement-breakpoint

CREATE TABLE "customer_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Nhóm theo NGƯỜI, không theo hồ sơ: thông tin cá nhân đã đồng bộ nên một
  -- lượt sửa thuộc về cả nhóm. Hồ sơ nào cũng đọc chung một dòng thời gian.
  "root_customer_id" uuid NOT NULL,
  -- Hồ sơ người sửa đang ĐỨNG lúc bấm Lưu. NULL = hồ sơ đó đã bị xoá.
  --
  -- Nhận NULL chứ không xoá dòng theo hồ sơ (chốt 2026-09-05): xoá hồ sơ 2 mà
  -- mất luôn lịch sử của nó thì nhóm không còn dấu vết ai đã sửa gì trước đó,
  -- đúng thứ bảng này sinh ra để giữ.
  "customer_id" uuid,
  -- Hồ sơ thứ mấy, chép lúc GHI. Đọc sống từ `customers.seq` thì dòng của hồ sơ
  -- đã xoá mất số và người đọc không biết lượt sửa thuộc về hồ sơ nào.
  "seq" integer DEFAULT 1 NOT NULL,
  "changed_by" uuid,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "field" "customer_change_field" NOT NULL,
  -- CCCD ghi HAI CHUỖI RỖNG (chốt 2026-09-05): nhật ký chỉ nói "đã đổi CCCD".
  -- Đây là trường bảo mật, mọi màn khác chỉ trả 4 số cuối; ghi giá trị vào đây
  -- là mở một đường đọc số đầy đủ mà không ai gác.
  "from_value" text DEFAULT '' NOT NULL,
  "to_value" text DEFAULT '' NOT NULL
);
--> statement-breakpoint

ALTER TABLE "customer_changes" ADD CONSTRAINT "customer_changes_root_customer_id_customers_id_fk"
  FOREIGN KEY ("root_customer_id") REFERENCES "public"."customers"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "customer_changes" ADD CONSTRAINT "customer_changes_customer_id_customers_id_fk"
  FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "customer_changes" ADD CONSTRAINT "customer_changes_changed_by_users_id_fk"
  FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Khối lịch sử ở hồ sơ P-42 lấy mới nhất trước. `id` phá hoà: nhiều trường đổi
-- trong CÙNG một lượt Lưu mang cùng `changed_at`, thiếu nó thì thứ tự giữa các
-- trang không ổn định.
CREATE INDEX "customer_changes_root_date" ON "customer_changes" ("root_customer_id", "changed_at" DESC, "id");
--> statement-breakpoint

-- Lượt xoá hồ sơ chuyển các dòng của nó sang NULL, và câu xoá `customers` buộc
-- Postgres kiểm khoá ngoại này. Thiếu chỉ mục thì cả hai quét toàn bảng, mà
-- bảng lớn thêm theo mỗi lượt sửa hồ sơ (AGENTS.md §5.2).
CREATE INDEX "customer_changes_customer" ON "customer_changes" ("customer_id");
