"use client";

import { BankAccountFormDialog } from "@/components/banking/BankAccountFormDialog";
import { CustomerPickerDialog } from "@/components/customers/CustomerPickerDialog";
import type { Customer } from "@/lib/api/customers";

type Props = {
  open: boolean;
  onClose: () => void;
};

const primaryPhoneOf = (c: Customer): string =>
  c.phones.find((p) => p.primary)?.number ?? c.phones[0]?.number ?? "";

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
    >
      {(customer) => (
        <BankAccountFormDialog
          open
          customerId={customer.id}
          customerPrimaryPhone={primaryPhoneOf(customer)}
          onClose={onClose}
        />
      )}
    </CustomerPickerDialog>
  );
}
