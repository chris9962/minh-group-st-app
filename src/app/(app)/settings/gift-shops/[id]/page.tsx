"use client";

import { useQuery } from "@tanstack/react-query";
import { use } from "react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { GiftShopProductSection } from "@/components/settings/GiftShopProductSection";
import { BackLink } from "@/components/ui/BackLink";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import { fetchGiftShop } from "@/lib/api/giftShops";
import styles from "./page.module.scss";

export default function GiftShopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: shop, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["gift-shops", id],
    queryFn: () => fetchGiftShop(id),
  });

  return (
    <RequirePermission module="system" action="configure-catalog">
      <TopBar title={shop?.name ?? "Shop mua quà"} keepTitleOnMobile />
      <main className={styles.body}>
        <BackLink href="/settings/gift-shops">Shop mua quà ShopeePay</BackLink>

        {isPending && <SkeletonTable rows={4} columns={5} />}
        {isError && <ErrorState what="shop này" onRetry={refetch} retrying={isFetching} />}

        {shop && (
          <>
            <p className={styles.summary}>
              <StatusTag ok={shop.active}>{shop.active ? "Đang dùng" : "Đã ngừng"}</StatusTag>
              <span>{shop.todayCount} đơn trong ngày</span>
              <span>{shop.totalCount} tổng đơn</span>
              {shop.link && (
                <a href={shop.link} target="_blank" rel="noreferrer">
                  Mở shop trên Shopee
                </a>
              )}
            </p>
            <GiftShopProductSection shop={shop} />
          </>
        )}
      </main>
    </RequirePermission>
  );
}
