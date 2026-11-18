"use client";

import { useQuery } from "@tanstack/react-query";
import { Package, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  GIFT_CATEGORY_LABEL,
  fetchGiftShopProducts,
  type GiftShop,
  type GiftShopProduct,
} from "@/lib/api/giftShops";
import { GiftShopProductFormDialog } from "./GiftShopProductFormDialog";
import styles from "./GiftShopProductSection.module.scss";

export function GiftShopProductSection({ shop }: { shop: GiftShop }) {
  const [editing, setEditing] = useState<GiftShopProduct | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: products = [], isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["gift-shop-products", shop.id],
    queryFn: () => fetchGiftShopProducts(shop.id),
  });

  const columns: RankColumn<GiftShopProduct>[] = [
    {
      key: "image",
      label: "Ảnh",
      render: (p) =>
        p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- ảnh đi qua /api/images có kiểm phiên, next/image không đọc được
          <img src={p.imageUrl} alt="" width={48} height={48} loading="lazy" className={styles.thumb} />
        ) : (
          <span className={styles.noThumb}>—</span>
        ),
    },
    {
      key: "name",
      label: "Tên sản phẩm",
      render: (p) =>
        p.link ? (
          <a href={p.link} target="_blank" rel="noreferrer">
            {p.name}
          </a>
        ) : (
          p.name
        ),
    },
    {
      key: "category",
      label: "Loại",
      sortText: (p) => GIFT_CATEGORY_LABEL[p.category],
      render: (p) => GIFT_CATEGORY_LABEL[p.category],
    },
    { key: "price", label: "Giá", render: (p) => p.price || "—" },
    {
      key: "active",
      label: "Trạng thái",
      render: (p) => <StatusTag ok={p.active}>{p.active ? "Đang bán" : "Ngừng bán"}</StatusTag>,
    },
    {
      key: "actions",
      label: "Thao tác",
      render: (p) => (
        <span className={styles.actions}>
          <Button
            variant="secondary"
            icon
            tooltip="Sửa sản phẩm"
            aria-label={`Sửa sản phẩm ${p.name}`}
            onClick={() => setEditing(p)}
          >
            <Pencil size={16} aria-hidden />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <SectionCard
        title="Sản phẩm"
        icon={<Package size={17} />}
        meta={isPending ? undefined : `${products.length} sản phẩm`}
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            Thêm sản phẩm
          </Button>
        }
      >
        {isPending && <SkeletonTable rows={4} columns={5} />}
        {isError && <ErrorState what="danh sách sản phẩm" onRetry={refetch} retrying={isFetching} />}

        {!isPending && !isError && (
          <RankTable
            rows={products}
            columns={columns}
            rowKey={(p) => p.id}
            defaultSort="name"
            pageSize={10}
            caption={`Sản phẩm của shop ${shop.name}`}
            emptyText="Chưa có sản phẩm — bấm “Thêm sản phẩm” ở đầu khối."
          />
        )}
      </SectionCard>

      {(creating || editing) && (
        <GiftShopProductFormDialog
          open
          shopId={shop.id}
          product={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
