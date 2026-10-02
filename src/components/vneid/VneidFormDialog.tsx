"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  BankAccountPhotos,
  savedPhotos,
  uploadPendingPhotos,
  type PhotoItem,
} from "@/components/banking/BankAccountPhotos";
import { DepartmentPicker } from "@/components/layout/DepartmentPicker";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import {
  createVneidRecord,
  MAX_VNEID_PHOTOS,
  updateVneidRecord,
  VNEID_TASKS,
  VneidForm,
  type VneidRow,
} from "@/lib/api/vneid";
import { reportInvalid } from "@/lib/formErrors";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./VneidFormDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  customerId: string;
  customerName: string;
  /** Phòng của hồ sơ khách — mặc định cho ô "Ghi nhận vào phòng". */
  customerDepartmentId?: string | null;
  /** Có thì là form SỬA lượt này: khách, người làm và phòng giữ nguyên. */
  record?: VneidRow;
  /** Bước 2 của `CustomerPickerDialog` — quay về chọn khách khác. */
  onBack?: () => void;
};

export function VneidFormDialog({
  open,
  onClose,
  customerId,
  customerName,
  customerDepartmentId,
  record,
  onBack,
}: Props) {
  const queryClient = useQueryClient();
  const [photos, setPhotos] = useState<PhotoItem[]>(() => savedPhotos(record?.photoUrls ?? []));

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<VneidForm>({
    shouldFocusError: false,
    resolver: zodResolver(VneidForm),
    defaultValues: {
      customerId,
      healthInsurance: record?.healthInsurance ?? false,
      socialWelfare: record?.socialWelfare ?? false,
      digitalSignature: record?.digitalSignature ?? false,
      photoUrls: [],
      note: record?.note ?? "",
      departmentId: customerDepartmentId ?? "",
    },
  });

  const save = useMutation({
    mutationFn: async (form: VneidForm) => {
      // Ảnh lên kho TRƯỚC, ghi bản ghi SAU — xem chú thích ở `BankAccountPhotos`.
      const photoUrls = await uploadPendingPhotos(photos, "vneid");
      if (photoUrls.length > 0) setPhotos(savedPhotos(photoUrls));
      if (!record) return createVneidRecord({ ...form, photoUrls });
      return updateVneidRecord(record.id, {
        healthInsurance: form.healthInsurance,
        socialWelfare: form.socialWelfare,
        digitalSignature: form.digitalSignature,
        note: form.note,
        photoUrls,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vneid"] });
      onClose();
      toast.ok(record ? "Đã lưu thay đổi" : `Đã ghi VNeID cho ${customerName}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được lượt VNeID này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={record ? "Sửa lượt VNeID" : `Tích hợp VNeID - ${customerName}`}
      footerStart={onBack && <BackButton onClick={onBack}>Chọn khách khác</BackButton>}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="vneid-form" disabled={save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <form
        id="vneid-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
        noValidate
      >
        {record ? (
          <p className="text-muted">
            {record.customerName} - {record.createdByName}
          </p>
        ) : (
          <DepartmentPicker
            module="vneid"
            value={watch("departmentId")}
            onChange={(v) => setValue("departmentId", v, { shouldDirty: true })}
          />
        )}

        <fieldset className={styles.tasks}>
          <legend className={styles.legend}>Việc đã làm</legend>
          {VNEID_TASKS.map((task) => (
            <Checkbox
              key={task.key}
              label={task.label}
              checked={watch(task.key)}
              disabled={save.isPending}
              onCheckedChange={(on) =>
                setValue(task.key, on, { shouldDirty: true, shouldValidate: true })
              }
            />
          ))}
        </fieldset>
        {errors.healthInsurance && <p className={styles.error}>{errors.healthInsurance.message}</p>}

        <BankAccountPhotos
          title="Ảnh"
          requiredPhotos={0}
          max={MAX_VNEID_PHOTOS}
          small
          contain
          photos={photos}
          onChange={setPhotos}
          busy={save.isPending}
        />

        <TextField label="Ghi chú" placeholder="Không bắt buộc" {...register("note")} />
      </form>
    </Dialog>
  );
}
