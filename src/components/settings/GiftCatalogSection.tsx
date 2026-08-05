"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Package, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { TextField } from "@/components/ui/TextField";
import {
  CatalogItemForm,
  createGiftItem,
  fetchGiftItems,
  fetchInsurancePackages,
  packageTotalFee,
  setGiftItemActive,
  setInsurancePackageActive,
  type GiftItem,
  type InsurancePackage,
} from "@/lib/api/settings";
import { formatVnd } from "@/lib/format";
import { InsurancePackageFormDialog } from "./InsurancePackageFormDialog";
import styles from "./GiftCatalogSection.module.scss";
import { errorMessage, toast } from "@/lib/toast";

/** P-82 · Danh mục quà & gói bảo hiểm — hai bảng cạnh nhau. */
export function GiftCatalogSection() {
  const queryClient = useQueryClient();
  const [editingPackage, setEditingPackage] = useState<InsurancePackage | null>(null);
  const [creatingPackage, setCreatingPackage] = useState(false);
  const [confirmingGift, setConfirmingGift] = useState<GiftItem | null>(null);
  const [confirmingPackage, setConfirmingPackage] = useState<InsurancePackage | null>(null);

  const { data: giftItems = [] } = useQuery({
    queryKey: ["gift-items"],
    queryFn: fetchGiftItems,
  });
  const { data: packages = [] } = useQuery({
    queryKey: ["insurance-packages"],
    queryFn: fetchInsurancePackages,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CatalogItemForm>({
    resolver: zodResolver(CatalogItemForm),
    defaultValues: { name: "" },
  });

  const addGiftItem = useMutation({
    mutationFn: createGiftItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gift-items"] });
      reset();
      toast.ok("Đã thêm món quà");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không thêm được món quà này.")),
  });

  const toggleGiftItem = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => setGiftItemActive(id, next),
    onSuccess: (_item, { next }) => {
      queryClient.invalidateQueries({ queryKey: ["gift-items"] });
      toast.ok(next ? "Đã bật lại món quà" : "Đã ngừng món quà");
      setConfirmingGift(null);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đổi được trạng thái món quà này.")),
  });

  const togglePackage = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      setInsurancePackageActive(id, next),
    onSuccess: (_item, { next }) => {
      queryClient.invalidateQueries({ queryKey: ["insurance-packages"] });
      toast.ok(next ? "Đã bật lại gói bảo hiểm" : "Đã ngừng gói bảo hiểm");
      setConfirmingPackage(null);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đổi được trạng thái gói này.")),
  });

  return (
    <div className={styles.columns}>
      <SectionCard title="Vật phẩm" icon={<Gift size={17} />} meta={`${giftItems.length} món`}>
        <ul className={styles.list}>
          {giftItems.map((g) => (
            <li key={g.id}>
              <span>{g.name}</span>
              <span className={styles.rowActions}>
                <StatusTag ok={g.active}>{g.active ? "Đang dùng" : "Đã ngừng"}</StatusTag>
                <Button
                  variant="secondary"
                  disabled={toggleGiftItem.isPending}
                  onClick={() => setConfirmingGift(g)}
                >
                  {g.active ? "Ngừng" : "Dùng lại"}
                </Button>
              </span>
            </li>
          ))}
        </ul>

        <form
          className={styles.addForm}
          onSubmit={handleSubmit((form) => addGiftItem.mutate(form))}
          noValidate
        >
          <TextField
            label="Tên vật phẩm mới"
            placeholder="Ô dù"
            error={errors.name?.message}
            {...register("name")}
          />
          <Button type="submit" disabled={addGiftItem.isPending}>
            <Plus size={16} />
            Thêm
          </Button>
        </form>
      </SectionCard>

      <SectionCard
        title="Gói bảo hiểm"
        icon={<Package size={17} />}
        meta={`${packages.length} gói`}
      >
        <ul className={styles.list}>
          {packages.map((p) => (
            <li key={p.id}>
              <span>
                {p.name}{" "}
                  <span className="tabular-nums">
                    · {formatVnd(packageTotalFee(p))} · {p.legs.length} đơn
                  </span>
              </span>
              <span className={styles.rowActions}>
                <StatusTag ok={p.active}>{p.active ? "Đang dùng" : "Đã ngừng"}</StatusTag>
                <Button
                  variant="secondary"
                  icon
                  aria-label={`Sửa ${p.name}`}
                  onClick={() => setEditingPackage(p)}
                >
                  <Pencil size={16} aria-hidden />
                </Button>
                <Button
                  variant="secondary"
                  disabled={togglePackage.isPending}
                  onClick={() => setConfirmingPackage(p)}
                >
                  {p.active ? "Ngừng" : "Dùng lại"}
                </Button>
              </span>
            </li>
          ))}
        </ul>

        <div className={styles.footRow}>
          <Button onClick={() => setCreatingPackage(true)}>
            <Plus size={16} />
            Thêm gói bảo hiểm
          </Button>
        </div>
      </SectionCard>

      {(creatingPackage || editingPackage) && (
        <InsurancePackageFormDialog
          open
          insurancePackage={editingPackage}
          onClose={() => {
            setCreatingPackage(false);
            setEditingPackage(null);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmingGift !== null}
        title={confirmingGift?.active ? "Ngừng vật phẩm" : "Dùng lại vật phẩm"}
        confirmLabel={confirmingGift?.active ? "Ngừng" : "Dùng lại"}
        pending={toggleGiftItem.isPending}
        onConfirm={() =>
          confirmingGift &&
          toggleGiftItem.mutate({ id: confirmingGift.id, next: !confirmingGift.active })
        }
        onClose={() => setConfirmingGift(null)}
        consequence={
          confirmingGift?.active ? (
            <>
              Món này <strong>không vào rổ quà của khách mới nữa</strong>. Quà đã
              tặng vẫn nằm nguyên trong lịch sử của khách, dùng lại lúc nào cũng được.
            </>
          ) : (
            <>Món này lại được xét vào rổ quà của khách mới.</>
          )
        }
      >
        {confirmingGift?.active ? "Ngừng vật phẩm " : "Dùng lại vật phẩm "}
        <strong>{confirmingGift?.name}</strong>?
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingPackage !== null}
        title={confirmingPackage?.active ? "Ngừng gói bảo hiểm" : "Dùng lại gói bảo hiểm"}
        confirmLabel={confirmingPackage?.active ? "Ngừng" : "Dùng lại"}
        pending={togglePackage.isPending}
        onConfirm={() =>
          confirmingPackage &&
          togglePackage.mutate({ id: confirmingPackage.id, next: !confirmingPackage.active })
        }
        onClose={() => setConfirmingPackage(null)}
        consequence={
          confirmingPackage?.active ? (
            <>
              Gói biến mất khỏi ô chọn lúc tạo đơn bảo hiểm nên{" "}
              <strong>không tặng gói này cho khách mới được nữa</strong>. Đơn đã
              tạo vẫn giữ nguyên, dùng lại lúc nào cũng được.
            </>
          ) : (
            <>Gói hiện lại ở ô chọn lúc tạo đơn và tặng cho khách mới được ngay.</>
          )
        }
      >
        {confirmingPackage?.active ? "Ngừng gói " : "Dùng lại gói "}
        <strong>{confirmingPackage?.name}</strong>?
      </ConfirmDialog>
    </div>
  );
}
