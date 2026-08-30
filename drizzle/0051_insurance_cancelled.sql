-- Trạng thái "Huỷ đơn" của đơn bảo hiểm, kèm lý do huỷ (chốt 2026-08-30).
--
-- Trước file này, huỷ đơn là XOÁ HẲN dòng (`deleteInsuranceOrder`): đơn biến
-- mất cùng dòng thời gian của nó, không tra lại được ai huỷ và vì sao. Trạng
-- thái này giữ đơn lại, và người huỷ phải ghi lý do.
--
-- `note` nằm ở bảng LỊCH SỬ chứ không ở `insurance_orders`: lý do gắn với một
-- lượt đổi trạng thái cụ thể. Đơn huỷ rồi được đặt tay sang trạng thái khác vẫn
-- giữ nguyên lý do của lượt huỷ cũ.
--
-- ⚠️ File này KHÔNG được dùng giá trị 'cancelled' vừa thêm — drizzle bọc cả
-- loạt migration vào MỘT transaction, mà Postgres cấm dùng giá trị enum trong
-- cùng transaction với ADD VALUE (cùng lối migration 0046).
ALTER TYPE "insurance_order_status" ADD VALUE IF NOT EXISTS 'cancelled';
--> statement-breakpoint

ALTER TABLE "insurance_order_status_history"
  ADD COLUMN IF NOT EXISTS "note" text NOT NULL DEFAULT '';
