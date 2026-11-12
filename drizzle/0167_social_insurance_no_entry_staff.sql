-- Dòng BHYT/BHXH được nhập khi cột NHẬP LIỆU trống hoặc mã không tra ra (chốt 2026-11-12):
-- dòng đó không có nhân viên ATM và không có lượt nhập liệu.
ALTER TABLE "social_insurance_records" ALTER COLUMN "entry_staff_id" DROP NOT NULL;
ALTER TABLE "social_insurance_records" ALTER COLUMN "service_id" DROP NOT NULL;
