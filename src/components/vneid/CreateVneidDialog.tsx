"use client";

import { CustomerPickerDialog } from "@/components/customers/CustomerPickerDialog";
import { CustomerVneidDialog } from "@/components/vneid/CustomerVneidDialog";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** Ghi VNeID từ trang danh sách: bước 1 chọn khách, bước 2 form. */
export function CreateVneidDialog({ open, onClose }: Props) {
  return (
    <CustomerPickerDialog open={open} onClose={onClose} title="Tích hợp VNeID - chọn khách hàng">
      {(customer, back) => (
        <CustomerVneidDialog
          customerId={customer.id}
          customerName={customer.fullName}
          customerDepartmentId={customer.createdByDepartmentId}
          onClose={onClose}
          onBack={back}
        />
      )}
    </CustomerPickerDialog>
  );
}
