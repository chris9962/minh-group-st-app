-- Thông báo đẩy: một dòng cho một THIẾT BỊ đã cho phép, không phải một người.
--
-- `endpoint` là khoá tự nhiên. Cùng một máy đăng ký lại thì trình duyệt trả
-- đúng chuỗi cũ, nên đặt duy nhất để lần sau ghi đè chứ không sinh dòng thứ hai.
--
-- `on delete cascade`: xoá tài khoản là xoá luôn đăng ký của họ. Giữ lại thì
-- mỗi lượt gửi tốn một lệnh gọi mạng cho một máy không ai còn dùng.
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint" ON "push_subscriptions" USING btree ("endpoint");
--> statement-breakpoint
CREATE INDEX "push_subscriptions_user" ON "push_subscriptions" USING btree ("user_id");
