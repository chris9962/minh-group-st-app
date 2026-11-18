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
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import {
  GIFT_CATEGORY_LABEL,
  GiftCategory,
  GiftShopProductForm,
  createGiftShopProduct,
  updateGiftShopProduct,
  type GiftShopProduct,
} from "@/lib/api/giftShops";
import { reportInvalid } from "@/lib/formErrors";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./GiftShopProductFormDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  shopId: string;
  /** Có thì là sửa, không có thì là thêm sản phẩm mới. */
  product?: GiftShopProduct | null;
};

export function GiftShopProductFormDialog({ open, onClose, shopId, product }: Props) {
  const queryClient = useQueryClient();
  const [photos, setPhotos] = useState<PhotoItem[]>(() =>
    savedPhotos(product?.imageUrl ? [product.imageUrl] : []),
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<GiftShopProductForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(GiftShopProductForm),
    defaultValues: {
      name: product?.name ?? "",
      price: product?.price ?? "",
      link: product?.link ?? "",
      imageUrl: product?.imageUrl ?? "",
      category: product?.category ?? "other",
      active: product?.active ?? true,
    },
  });

  const save = useMutation({
    mutationFn: async (form: GiftShopProductForm) => {
      // Ảnh lên kho trước rồi mới ghi sản phẩm, cùng lý do với ảnh QR ở `ReferralCodeFormDialog`.
      const [uploaded] = await uploadPendingPhotos(photos, "gift-shops");
      const body = { ...form, imageUrl: uploaded ?? "" };
      return product ? updateGiftShopProduct(shopId, product.id, body) : createGiftShopProduct(shopId, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gift-shop-products", shopId] });
      // Cột "Sản phẩm" của bảng shop đếm số sản phẩm.
      queryClient.invalidateQueries({ queryKey: ["gift-shops"] });
      onClose();
      toast.ok("Đã lưu sản phẩm");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được sản phẩm này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={product ? "Sửa sản phẩm" : "Thêm sản phẩm"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="gift-shop-product-form" disabled={isSubmitting || save.isPending}>
            {product ? "Lưu" : "Thêm sản phẩm"}
          </Button>
        </>
      }
    >
      <form
        id="gift-shop-product-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
        noValidate
      >
        <TextField
          label="Tên sản phẩm"
          required
          error={errors.name?.message}
          {...register("name")}
        />
        <Select
          block
          required
          label="Loại quà"
          value={watch("category")}
          onChange={(v) => setValue("category", GiftCategory.parse(v), { shouldDirty: true })}
          options={GiftCategory.options.map((c) => ({ value: c, label: GIFT_CATEGORY_LABEL[c] }))}
        />
        <TextField
          label="Giá"
          placeholder="89k hoặc 70k - 180k"
          error={errors.price?.message}
          {...register("price")}
        />
        <TextField
          label="Link sản phẩm"
          placeholder="https://s.shopee.vn/…"
          error={errors.link?.message}
          {...register("link")}
        />
        <BankAccountPhotos
          photos={photos}
          requiredPhotos={0}
          max={1}
          title="Ảnh sản phẩm"
          onChange={setPhotos}
          busy={save.isPending}
          compact
        />
        {product && (
          <Checkbox
            label="Đang bán"
            checked={watch("active")}
            onCheckedChange={(v) => setValue("active", v, { shouldDirty: true })}
          />
        )}
      </form>
    </Dialog>
  );
}
