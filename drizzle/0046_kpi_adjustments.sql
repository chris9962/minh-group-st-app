-- Điểm cộng KPI tay theo tháng (chốt 2026-08-27) — quyền mới `system:adjust-kpi`
-- và bảng `kpi_adjustments`, mỗi lần cộng một dòng.
--
-- Bảng RIÊNG, không phải cột thứ ba của `kpi_scores`: `recomputeKpiOn`
-- (`src/server/kpi.ts`) XOÁ dòng `kpi_scores` khi người thuộc phòng `office` —
-- điểm cộng tay nằm chung bảng là mất theo lượt tính lại. Tổng gộp lúc truy vấn.
--
-- ⚠️ File này KHÔNG được dùng giá trị enum vừa thêm — drizzle bọc cả loạt
-- migration vào MỘT transaction, mà Postgres cấm dùng giá trị enum trong cùng
-- transaction với ADD VALUE (cùng lối migration 0026, xem chú thích dài ở
-- `scripts/db-grant-department-read.ts`). Phần cấp `*:adjust-kpi` cho tài
-- khoản toàn quyền vì thế nằm ở script `db:grant-adjust-kpi`, chạy SAU migrate.
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'adjust-kpi';
--> statement-breakpoint

CREATE TABLE "kpi_adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  -- '2026-08'. Luôn là tháng hiện tại lúc ghi — P-52 không cộng cho tháng cũ.
  "year_month" text NOT NULL,
  -- Âm là trừ điểm. 0 thì dòng không có nghĩa gì.
  "points" numeric(10, 2) NOT NULL,
  "reason" text NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "kpi_adjustments_points_nonzero" CHECK (points <> 0)
);
--> statement-breakpoint

-- `adjustmentExpr` tra theo (người, tháng); bảng gõ tay nên chỉ mục này là đủ.
CREATE INDEX "kpi_adjustments_user_month" ON "kpi_adjustments" ("user_id", "year_month");
