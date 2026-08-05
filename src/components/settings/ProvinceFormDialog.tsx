"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog } from "@/components/ui/Dialog";
import {
  addProvince,
  AddProvinceForm,
  fetchProvinces,
  fetchReferenceProvinces,
} from "@/lib/api/wardCatalog";
import styles from "./ProvinceFormDialog.module.scss";
import { errorMessage, toast } from "@/lib/toast";

type Props = { open: boolean; onClose: () => void };

/**
 * P-71 · Thêm một tỉnh/thành phố "đang triển khai" — tìm trong danh sách
 * tham chiếu cả nước (34 tỉnh), không gõ tay tự do.
 */
export function ProvinceFormDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient();

  const { data: referenceProvinces = [] } = useQuery({
    queryKey: ["reference-provinces"],
    queryFn: fetchReferenceProvinces,
  });
  const { data: provinces = [] } = useQuery({ queryKey: ["provinces"], queryFn: fetchProvinces });
  const availableProvinces = referenceProvinces.filter(
    (p) => !provinces.some((existing) => existing.id === p.id),
  );

  const {
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AddProvinceForm>({
    resolver: zodResolver(AddProvinceForm),
    defaultValues: { provinceId: "" },
  });

  const save = useMutation({
    mutationFn: addProvince,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provinces"] });
      onClose();
      toast.ok("Đã lưu tỉnh/thành phố");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không thêm được tỉnh/thành phố này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Thêm tỉnh/thành phố"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="province-form" disabled={isSubmitting || save.isPending}>
            Thêm
          </Button>
        </>
      }
    >
      <form
        id="province-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        <Combobox
          block
          label="Tỉnh/thành phố"
          placeholder="Gõ để tìm tỉnh/thành phố…"
          value={watch("provinceId")}
          onChange={(v) => setValue("provinceId", v, { shouldDirty: true })}
          options={availableProvinces.map((p) => ({ value: p.id, label: p.name }))}
        />
        {errors.provinceId && <p className={styles.error}>{errors.provinceId.message}</p>}
      </form>
    </Dialog>
  );
}
