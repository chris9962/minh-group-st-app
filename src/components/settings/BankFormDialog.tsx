"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import {
  ACCOUNT_NUMBER_METHOD_LABEL,
  AccountNumberMethod,
  BankForm,
  createBank,
  updateBank,
  type Bank,
} from "@/lib/api/bankCatalog";
import styles from "./BankFormDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là sửa, không có thì là thêm ngân hàng mới. */
  bank?: Bank | null;
};

/** P-60 · Lập / sửa một dòng ngân hàng. */
export function BankFormDialog({ open, onClose, bank }: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(bank);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BankForm>({
    resolver: zodResolver(BankForm),
    defaultValues: {
      code: bank?.code ?? "",
      requiredPhotos: bank?.requiredPhotos ?? 3,
      accountNumberMethod: bank?.accountNumberMethod ?? "phone-match",
      coefficient: bank?.coefficient ?? 1,
      countsAsApp: bank?.countsAsApp ?? true,
    },
  });

  const save = useMutation({
    mutationFn: (form: BankForm) => (bank ? updateBank(bank.id, form) : createBank(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["banks"] });
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Sửa ngân hàng" : "Thêm ngân hàng"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="bank-form" disabled={isSubmitting || save.isPending}>
            {editing ? "Lưu" : "Tạo ngân hàng"}
          </Button>
        </>
      }
    >
      <form
        id="bank-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        {save.isError && <Alert tone="error">Không lưu được ngân hàng này.</Alert>}

        <TextField
          label="Mã ngân hàng"
          placeholder="VPa"
          error={errors.code?.message}
          {...register("code")}
        />

        <div className={styles.pair}>
          <TextField
            label="Số ảnh bắt buộc"
            type="number"
            inputMode="numeric"
            error={errors.requiredPhotos?.message}
            {...register("requiredPhotos", { valueAsNumber: true })}
          />
          <TextField
            label="Hệ số điểm KPI"
            type="number"
            inputMode="numeric"
            step="0.1"
            error={errors.coefficient?.message}
            {...register("coefficient", { valueAsNumber: true })}
          />
        </div>

        <Select
          block
          label="Cách lấy số tài khoản"
          value={watch("accountNumberMethod")}
          onChange={(v) =>
            setValue("accountNumberMethod", v as AccountNumberMethod, { shouldDirty: true })
          }
          options={Object.entries(ACCOUNT_NUMBER_METHOD_LABEL).map(([value, label]) => ({
            value,
            label,
          }))}
        />

        <Checkbox
          label="Có đi kèm app (tính vào tổng app xét quà)"
          checked={watch("countsAsApp")}
          onCheckedChange={(v) => setValue("countsAsApp", v, { shouldDirty: true })}
        />
      </form>
    </Dialog>
  );
}
