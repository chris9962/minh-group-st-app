"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { fetchServiceTypes } from "@/lib/api/settings";
import { businessDay } from "@/lib/format";
import { createService, ServiceForm } from "@/lib/api/services";
import styles from "./ServiceFormDialog.module.scss";
import { invalidateKpi } from "@/lib/invalidateKpi";
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
    defaultValues: { customerId, serviceTypeId: "", date: businessDay(), note: "" },
  });

  const save = useMutation({
    // Người thực hiện do máy chủ tự ghi từ phiên đăng nhập — gửi kèm `actorId`
    // là mở đường ghi công của mình vào tên người khác.
    mutationFn: (form: ServiceForm) => createService(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      // Card "Dịch vụ đã làm" ở hồ sơ 360° đọc từ key này — không invalidate
      // thì ghi xong quay lại trang chi tiết vẫn thấy danh sách cũ.
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      invalidateKpi(queryClient);
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

        {/* Mặc định hôm nay, sửa được: làm cho khách ngày 31 mà mùng 2 mới
            ngồi nhập thì lượt đó phải tính vào tháng ĐÃ LÀM, không phải tháng
            nhập liệu. Máy chủ chặn ngày tương lai. */}
        <TextField
          label="Ngày thực hiện"
          type="date"
          max={businessDay()}
          error={errors.date?.message}
          {...register("date")}
        />

        <TextField
          label="Ghi chú công việc"
          placeholder="Đã hỗ trợ khách nạp tiền điện thoại…"
          {...register("note")}
        />
      </form>
    </Dialog>
  );
}
