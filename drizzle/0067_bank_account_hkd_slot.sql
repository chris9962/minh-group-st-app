-- Một người có thể có HAI dòng cùng một ngân hàng: dòng chính mang loại thường
-- hoặc CNKD, và một dòng HKD riêng (chủ dự án chốt 2026-09-06).
--
-- Thường và CNKD là MỘT tài khoản thật, chỉ khác cách đăng ký, nên vẫn một dòng.
-- HKD là tài khoản thật thứ hai của cùng ngân hàng, nên là dòng thứ hai. Khoá
-- cũ `(root_customer_id, bank_id)` chặn dòng đó. Khoá mới thêm vế "có phải HKD
-- không", nên mỗi người mỗi ngân hàng tối đa một dòng chính và một dòng HKD.
--
-- Luật "dòng chính đang CNKD thì không có dòng HKD" KHÔNG nằm ở đây: nó đọc hai
-- dòng khác nhau nên không viết được thành unique index. Nó nằm ở
-- `startBankAccount` và đường sửa loại, trong giao dịch có khoá dòng khách.
--
-- Không có dòng nào loại HKD trong database lúc chạy (chỉ có `none` và `CNKD`),
-- nên chỉ mục mới phủ đúng tập dòng của chỉ mục cũ, không thể vỡ.
DROP INDEX "bank_accounts_root_bank";
--> statement-breakpoint

CREATE UNIQUE INDEX "bank_accounts_root_bank_slot" ON "bank_accounts"
  ("root_customer_id", "bank_id", ("account_type" = 'HKD'));
