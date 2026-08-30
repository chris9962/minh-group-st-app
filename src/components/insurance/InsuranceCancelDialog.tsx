"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import { cancelInsuranceOrder, InsuranceCancelForm } from "@/lib/api/insurance";
import { reportInvalid } from "@/lib/formErrors";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./InsuranceCancelDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  orderId: string;
  orderCode: string;
  /** Chạy sau khi máy chủ nhận — nơi gọi tự làm mới dữ liệu của mình. */
  onCancelled: () => void;
};

/**
 * P-14 · Huỷ một đơn bảo hiểm, kèm lý do bắt buộc.
 *
 * Hộp thoại riêng chứ không phải `ConfirmDialog`: lượt này thu DỮ LIỆU chứ
 * không chỉ hỏi lại, và lý do là thứ duy nhất phân biệt đơn huỷ với đơn bị đặt
 * tay sang trạng thái khác.
 *
 * Nút đóng ghi "Đóng" chứ không ghi "Huỷ" như các hộp thoại khác — ở đây "huỷ"
 * đã là tên của chính hành động, hai nghĩa trên một màn là chỗ dễ bấm nhầm.
 */
export function InsuranceCancelDialog({ open, onClose, orderId, orderCode, onCancelled }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InsuranceCancelForm>({
    shouldFocusError: false,
    resolver: zodResolver(InsuranceCancelForm),
    defaultValues: { note: "" },
  });

  const close = () => {
    reset({ note: "" });
    onClose();
  };

  const cancel = useMutation({
    mutationFn: (form: InsuranceCancelForm) => cancelInsuranceOrder(orderId, form),
    onSuccess: (order) => {
      onCancelled();
      close();
      toast.ok(`Đã huỷ đơn ${order.orderCode}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không huỷ được đơn này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Huỷ đơn ${orderCode}`}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={cancel.isPending}>
            Đóng
          </Button>
          <Button
            type="submit"
            form="insurance-cancel-form"
            disabled={isSubmitting || cancel.isPending}
          >
            {cancel.isPending ? "Đang huỷ…" : "Huỷ đơn"}
          </Button>
        </>
      }
    >
      <form
        id="insurance-cancel-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => cancel.mutate(form), reportInvalid)}
        noValidate
      >
        <TextArea
          label="Lý do huỷ"
          required
          rows={4}
          placeholder="Khách đổi ý, không mua nữa"
          error={errors.note?.message}
          {...register("note")}
        />
      </form>
    </Dialog>
  );
}
