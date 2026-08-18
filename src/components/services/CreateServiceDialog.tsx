"use client";

import { CustomerPickerDialog } from "@/components/customers/CustomerPickerDialog";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * P-30 · Ghi dịch vụ cho khách chưa có sẵn trong ngữ cảnh (khác nút "Ghi dịch
 * vụ" ở P-40/P-42, luôn có sẵn khách).
 *
 * Bước chọn khách nằm ở `CustomerPickerDialog` — dùng chung với luồng mở tài
 * khoản ngân hàng và tạo đơn bảo hiểm.
 */
export function CreateServiceDialog({ open, onClose }: Props) {
  return (
    <CustomerPickerDialog open={open} onClose={onClose} title="Ghi dịch vụ — chọn khách hàng">
      {(customer) => (
        <ServiceFormDialog
          open
          customerId={customer.id}
          customerName={customer.fullName}
          onClose={onClose}
        />
      )}
    </CustomerPickerDialog>
  );
}
