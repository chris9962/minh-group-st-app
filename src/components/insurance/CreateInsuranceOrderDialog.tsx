"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CustomerPickerDialog } from "@/components/customers/CustomerPickerDialog";
import { InsuranceOrderFormDialog } from "@/components/insurance/InsuranceOrderFormDialog";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * P-14 · Tạo đơn bảo hiểm cho khách chưa có sẵn trong ngữ cảnh (khác nút tạo
 * đơn ở P-42, luôn có sẵn khách).
 *
 * Bước chọn khách nằm ở `CustomerPickerDialog` — dùng chung với luồng mở tài
 * khoản ngân hàng và ghi dịch vụ.
 */
export function CreateInsuranceOrderDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  return (
    <CustomerPickerDialog open={open} onClose={onClose} title="Chọn khách hàng">
      {(customer) => (
        <InsuranceOrderFormDialog
          open
          customer={customer}
          source="self"
          onClose={onClose}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ["insurance-list"] })}
        />
      )}
    </CustomerPickerDialog>
  );
}
