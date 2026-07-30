"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import type { Customer } from "@/lib/api/customers";
import {
  createInsuranceOrder,
  InsuranceOrderForm,
  type InsuranceOrderSource,
} from "@/lib/api/insuranceOrders";
import { fetchInsurancePackages } from "@/lib/api/settings";
import { useSession } from "@/store/session";
import styles from "./InsuranceOrderFormDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  customer: Customer;
  source: InsuranceOrderSource;
  /** Cố định sản phẩm/gói — dùng khi mở từ luồng Tặng quà (P-43). */
  prefill?: { product: string; packageName: string };
  onCreated?: () => void;
};

/**
 * Tạo đơn bảo hiểm — người thụ hưởng có thể khác khách hàng (spec §5.4).
 * Dùng chung cho luồng Tặng quà (`source='gift'`, sản phẩm cố định) và mua tự
 * nguyện (`source='self'`, tự chọn gói) khi P-10/P-11 được xây.
 */
export function InsuranceOrderFormDialog({
  open,
  onClose,
  customer,
  source,
  prefill,
  onCreated,
}: Props) {
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const primaryPhone = customer.phones.find((p) => p.primary)?.number ?? "";

  const { data: packages = [] } = useQuery({
    queryKey: ["insurance-packages"],
    queryFn: fetchInsurancePackages,
    enabled: !prefill,
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<InsuranceOrderForm>({
    resolver: zodResolver(InsuranceOrderForm),
    defaultValues: {
      customerId: customer.id,
      product: prefill?.product ?? "",
      packageName: prefill?.packageName ?? "",
      source,
      date: new Date().toISOString().slice(0, 10),
      beneficiaryName: customer.fullName,
      beneficiaryDob: customer.dob ?? "",
      beneficiaryIdNumber: customer.idNumber ?? "",
      beneficiaryPhone: primaryPhone,
    },
  });

  const save = useMutation({
    mutationFn: (form: InsuranceOrderForm) => createInsuranceOrder(form, actor?.id ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      onCreated?.();
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Tạo đơn bảo hiểm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="insurance-order-form"
            disabled={isSubmitting || save.isPending}
          >
            Tạo đơn
          </Button>
        </>
      }
    >
      <form
        id="insurance-order-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        {save.isError && <Alert tone="error">Không tạo được đơn bảo hiểm này.</Alert>}

        {prefill ? (
          <p className={styles.productLine}>
            Sản phẩm: <strong>{prefill.product}</strong> · {prefill.packageName}
          </p>
        ) : (
          <Select
            block
            label="Gói bảo hiểm"
            value={watch("packageName")}
            onChange={(v) => {
              const pkg = packages.find((p) => p.name === v);
              setValue("packageName", v, { shouldDirty: true });
              setValue("product", pkg?.name.includes("xe máy") ? "BH xe máy" : "BH tai nạn điện", {
                shouldDirty: true,
              });
            }}
            options={[
              { value: "", label: "— Chọn gói —" },
              ...packages.map((p) => ({ value: p.name, label: p.name })),
            ]}
          />
        )}
        {errors.packageName && <p className={styles.error}>{errors.packageName.message}</p>}

        <TextField label="Ngày tạo" type="date" {...register("date")} />

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>
            Người thụ hưởng — mặc định theo khách, sửa được nếu khác
          </legend>

          <TextField
            label="Họ tên"
            error={errors.beneficiaryName?.message}
            {...register("beneficiaryName")}
          />
          <div className={styles.pair}>
            <TextField label="Ngày sinh" type="date" {...register("beneficiaryDob")} />
            <TextField label="CCCD" {...register("beneficiaryIdNumber")} />
          </div>
          <TextField label="Số điện thoại" {...register("beneficiaryPhone")} />
        </fieldset>
      </form>
    </Dialog>
  );
}
