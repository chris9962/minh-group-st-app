-- Người dùng TẮT loại thông báo nào.
--
-- Chỉ lưu dòng cho loại họ đã đụng vào. Không có dòng nghĩa là BẬT, nên thêm
-- một loại thông báo mới thì mọi người nhận được ngay, không phải chèn sẵn một
-- dòng cho từng người.
--
-- Khoá chính là cặp (user_id, kind): mỗi người mỗi loại đúng một dòng, và cặp
-- đó cũng là chỉ mục để đọc trọn lựa chọn của một người.
CREATE TABLE "notification_prefs" (
	"user_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "notification_prefs_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
