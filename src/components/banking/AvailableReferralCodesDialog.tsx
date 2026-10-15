"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { Select } from "@/components/ui/Select";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ACCOUNT_TYPE_LABEL } from "@/lib/api/bankAccounts";
import { fetchAvailableReferralCodes, type ReferralCode } from "@/lib/api/bankCatalog";
import { formatCount } from "@/lib/format";
import styles from "./AvailableReferralCodesDialog.module.scss";

// "Đã dùng" đứng ngay sau ngân hàng: trên điện thoại chỉ hai cột đầu lọt màn,
// và đó là hai thứ Trưởng phòng mở modal này để xem.
/** `VPa - Thường`, `VPa - CNKD`: loại tài khoản ghép vào tên ngân hàng, không tách cột. */
const bankLabel = (c: ReferralCode) => `${c.bankCode} - ${ACCOUNT_TYPE_LABEL[c.accountType]}`;

const COLUMNS: RankColumn<ReferralCode>[] = [
  { key: "bank", label: "Ngân hàng", sortText: bankLabel, render: bankLabel },
  {
    key: "progress",
    label: "Đã dùng",
    sortBy: (c) => c.used / c.total,
    render: (c) => (
      <span className="tabular-nums">
        {formatCount(c.used)}/{formatCount(c.total)}
      </span>
    ),
  },
  {
    key: "code",
    label: "Tên hiển thị",
    sortText: (c) => c.displayName,
    render: (c) => c.displayName,
  },
];

/**
 * Nút MGT trên header màn Ngân hàng (chốt 2026-10-15): Trưởng phòng, Phó phòng
 * và Ban giám đốc xem mã giới thiệu còn chỗ trong phạm vi mình, không phải vào
 * kho mã P-61. Chỉ liệt kê mã còn dùng được; mã đã đầy hay đã ngừng không hiện.
 * Mã text không hiện: tên hiển thị đủ để biết mã nào, và mã ẩn thì không được lộ.
 */
export function AvailableReferralCodesDialog() {
  const [open, setOpen] = useState(false);
  const [bankId, setBankId] = useState("");

  const { data: allCodes = [], isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["referral-codes", "available"],
    queryFn: fetchAvailableReferralCodes,
    enabled: open,
  });

  /**
   * Lọc ở trình duyệt, ngoại lệ của AGENTS.md §5.1: danh sách đã tải trọn (vài
   * chục mã, không phân trang), và ô chọn chỉ bày ngân hàng CÓ mã còn chỗ —
   * lấy từ chính danh sách này, không gọi thêm danh mục ngân hàng.
   */
  const bankOptions = [...new Map(allCodes.map((c) => [c.bankId, c.bankCode])).entries()].map(
    ([value, label]) => ({ value, label }),
  );
  const codes = bankId ? allCodes.filter((c) => c.bankId === bankId) : allCodes;

  const used = codes.reduce((sum, c) => sum + c.used, 0);
  const total = codes.reduce((sum, c) => sum + c.total, 0);

  return (
    <>
      <Button
        variant="secondary"
        aria-label="MGT - mã giới thiệu còn chỗ"
        tooltip="Mã giới thiệu còn chỗ"
        onClick={() => setOpen(true)}
      >
        MGT
      </Button>
      <Dialog open={open} full title="Mã giới thiệu còn chỗ" onClose={() => setOpen(false)}>
        {isError ? (
          <ErrorState what="mã giới thiệu còn chỗ" onRetry={refetch} retrying={isFetching} />
        ) : isPending ? (
          <SkeletonTable rows={6} columns={COLUMNS.length} label="Đang tải mã giới thiệu" />
        ) : (
          <>
            <div className={styles.filters}>
              <Select
                label="Ngân hàng"
                value={bankId}
                onChange={setBankId}
                options={[{ value: "", label: "Tất cả ngân hàng" }, ...bankOptions]}
              />
            </div>
            <RankTable
              rows={codes}
              columns={COLUMNS}
              rowKey={(c) => c.id}
              // Giữ thứ tự máy chủ: ngân hàng theo ưu tiên như ô chọn mã, trong
              // ngân hàng thì mã nhiều chỗ lên trước.
              defaultSort="server"
              caption="Mã giới thiệu còn chỗ theo ngân hàng, kèm số đã dùng trên tổng"
              emptyText="Chưa có mã nào còn chỗ."
              summaryRow={
                codes.length > 0
                  ? [
                      "Tổng",
                      `${formatCount(used)}/${formatCount(total)}`,
                      `${formatCount(codes.length)} mã`,
                    ]
                  : undefined
              }
            />
          </>
        )}
      </Dialog>
    </>
  );
}
