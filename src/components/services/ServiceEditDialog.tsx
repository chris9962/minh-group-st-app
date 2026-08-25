"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { DateField } from "@/components/ui/DateField";
import { TextField } from "@/components/ui/TextField";
import { ServiceEditForm, updateService, type ServiceRow } from "@/lib/api/services";
import { fetchServiceTypes } from "@/lib/api/settings";
import { businessDay, formatDate } from "@/lib/format";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./ServiceFormDialog.module.scss";
import { reportInvalid } from "@/lib/formErrors";

type Props = {
  open: boolean;
  onClose: () => void;
  service: ServiceRow;
};

/**
 * Sửa một lượt dịch vụ đã ghi — chỉ LOẠI và GHI CHÚ.
 *
 * KHÔNG có nút Xoá ở đây: bảng bên ngoài đã có nút xoá kèm hộp xác nhận. Một
 * hành động thì một đường, và đường đó phải hỏi lại.
 *
 * Khách, người thực hiện và ngày hiện ra để đối chiếu nhưng không sửa được:
 * chúng là ảnh chụp của một việc đã xảy ra. Đổi khách là biến bản ghi này thành
 * một việc khác hẳn; đổi người thực hiện là chuyển công sang người khác.
 */
export function ServiceEditDialog({ open, onClose, service }: Props) {
  const queryClient = useQueryClient();

  const { data: serviceTypes = [], isError: typesError } = useQuery({
    queryKey: ["service-types"],
    queryFn: fetchServiceTypes,
  });

  /**
   * Loại ĐANG dùng luôn có trong ô chọn, kể cả khi nó đã bị ngừng.
   *
   * Lọc thẳng `active` thì một bản ghi cũ mang loại đã ngừng sẽ mở ra với ô
   * chọn trống — nhìn như dữ liệu hỏng, và bấm Lưu là vô tình đổi sang loại
   * khác. Máy chủ cũng cho giữ nguyên loại đã ngừng, chỉ chặn khi ĐỔI SANG nó.
   */
  const options = serviceTypes
    .filter((t) => t.active || t.id === service.serviceTypeId)
    .map((t) => ({
      value: t.id,
      label: t.active ? t.name : `${t.name} (đã ngừng)`,
    }));

  /**
   * Danh mục tải hỏng thì ô chọn rỗng, mà `<select>` có `value` không khớp
   * option nào sẽ hiện TRẮNG — nhìn như dữ liệu hỏng, trong khi bấm Lưu thật ra
   * vẫn giữ đúng loại cũ. Chèn một option giữ chỗ mang đúng tên đang dùng.
   */
  const fallback = [{ value: service.serviceTypeId, label: service.serviceTypeName }];

  const form = useForm<ServiceEditForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(ServiceEditForm),
    defaultValues: {
      serviceTypeId: service.serviceTypeId,
      date: service.date,
      note: service.note,
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["services"] });
    // Đổi loại dịch vụ là đổi điểm KPI (hệ số nằm ở loại) — bảng nhân sự phải
    // tải lại, không thì số cũ còn nằm đó tới khi hết staleTime.
    invalidateKpi(queryClient);
  };

  const save = useMutation({
    mutationFn: (values: ServiceEditForm) => updateService(service.id, values),
    onSuccess: () => {
      invalidate();
      onClose();
      toast.ok("Đã lưu thay đổi");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được thay đổi này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Sửa dịch vụ"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="service-edit-form" disabled={save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <form
        id="service-edit-form"
        className={styles.form}
        onSubmit={form.handleSubmit((values) => save.mutate(values), reportInvalid)}
        noValidate
      >
        <p className="text-muted">
          {service.customerName} · {service.createdByName}
        </p>

        <Select
          block
          label="Loại dịch vụ"
          value={form.watch("serviceTypeId")}
          onChange={(v) => form.setValue("serviceTypeId", v, { shouldDirty: true })}
          options={options.length > 0 ? options : fallback}
          error={typesError ? "Không tải được danh mục loại dịch vụ — chỉ giữ được loại hiện tại." : undefined}
        />

        {/* Đổi ngày là ĐỔI THÁNG TÍNH ĐIỂM — máy chủ tính lại KPI cho cả tháng
            cũ lẫn tháng mới. Chặn ngày tương lai: đây là sổ việc ĐÃ LÀM. */}
        <DateField
          label="Ngày thực hiện"
          max={businessDay()}
          error={form.formState.errors.date?.message}
          value={form.watch("date")}
          onChange={(v) => form.setValue("date", v, { shouldDirty: true, shouldValidate: true })}
        />

        <TextField label="Ghi chú" placeholder="Không bắt buộc" {...form.register("note")} />
      </form>
    </Dialog>
  );
}
