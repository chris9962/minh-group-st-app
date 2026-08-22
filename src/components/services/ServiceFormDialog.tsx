"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { DepartmentPicker } from "@/components/layout/DepartmentPicker";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { DateField } from "@/components/ui/DateField";
import { TextField } from "@/components/ui/TextField";
import { fetchServiceTypes } from "@/lib/api/settings";
import { fetchProvinces } from "@/lib/api/wardCatalog";
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

  const { data: provinces = [] } = useQuery({
    queryKey: ["provinces"],
    queryFn: fetchProvinces,
  });

  /**
   * Tỉnh chỉ để LỌC danh sách xã, không đi vào bản ghi — `services` chụp xã,
   * còn tỉnh suy được từ xã. Giữ ở state của component chứ không trong biểu mẫu.
   */
  const [provinceId, setProvinceId] = useState("");
  const selectedProvince = provinces.find((p) => p.id === provinceId);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ServiceForm>({
    resolver: zodResolver(ServiceForm),
    defaultValues: {
      customerId,
      serviceTypeId: "",
      date: businessDay(),
      note: "",
      departmentId: "",
      wardId: "",
    },
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

        <DepartmentPicker
          module="services"
          value={watch("departmentId")}
          onChange={(v) => setValue("departmentId", v, { shouldDirty: true })}
        />

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
        <DateField
          label="Ngày thực hiện"
          max={businessDay()}
          error={errors.date?.message}
          value={watch("date")}
          onChange={(v) => setValue("date", v, { shouldDirty: true, shouldValidate: true })}
        />

        {/* Hai ô này ghi XÃ NƠI LÀM DỊCH VỤ. Không bắt buộc: dịch vụ làm ngoài
            địa bàn xã nào cũng ghi nhận được, cột xã để trống. */}
        <Select
          block
          label="Tỉnh/thành phố"
          value={provinceId}
          onChange={(v) => {
            setProvinceId(v);
            setValue("wardId", "", { shouldDirty: true });
          }}
          options={[
            { value: "", label: "— Chọn tỉnh/thành phố —" },
            ...provinces.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />

        {selectedProvince && (
          <Combobox
            block
            label="Xã/phường"
            placeholder="Gõ để tìm xã/phường…"
            value={watch("wardId")}
            onChange={(v) => setValue("wardId", v, { shouldDirty: true })}
            options={selectedProvince.wards.map((w) => ({ value: w.id, label: w.name }))}
          />
        )}

        <TextField
          label="Ghi chú công việc"
          placeholder="Đã hỗ trợ khách nạp tiền điện thoại…"
          {...register("note")}
        />
      </form>
    </Dialog>
  );
}
