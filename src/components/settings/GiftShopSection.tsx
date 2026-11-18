"use client";

import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Store } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import { fetchGiftShops, type GiftShop } from "@/lib/api/giftShops";
import { GiftShopFormDialog } from "./GiftShopFormDialog";
import styles from "./GiftShopSection.module.scss";

/**
 * Shop mua quà ShopeePay và số đơn của từng shop. Bước 2 của dòng ShopeePay
 * đặt shop ít đơn trong ngày lên đầu, nên cột "Đơn trong ngày" là cột cần theo dõi.
 */
export function GiftShopSection() {
  const [editing, setEditing] = useState<GiftShop | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: shops = [], isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["gift-shops"],
    queryFn: fetchGiftShops,
  });

  const columns: RankColumn<GiftShop>[] = [
    {
      key: "name",
      label: "Tên shop",
      render: (s) => <Link href={`/settings/gift-shops/${s.id}`}>{s.name}</Link>,
    },
    {
      key: "todayCount",
      label: "Đơn trong ngày",
      align: "right",
      sortBy: (s) => s.todayCount,
      render: (s) => s.todayCount,
    },
    {
      key: "totalCount",
      label: "Tổng đơn",
      align: "right",
      sortBy: (s) => s.totalCount,
      render: (s) => s.totalCount,
    },
    {
      key: "productCount",
      label: "Sản phẩm",
      align: "right",
      sortBy: (s) => s.productCount,
      render: (s) => s.productCount,
    },
    {
      key: "active",
      label: "Trạng thái",
      render: (s) => <StatusTag ok={s.active}>{s.active ? "Đang dùng" : "Đã ngừng"}</StatusTag>,
    },
    {
      key: "actions",
      label: "Thao tác",
      render: (s) => (
        <span className={styles.actions}>
          <Button
            variant="secondary"
            icon
            tooltip="Sửa shop"
            aria-label={`Sửa shop ${s.name}`}
            onClick={() => setEditing(s)}
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
        title="Shop mua quà"
        icon={<Store size={17} />}
        meta={isPending ? undefined : `${shops.length} shop`}
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            Thêm shop
          </Button>
        }
      >
        <p className="text-muted">
          Bước 2 của dòng ShopeePay điền sẵn shop có ít đơn trong ngày nhất. Shop đã ngừng không hiện ở bước 2.
          Bấm tên shop để xem và thêm sản phẩm.
        </p>

        {isPending && <SkeletonTable rows={4} columns={6} />}
        {isError && <ErrorState what="danh sách shop" onRetry={refetch} retrying={isFetching} />}

        {!isPending && !isError && (
          <RankTable
            rows={shops}
            columns={columns}
            rowKey={(s) => s.id}
            defaultSort="name"
            pageSize={10}
            caption="Shop mua quà ShopeePay và số đơn của từng shop"
            emptyText="Chưa có shop nào — bấm “Thêm shop” ở đầu khối."
          />
        )}
      </SectionCard>

      {(creating || editing) && (
        <GiftShopFormDialog
          open
          shop={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
