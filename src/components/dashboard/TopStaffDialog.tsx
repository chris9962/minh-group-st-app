"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Maximize2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { MonthChoice } from "@/components/ui/MonthChoice";
import { thisMonth } from "@/components/ui/MonthPicker";
import { SkeletonStats } from "@/components/ui/Skeleton";
import { fetchTopStaff } from "@/lib/api/dashboard";
import { shiftMonth } from "@/lib/period";
import { TopStaffCards } from "./TopStaffCards";
import styles from "./TopStaffDialog.module.scss";

/** Cùng trần với route `/api/dashboard/top-staff`. */
const MAX_MONTHS = 12;

const lastMonths = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => shiftMonth(thisMonth(), i - count + 1));

/** `2026-08` thành `8/2026`. */
const shortMonth = (month: string) => `${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

/**
 * Nút mở rộng của khối "Cá nhân xuất sắc" ở P-80: chọn một khoảng tháng liên
 * tiếp, xem người đứng đầu cộng dồn các tháng đó (chốt 2026-10-08).
 */
export function TopStaffDialog() {
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState(() => lastMonths(3));

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["dashboard", "top-staff", months],
    queryFn: () => fetchTopStaff(months),
    enabled: open && months.length > 0,
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <Button
        variant="ghost"
        icon
        aria-label="Xem cá nhân xuất sắc theo nhiều tháng"
        onClick={() => setOpen(true)}
      >
        <Maximize2 size={16} />
      </Button>
      <Dialog open={open} wide title="Cá nhân xuất sắc" onClose={() => setOpen(false)}>
        <div className={styles.layout}>
          <MonthChoice
            range
            label="Khoảng tháng cộng dồn"
            value={months}
            onChange={(next) => {
              if (next.length <= MAX_MONTHS) setMonths(next);
            }}
          />
          <div className={styles.result} aria-busy={isFetching || undefined}>
            {months.length > 0 && (
              <p className={styles.months}>
                {months.length === 1
                  ? shortMonth(months[0])
                  : `${shortMonth(months[0])} - ${shortMonth(months[months.length - 1])}`}
              </p>
            )}
            {isError ? (
              <ErrorState what="cá nhân xuất sắc" onRetry={refetch} retrying={isFetching} />
            ) : months.length > 0 && isPending ? (
              <SkeletonStats count={4} label="Đang tải cá nhân xuất sắc" />
            ) : (
              <TopStaffCards top={months.length > 0 ? (data ?? null) : null} columns={2} />
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}
