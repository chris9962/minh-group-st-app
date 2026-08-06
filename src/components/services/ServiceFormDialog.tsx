"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { fetchServiceTypes } from "@/lib/api/settings";
import { createService, ServiceForm } from "@/lib/api/services";
import { useSession } from "@/store/session";
import styles from "./ServiceFormDialog.module.scss";
import { errorMessage, toast } from "@/lib/toast";

type Props = {
  open: boolean;
  onClose: () => void;
  customerId: string;
  customerName: string;
};

/**
 * P-30 · Ghi dịch vụ đã hỗ trợ khách — bật từ bảng khách hàng (P-40), giống
 * luồng Tặng quà / Mở ngân hàng. Dịch vụ hiện KHÔNG thu phí (đã chốt ở spec).
 */
export function ServiceFormDialog({ open, onClose, customerId, customerName }: Props) {
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ["service-types"],
    queryFn: fetchServiceTypes,
  });
  const activeTypes = serviceTypes.filter((t) => t.active);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ServiceForm>({
    resolver: zodResolver(ServiceForm),
    defaultValues: { customerId, serviceTypeId: "", note: "" },
  });

  const save = useMutation({
    mutationFn: (form: ServiceForm) => createService(form, actor?.id ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      onClose();
      toast.ok(`Đã ghi dịch vụ cho ${customerName}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không ghi được dịch vụ này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Ghi dịch vụ · ${customerName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="service-form" disabled={isSubmitting || save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <form
        id="service-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        {save.isError && <Alert tone="error">Không lưu được dịch vụ này.</Alert>}

        <Select
          block
          label="Loại dịch vụ"
          value={watch("serviceTypeId")}
          onChange={(v) => setValue("serviceTypeId", v, { shouldDirty: true })}
          options={[
            { value: "", label: "— Chọn loại dịch vụ —" },
            ...activeTypes.map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
        {errors.serviceTypeId && <p className={styles.error}>{errors.serviceTypeId.message}</p>}

        <TextField
          label="Ghi chú công việc"
          placeholder="Đã hỗ trợ khách nạp tiền điện thoại…"
          {...register("note")}
        />
      </form>
    </Dialog>
  );
}
