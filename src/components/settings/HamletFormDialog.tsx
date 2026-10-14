"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { createHamlet, updateHamlet, HamletForm, type Hamlet, type Ward } from "@/lib/api/wardCatalog";
import styles from "./WardFormDialog.module.scss";
import { errorMessage, toast } from "@/lib/toast";
import { reportInvalid } from "@/lib/formErrors";

type Props = { open: boolean; onClose: () => void; ward: Ward; hamlet?: Hamlet };

/**
 * P-71 · Thêm một ấp vào xã đã chọn sẵn; truyền `hamlet` thì thành sửa ấp đó.
 *
 * Người liên hệ nhiều dòng (chốt 2026-10-14): chức vụ, họ tên, số điện thoại.
 * Form mở sẵn một dòng "Trưởng ấp" cho ấp chưa có ai; dòng để trống tên lẫn SĐT
 * bị bỏ lúc lưu nên không bắt điền.
 */
export function HamletFormDialog({ open, onClose, ward, hamlet }: Props) {
  const queryClient = useQueryClient();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<HamletForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(HamletForm),
    defaultValues: {
      wardId: ward.id,
      name: hamlet?.name ?? "",
      contacts:
        hamlet && hamlet.contacts.length > 0
          ? hamlet.contacts.map(({ title, name, phone }) => ({ title, name, phone }))
          : [{ title: "Trưởng ấp", name: "", phone: "" }],
    },
  });
  const contacts = useFieldArray({ control, name: "contacts" });

  const save = useMutation({
    mutationFn: (form: HamletForm) =>
      hamlet
        ? updateHamlet(hamlet.id, { name: form.name, contacts: form.contacts })
        : createHamlet(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provinces"] });
      onClose();
      toast.ok("Đã lưu ấp");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được ấp này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={hamlet ? `Sửa ấp - ${ward.name}` : `Thêm ấp - ${ward.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="hamlet-form" disabled={isSubmitting || save.isPending}>
            {hamlet ? "Lưu" : "Tạo ấp"}
          </Button>
        </>
      }
    >
      <form
        id="hamlet-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
        noValidate
      >
        <input type="hidden" {...register("wardId")} />
        <TextField
          label="Tên ấp"
          required
          placeholder="Ấp 4"
          error={errors.name?.message}
          {...register("name")}
        />

        <fieldset className={styles.contacts}>
          <legend className={styles.legend}>Người liên hệ</legend>
          {contacts.fields.map((field, i) => (
            <div key={field.id} className={styles.contact}>
              <TextField
                label="Chức vụ"
                placeholder="Trưởng ấp"
                autoComplete="off"
                error={errors.contacts?.[i]?.title?.message}
                {...register(`contacts.${i}.title`)}
              />
              <TextField
                label="Họ tên"
                placeholder="Nguyễn Văn A"
                autoComplete="off"
                error={errors.contacts?.[i]?.name?.message}
                {...register(`contacts.${i}.name`)}
              />
              <TextField
                label="Số điện thoại"
                placeholder="0901 234 567"
                inputMode="tel"
                autoComplete="off"
                error={errors.contacts?.[i]?.phone?.message}
                {...register(`contacts.${i}.phone`)}
              />
              <Button
                variant="secondary"
                icon
                tooltip="Bỏ liên hệ này"
                aria-label={`Bỏ liên hệ ${i + 1}`}
                onClick={() => contacts.remove(i)}
              >
                <Trash2 size={16} aria-hidden />
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              onClick={() => contacts.append({ title: "", name: "", phone: "" })}
            >
              <Plus size={16} aria-hidden />
              Thêm liên hệ
            </Button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
