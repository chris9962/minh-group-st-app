"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog } from "@/components/ui/Dialog";
import { MonthPicker } from "@/components/ui/MonthPicker";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import {
  KIND_LABEL,
  PLAN_LABEL,
  fetchSocialInsuranceOptions,
  RecordEditError,
  RecordEditForm,
  SocialInsurancePlan,
  updateRecord,
  type SocialInsuranceRow,
} from "@/lib/api/socialInsurance";
import { reportInvalid } from "@/lib/formErrors";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { decimalFromCents } from "@/lib/money";
import { decimalOnly, digitsOnly, numericField } from "@/lib/numberField";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./SocialInsuranceEditDialog.module.scss";

type Props = {
  open: boolean;
  record: SocialInsuranceRow;
  onClose: () => void;
};

/** Ô tiền mở sẵn số thật: `99066.24`, số tròn đồng thì bỏ `.00`. */
const moneyInput = (cents: number) => decimalFromCents(cents).replace(/\.00$/, "");

/** Sửa một dòng BHYT/BHXH. Khách và loại không sửa được: đổi chúng thì xoá dòng rồi nhập lại. */
export function SocialInsuranceEditDialog({ open, record, onClose }: Props) {
  const monthLabelId = useId();
  const monthErrorId = useId();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<RecordEditForm>({
    shouldFocusError: false,
    resolver: zodResolver(RecordEditForm),
    defaultValues: {
      receiptMonth: record.receiptMonth,
      plan: record.plan,
      months: String(record.months),
      collected: moneyInput(record.collectedCents),
      paid: moneyInput(record.paidCents),
      collaborator: record.collaboratorName ?? "",
      entryStaffId: record.entryStaffId,
    },
  });

  // Cùng route với các ô lọc của trang, nên thường đã có sẵn trong cache.
  const { data: options } = useQuery({
    queryKey: ["social-insurance", "options"],
    queryFn: fetchSocialInsuranceOptions,
    staleTime: 60_000,
  });
  const atmStaff = options?.atmStaff ?? [];
  // Người đang giữ lượt có thể đã thôi Điểm ATM: vẫn hiện tên họ để ô không trống.
  const staffOptions = [
    ...(atmStaff.some((s) => s.id === record.entryStaffId)
      ? []
      : [{ value: record.entryStaffId, label: record.entryStaffName }]),
    ...atmStaff.map((s) => ({ value: s.id, label: s.code ? `${s.name} - ${s.code}` : s.name })),
  ];

  const save = useMutation({
    mutationFn: (form: RecordEditForm) => updateRecord(record.id, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social-insurance"] });
      queryClient.invalidateQueries({ queryKey: ["services"] });
      invalidateKpi(queryClient);
      onClose();
      toast.ok("Đã lưu thay đổi");
    },
    onError: (e) => {
      // Lỗi theo từng ô hiện dưới đúng ô: số tiền chi đúng nằm trong câu lỗi, toast tắt là mất.
      const fields = e instanceof RecordEditError ? Object.entries(e.fieldErrors) : [];
      for (const [field, message] of fields) setError(field as keyof RecordEditForm, { message });
      if (fields.length === 0) toast.fail(errorMessage(e, "Không lưu được thay đổi này."));
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Sửa ${KIND_LABEL[record.kind]} - ${record.customerName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="social-insurance-form" disabled={save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <form
        id="social-insurance-form"
        className={styles.body}
        onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
        noValidate
      >
        <div
          className={styles.field}
          role="group"
          aria-labelledby={monthLabelId}
          aria-describedby={errors.receiptMonth ? monthErrorId : undefined}
        >
          <span id={monthLabelId} className={styles.label}>
            Tháng biên lai
          </span>
          <MonthPicker
            value={watch("receiptMonth")}
            monthsAhead={12}
            onChange={(m) => setValue("receiptMonth", m, { shouldDirty: true })}
          />
          {errors.receiptMonth && (
            <span id={monthErrorId} className={styles.error} role="alert">
              {errors.receiptMonth.message}
            </span>
          )}
        </div>
        <Select
          block
          label="Phương án"
          error={errors.plan?.message}
          value={watch("plan")}
          onChange={(v) => setValue("plan", SocialInsurancePlan.parse(v), { shouldDirty: true })}
          options={SocialInsurancePlan.options.map((p) => ({ value: p, label: PLAN_LABEL[p] }))}
        />
        <TextField
          label="Số tháng"
          inputMode="numeric"
          maxLength={3}
          error={errors.months?.message}
          {...numericField(register("months"), digitsOnly)}
        />
        <TextField
          label="Số tiền thu"
          inputMode="decimal"
          maxLength={20}
          error={errors.collected?.message}
          {...numericField(register("collected"), decimalOnly)}
        />
        <TextField
          label="Số tiền chi"
          inputMode="decimal"
          maxLength={20}
          error={errors.paid?.message}
          {...numericField(register("paid"), decimalOnly)}
        />
        <TextField label="CTV" {...register("collaborator")} />
        <Combobox
          block
          required
          label="Nhân viên ATM"
          placeholder="Gõ tên hoặc mã nhân viên…"
          value={watch("entryStaffId")}
          onChange={(v) => setValue("entryStaffId", v, { shouldDirty: true })}
          error={errors.entryStaffId?.message}
          options={staffOptions}
        />
      </form>
    </Dialog>
  );
}
