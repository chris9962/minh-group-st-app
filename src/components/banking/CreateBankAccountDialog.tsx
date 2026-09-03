"use client";

import { BankAccountFormDialog } from "@/components/banking/BankAccountFormDialog";
import { CustomerPickerDialog } from "@/components/customers/CustomerPickerDialog";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * P-21 · Mở tài khoản ngân hàng cho khách chưa có sẵn trong ngữ cảnh (khác hai
 * nút "Mở ngân hàng" ở P-40/P-42, luôn có sẵn khách).
 *
 * Bước chọn khách nằm ở `CustomerPickerDialog` — dùng chung với luồng tạo đơn
 * bảo hiểm và ghi dịch vụ.
 */
export function CreateBankAccountDialog({ open, onClose }: Props) {
  return (
    <CustomerPickerDialog
      open={open}
      onClose={onClose}
      title="Tạo tài khoản ngân hàng — chọn khách hàng"
      forBankAccount
    >
      {(customer, back) => (
        <BankAccountFormDialog
          open
          customerId={customer.id}
          customerDepartmentId={customer.createdByDepartmentId}
          onClose={onClose}
          onBack={back}
        />
      )}
    </CustomerPickerDialog>
  );
}
