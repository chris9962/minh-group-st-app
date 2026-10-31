"use client";

import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import { ACCOUNT_TYPE_LABEL } from "@/lib/api/bankAccounts";
import { fetchMyReferralCodes, type MyReferralCode } from "@/lib/api/bankCatalog";
import { formatCount } from "@/lib/format";
import { usePrefs } from "@/store/prefs";
import styles from "./AvailableReferralCodesDialog.module.scss";

const bankLabel = (c: MyReferralCode) => `${c.bankCode} - ${ACCOUNT_TYPE_LABEL[c.accountType]}`;

const COLUMNS: RankColumn<MyReferralCode>[] = [
  { key: "bank", label: "Ngân hàng", sortText: bankLabel, render: bankLabel },
  {
    key: "progress",
    label: "Đã dùng",
    sortBy: (c) => c.used / c.quota,
    render: (c) => (
      <span className="tabular-nums">
        {formatCount(c.used)}/{formatCount(c.quota)}
      </span>
    ),
  },
  {
    key: "code",
    label: "Tên hiển thị",
    sortText: (c) => c.displayName,
    render: (c) => c.displayName,
  },
  {
    key: "status",
    label: "Trạng thái",
    // "Đã đầy" gồm cả hai: phần riêng dùng hết, hoặc cả mã hết chỗ dù phần riêng còn.
    render: (c) =>
      !c.active ? (
        <StatusTag ok={false}>Đã ngừng</StatusTag>
      ) : c.used >= c.quota || c.codeFull ? (
        <StatusTag ok={false}>Đã đầy</StatusTag>
      ) : (
        <StatusTag ok>Còn chỗ</StatusTag>
      ),
  },
];

/**
 * Nút MGT của NHÂN VIÊN (chốt 2026-10-19): xem mã Trưởng phòng đã chia cho
 * mình và đã dùng bao nhiêu trên phần đó. Chỉ để xem — ô chọn mã lúc mở tài
 * khoản không đổi, máy chủ tự giới hạn theo phần được chia.
 *
 * Mã dùng chung cả phòng hay cả công ty không hiện ở đây: chúng không phải
 * phần riêng của ai. Ô "Ẩn mã đã đầy và đã ngừng" dùng chung tuỳ chọn với
 * modal của Trưởng phòng, nhớ theo máy.
 */
export function MyReferralCodesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const hideUnusable = usePrefs((s) => s.hideUnusableReferralCodes);
  const setHideUnusable = usePrefs((s) => s.setHideUnusableReferralCodes);

  const { data: codes = [], isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["referral-codes", "mine", hideUnusable],
    queryFn: () => fetchMyReferralCodes(hideUnusable),
    enabled: open,
  });

  const used = codes.reduce((sum, c) => sum + c.used, 0);
  const quota = codes.reduce((sum, c) => sum + c.quota, 0);

  return (
    <>
      <Dialog open={open} full title="Mã giới thiệu của tôi" onClose={onClose}>
        <div className={styles.filters}>
          <Checkbox
            label="Ẩn mã đã đầy và đã ngừng"
            checked={hideUnusable}
            onCheckedChange={setHideUnusable}
          />
        </div>
        {isError ? (
          <ErrorState what="mã giới thiệu của bạn" onRetry={refetch} retrying={isFetching} />
        ) : isPending ? (
          <SkeletonTable rows={4} columns={COLUMNS.length} label="Đang tải mã giới thiệu" />
        ) : (
          <RankTable
            rows={codes}
            columns={COLUMNS}
            rowKey={(c) => c.id}
            defaultSort="server"
            caption="Mã giới thiệu được chia cho tôi, kèm số đã dùng trên phần được chia và trạng thái"
            emptyText={
              hideUnusable
                ? "Không có mã nào còn chỗ được chia cho bạn."
                : "Trưởng phòng chưa chia mã nào cho bạn."
            }
            summaryRow={
              codes.length > 0
                ? ["Tổng", `${formatCount(used)}/${formatCount(quota)}`, `${formatCount(codes.length)} mã`, ""]
                : undefined
            }
          />
        )}
      </Dialog>
    </>
  );
}
