"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import {
  createReferralCode,
  fetchBanks,
  ReferralCodeForm,
} from "@/lib/api/bankCatalog";
import styles from "./ReferralCodeFormDialog.module.scss";
import { errorMessage, toast } from "@/lib/toast";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** P-61 · Thêm một mã giới thiệu lẻ. Nhập hàng loạt từ Excel là việc của P-62. */
export function ReferralCodeFormDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const activeBanks = banks.filter((b) => b.active);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ReferralCodeForm>({
    resolver: zodResolver(ReferralCodeForm),
    defaultValues: { bankId: "", code: "", total: 100 },
  });

  const save = useMutation({
    mutationFn: createReferralCode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
      // Ô lọc mã ở màn ngân hàng / xuất Excel đi khoá riêng, tiền tố trên
      // không với tới — không nạp thì mã vừa thêm chưa hiện ở đó.
      queryClient.invalidateQueries({ queryKey: ["referral-code-options"] });
      onClose();
      toast.ok("Đã lưu mã giới thiệu");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được mã này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Thêm mã giới thiệu"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="referral-code-form"
            disabled={isSubmitting || save.isPending}
          >
            Tạo mã
          </Button>
        </>
      }
    >
      <form
        id="referral-code-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        <Select
          block
          label="Ngân hàng"
          value={watch("bankId")}
          onChange={(v) => setValue("bankId", v, { shouldDirty: true })}
          options={[
            { value: "", label: "— Chọn ngân hàng —" },
            ...activeBanks.map((b) => ({ value: b.id, label: b.code })),
          ]}
          error={errors.bankId?.message}
        />

        <TextField
          label="Mã giới thiệu"
          placeholder="VPA-2026-01"
          error={errors.code?.message}
          {...register("code")}
        />

        <TextField
          label="Tổng số lượt dùng"
          type="number"
          inputMode="numeric"
          hint="Số lượt tài khoản có thể mở bằng mã này"
          error={errors.total?.message}
          {...register("total", { valueAsNumber: true })}
        />
      </form>
    </Dialog>
  );
}
