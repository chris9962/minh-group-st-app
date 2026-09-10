-- Ghi chú thuộc từng hồ sơ khách; hồ sơ cũ bắt đầu với ghi chú trống.
ALTER TABLE customers ADD COLUMN note text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TYPE customer_change_field ADD VALUE 'note';
