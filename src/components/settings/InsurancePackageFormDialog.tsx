"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFieldArray, useForm } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import {
  createInsurancePackage,
  InsurancePackageForm,
  updateInsurancePackage,
  type InsurancePackage,
} from "@/lib/api/settings";
import { InsuranceProduct, PRODUCT_LABEL } from "@/lib/types";
import styles from "./InsurancePackageFormDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là sửa, không có thì là thêm gói mới. */
  insurancePackage?: InsurancePackage | null;
};

/** P-82 · Lập / sửa một gói bảo hiểm. */
export function InsurancePackageFormDialog({ open, onClose, insurancePackage }: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(insurancePackage);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<InsurancePackageForm>({
    resolver: zodResolver(InsurancePackageForm),
    defaultValues: {
      name: insurancePackage?.name ?? "",
      // Gói mới bắt đầu bằng một đơn — gói không sinh đơn nào thì không dùng
      // để làm gì, bắt người ta bấm "Thêm đơn" trước mới nhập được là thừa.
      legs: insurancePackage?.legs ?? [{ product: "motorbike", years: 1, fee: 0 }],
    },
  });

  const legs = useFieldArray({ control, name: "legs" });

  const save = useMutation({
    mutationFn: (form: InsurancePackageForm) =>
      insurancePackage
        ? updateInsurancePackage(insurancePackage.id, form)
        : createInsurancePackage(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-packages"] });
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Sửa gói bảo hiểm" : "Thêm gói bảo hiểm"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="insurance-package-form"
            disabled={isSubmitting || save.isPending}
          >
            {editing ? "Lưu" : "Tạo gói"}
          </Button>
        </>
      }
    >
      <form
        id="insurance-package-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        {save.isError && <Alert tone="error">Không lưu được gói bảo hiểm này.</Alert>}

        <TextField
          label="Tên gói"
          placeholder="1 năm BH tai nạn điện gói 100k"
          error={errors.name?.message}
          {...register("name")}
        />
        {/*
          MỘT LEG = MỘT ĐƠN bảo hiểm (chốt 04/08). Cấu trúc gói khai tường minh
          ở đây, KHÔNG suy ra từ tên gói: tên là thứ CEO sửa được, đặt "BH xe
          máy 3N" mà để code đoán số năm là ra hợp đồng sai hai năm.
        */}
        <fieldset className={styles.legs}>
          <legend className={styles.legend}>
            Gói này sinh mấy đơn — mỗi dòng một đơn bảo hiểm
          </legend>

          {legs.fields.map((field, i) => (
            <div key={field.id} className={styles.leg}>
              <Select
                block
                label={`Đơn ${i + 1} · sản phẩm`}
                value={watch(`legs.${i}.product`)}
                onChange={(v) =>
                  setValue(`legs.${i}.product`, v as InsuranceProduct, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                options={InsuranceProduct.options.map((value) => ({
                  value,
                  label: PRODUCT_LABEL[value],
                }))}
              />
              <TextField
                label="Số năm"
                type="number"
                inputMode="numeric"
                error={errors.legs?.[i]?.years?.message}
                {...register(`legs.${i}.years`, { valueAsNumber: true })}
              />
              <TextField
                label="Phí trọn thời hạn (đồng)"
                type="number"
                inputMode="numeric"
                error={errors.legs?.[i]?.fee?.message}
                {...register(`legs.${i}.fee`, { valueAsNumber: true })}
              />
              <Button
                variant="secondary"
                icon
                aria-label={`Bỏ đơn ${i + 1}`}
                disabled={legs.fields.length === 1}
                onClick={() => legs.remove(i)}
              >
                <Trash2 size={16} aria-hidden />
              </Button>
            </div>
          ))}

          {errors.legs?.message && <Alert tone="error">{errors.legs.message}</Alert>}

          <Button
            variant="secondary"
            onClick={() => legs.append({ product: "motorbike", years: 1, fee: 0 })}
          >
            <Plus size={16} aria-hidden />
            Thêm đơn
          </Button>
        </fieldset>
      </form>
    </Dialog>
  );
}
