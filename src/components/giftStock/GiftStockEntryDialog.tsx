"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import {
  createGiftStockEntry,
  GiftStockEntryForm,
  updateGiftStockEntry,
  type GiftStockEntry,
} from "@/lib/api/giftStock";
import { fetchGiftItems } from "@/lib/api/settings";
import { reportInvalid } from "@/lib/formErrors";
import { formatDateTime } from "@/lib/format";
import { digitsOnly, numberValue, numericField } from "@/lib/numberField";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./GiftStockEntryDialog.module.scss";

/** 7 chữ số đủ cho trần 1.000.000; số lớn hơn trong khoảng đó do schema báo lỗi. */
const quantityDigits = (v: string) => digitsOnly(v).slice(0, 7);

type Props = {
  onClose: () => void;
  /** Có thì là sửa một lần nhập, không có thì là nhập quà mới. */
  entry?: GiftStockEntry | null;
};

/** P-87 · Nhập quà hoặc sửa một lần nhập quà. Sửa không đổi được món. */
export function GiftStockEntryDialog({ onClose, entry }: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(entry);
  const gifts = useQuery({ queryKey: ["gift-items"], queryFn: fetchGiftItems, enabled: !editing });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<GiftStockEntryForm>({
    shouldFocusError: false,
    resolver: zodResolver(GiftStockEntryForm),
    defaultValues: {
      giftItemId: entry?.giftItemId ?? "",
      quantity: entry?.quantity,
      note: entry?.note ?? "",
    },
  });
  const giftItemId = watch("giftItemId");

  const save = useMutation({
    mutationFn: (form: GiftStockEntryForm) =>
      entry
        ? updateGiftStockEntry(entry.id, { quantity: form.quantity, note: form.note })
        : createGiftStockEntry(form),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["gift-stock"] });
      onClose();
      toast.ok(editing ? "Đã sửa lần nhập quà" : `Đã nhập ${saved.quantity} ${saved.itemName}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được lần nhập quà.")),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? "Sửa lần nhập quà" : "Nhập quà"}
      narrow
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="gift-stock-entry-form" disabled={isSubmitting || save.isPending}>
            {editing ? "Lưu" : "Nhập quà"}
          </Button>
        </>
      }
    >
      <form
        id="gift-stock-entry-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
        noValidate
      >
        {entry ? (
          <dl className={styles.facts}>
            <div>
              <dt>Món quà</dt>
              <dd>{entry.itemName}</dd>
            </div>
            <div>
              <dt>Ngày nhập</dt>
              <dd className="tabular-nums">{formatDateTime(entry.createdAt)}</dd>
            </div>
          </dl>
        ) : (
          <Select
            block
            label="Món quà"
            value={giftItemId}
            error={errors.giftItemId?.message}
            onChange={(v) => setValue("giftItemId", v, { shouldValidate: true })}
            options={[
              { value: "", label: gifts.isPending ? "Đang tải danh mục quà" : "Chọn món quà" },
              ...(gifts.data ?? []).filter((g) => g.active).map((g) => ({ value: g.id, label: g.name })),
            ]}
          />
        )}

        <TextField
          label="Số lượng"
          type="text"
          inputMode="numeric"
          error={errors.quantity?.message}
          {...numericField(register("quantity", { setValueAs: numberValue }), quantityDigits)}
        />

        <TextField label="Ghi chú" error={errors.note?.message} {...register("note")} />
      </form>
    </Dialog>
  );
}
