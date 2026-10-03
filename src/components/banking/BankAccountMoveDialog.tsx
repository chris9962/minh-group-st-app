"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CustomerPickerDialog } from "@/components/customers/CustomerPickerDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { moveBankAccount } from "@/lib/api/bankAccounts";
import { fetchBankAccountMoveTargets } from "@/lib/api/customers";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { errorMessage, toast } from "@/lib/toast";

/** Đổi tài khoản sang hồ sơ khách khác của cùng người tạo. Chỉ tài khoản toàn quyền mở được. */
export function BankAccountMoveDialog({
  accountId,
  bankCode,
  customerId,
  onClose,
}: {
  accountId: string;
  bankCode: string;
  customerId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const move = useMutation({
    mutationFn: (toCustomerId: string) => moveBankAccount(accountId, toCustomerId),
    onSuccess: (_, toCustomerId) => {
      queryClient.invalidateQueries({ queryKey: ["bank-account-detail", accountId] });
      queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["customer", toCustomerId] });
      invalidateKpi(queryClient);
      toast.ok("Đã đổi khách cho tài khoản và tính lại KPI");
      onClose();
    },
    onError: (error) => toast.fail(errorMessage(error, "Không đổi được khách cho tài khoản này.")),
  });

  return (
    <CustomerPickerDialog
      open
      title={`Đổi khách cho tài khoản ${bankCode}`}
      onClose={onClose}
      lookup={{
        // Khoá theo cả khách đang giữ: đổi xong mở lại thì danh sách phải khác.
        key: `move:${accountId}:${customerId}`,
        fetch: (search) => fetchBankAccountMoveTargets(accountId, search),
      }}
    >
      {(customer, back) => (
        <ConfirmDialog
          open
          title="Đổi khách"
          confirmLabel="Đổi khách"
          pending={move.isPending}
          onConfirm={() => move.mutate(customer.id)}
          onClose={back}
        >
          Bạn muốn đổi tài khoản <strong>{bankCode}</strong> sang khách{" "}
          <strong>
            {customer.seq > 1 ? `${customer.fullName} - hồ sơ ${customer.seq}` : customer.fullName}
          </strong>
          ?
        </ConfirmDialog>
      )}
    </CustomerPickerDialog>
  );
}
