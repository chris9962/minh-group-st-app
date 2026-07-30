"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog } from "@/components/ui/Dialog";
import { addWard, AddWardForm, fetchReferenceWards, type Province } from "@/lib/api/wardCatalog";
import styles from "./WardFormDialog.module.scss";

type Props = { open: boolean; onClose: () => void; province: Province };

/**
 * P-71 · Thêm một xã/phường vào tỉnh đã chọn — tìm trong danh sách tham
 * chiếu (đã lọc theo tỉnh này), không gõ tay tự do như trước.
 */
export function WardFormDialog({ open, onClose, province }: Props) {
  const queryClient = useQueryClient();

  const { data: referenceWards = [] } = useQuery({
    queryKey: ["reference-wards", province.id],
    queryFn: () => fetchReferenceWards(province.id),
  });
  const availableWards = referenceWards.filter(
    (w) => !province.wards.some((existing) => existing.id === w.id),
  );

  const {
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AddWardForm>({
    resolver: zodResolver(AddWardForm),
    defaultValues: { provinceId: province.id, wardId: "" },
  });

  const save = useMutation({
    mutationFn: addWard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provinces"] });
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Thêm xã/phường · ${province.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="ward-form" disabled={isSubmitting || save.isPending}>
            Thêm
          </Button>
        </>
      }
    >
      <form
        id="ward-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        {save.isError && <Alert tone="error">Không thêm được xã/phường này.</Alert>}
        <Combobox
          block
          label="Xã/phường"
          placeholder="Gõ để tìm xã/phường…"
          value={watch("wardId")}
          onChange={(v) => setValue("wardId", v, { shouldDirty: true })}
          options={availableWards.map((w) => ({ value: w.id, label: w.name }))}
        />
        {errors.wardId && <p className={styles.error}>{errors.wardId.message}</p>}
      </form>
    </Dialog>
  );
}
