"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { saveStaffPayment, StaffPaymentForm, type StaffPayment } from "@/lib/api/staffPayment";
import { reportInvalid } from "@/lib/formErrors";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./PaymentInfoDialog.module.scss";

type Props = {
  staffId: string;
  payment: StaffPayment;
  onClose: () => void;
};

export function PaymentInfoDialog({ staffId, payment, onClose }: Props) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StaffPaymentForm>({
    shouldFocusError: false,
    resolver: zodResolver(StaffPaymentForm),
    defaultValues: {
      bankAccountNumber: payment.bankAccountNumber ?? "",
      bankName: payment.bankName ?? "",
      bankCode: payment.bankCode ?? "",
    },
  });

  const save = useMutation({
    mutationFn: (form: StaffPaymentForm) => saveStaffPayment(staffId, form),
    onSuccess: (saved) => {
      queryClient.setQueryData(["staff-payment", staffId], saved);
      onClose();
      toast.ok("Đã lưu thông tin thanh toán");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được thông tin thanh toán. Thử lại.")),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Sửa thông tin thanh toán"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="payment-info-form" disabled={isSubmitting || save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <form
        id="payment-info-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
        noValidate
      >
        <TextField
          label="Số tài khoản"
          inputMode="numeric"
          autoComplete="off"
          error={errors.bankAccountNumber?.message}
          {...register("bankAccountNumber")}
        />
        <TextField
          label="Ngân hàng nhận"
          autoComplete="off"
          error={errors.bankName?.message}
          {...register("bankName")}
        />
        <TextField
          label="Mã ngân hàng"
          inputMode="numeric"
          autoComplete="off"
          error={errors.bankCode?.message}
          {...register("bankCode")}
        />
      </form>
    </Dialog>
  );
}
