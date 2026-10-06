"use client";

import { CustomerPickerDialog } from "@/components/customers/CustomerPickerDialog";
import { CustomerVneidDialog, customerVneidQuery } from "@/components/vneid/CustomerVneidDialog";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** Ghi VNeID từ trang danh sách: bước 1 chọn khách, bước 2 form. */
export function CreateVneidDialog({ open, onClose }: Props) {
  const user = useSession((s) => s.user);
  return (
    <CustomerPickerDialog
      open={open}
      onClose={onClose}
      title="Tích hợp VNeID - chọn khách hàng"
      preload={can(user, "vneid", "view-detail") ? customerVneidQuery : undefined}
    >
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
