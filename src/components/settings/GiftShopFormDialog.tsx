"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { GiftShopForm, createGiftShop, updateGiftShop, type GiftShop } from "@/lib/api/giftShops";
import { reportInvalid } from "@/lib/formErrors";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./GiftShopFormDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là sửa, không có thì là thêm shop mới. */
  shop?: GiftShop | null;
};

export function GiftShopFormDialog({ open, onClose, shop }: Props) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<GiftShopForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(GiftShopForm),
    defaultValues: {
      name: shop?.name ?? "",
      link: shop?.link ?? "",
      active: shop?.active ?? true,
    },
  });

  const save = useMutation({
    mutationFn: (form: GiftShopForm) => (shop ? updateGiftShop(shop.id, form) : createGiftShop(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gift-shops"] });
      onClose();
      toast.ok("Đã lưu shop");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được shop này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={shop ? "Sửa shop" : "Thêm shop"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="gift-shop-form" disabled={isSubmitting || save.isPending}>
            {shop ? "Lưu" : "Thêm shop"}
          </Button>
        </>
      }
    >
      <form
        id="gift-shop-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
        noValidate
      >
        <TextField
          label="Tên shop"
          required
          placeholder="KIDO Group"
          error={errors.name?.message}
          {...register("name")}
        />
        <TextField
          label="Link shop"
          placeholder="https://shopee.vn/…"
          hint="Bước 2 hiện link này thành mã QR. Để trống thì bước 2 dùng link của ngân hàng ShopeePay."
          error={errors.link?.message}
          {...register("link")}
        />
        {shop && (
          <Checkbox
            label="Đang dùng. Bỏ tích thì shop không hiện ở bước 2."
            checked={watch("active")}
            onCheckedChange={(v) => setValue("active", v, { shouldDirty: true })}
          />
        )}
      </form>
    </Dialog>
  );
}
