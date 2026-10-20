"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { Select } from "@/components/ui/Select";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import { ACCOUNT_TYPE_LABEL } from "@/lib/api/bankAccounts";
import {
  CODE_STATUS_LABEL,
  fetchAvailableReferralCodes,
  isAllocatable,
  isSingleDepartment,
  type ReferralCode,
} from "@/lib/api/bankCatalog";
import { formatCount } from "@/lib/format";
import { canAllocateReferralCodes } from "@/lib/permissions";
import { usePrefs } from "@/store/prefs";
import { useSession } from "@/store/session";
import { ReferralCodeAllocationDialog } from "./ReferralCodeAllocationDialog";
import styles from "./AvailableReferralCodesDialog.module.scss";

// "Đã dùng" đứng ngay sau ngân hàng: trên điện thoại chỉ hai cột đầu lọt màn,
// và đó là hai thứ Trưởng phòng mở modal này để xem.
/** `VPa - Thường`, `VPa - CNKD`: loại tài khoản ghép vào tên ngân hàng, không tách cột. */
const bankLabel = (c: ReferralCode) => `${c.bankCode} - ${ACCOUNT_TYPE_LABEL[c.accountType]}`;

/**
 * Cột "Chia cho nhân viên" là NÚT với mã kho mã đã bật chia cho từng nhân viên và người
 * xem quản phòng đó (chốt 2026-10-19): bấm mở form chia. Mã dùng chung, gán
 * nhiều phòng, hay gán một phòng mà chưa bật chia thì chỉ ghi lý do. Người chỉ
 * xem (không có `banking:update` phạm vi phòng đó) thấy số đã chia dạng chữ,
 * không có nút: bày nút rồi máy chủ trả 403 là bắt họ đoán vì sao.
 */
const columnsFor = (
  canAllocate: (code: ReferralCode) => boolean,
  onAllocate: (code: ReferralCode) => void,
): RankColumn<ReferralCode>[] => [
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
    key: "allocated",
    label: "Chia cho nhân viên",
    sortBy: (c) => c.allocated,
    render: (c) => {
      if (!isAllocatable(c))
        return (
          <span className="text-muted">
            {c.scope === "all" ? "Dùng chung" : isSingleDepartment(c) ? "Cả phòng" : "Nhiều phòng"}
          </span>
        );
      const label =
        c.allocated > 0 ? (
          <>
            Đã chia <span className="tabular-nums">{formatCount(c.allocated)}</span> chỗ
          </>
        ) : (
          "Chưa chia"
        );
      if (!canAllocate(c)) return label;
      // Tên đọc lên bắt đầu bằng đúng chữ nhìn thấy (WCAG 2.5.3), phần mô tả nối sau và ẩn thị giác.
      return (
        <button type="button" className={styles.allocate} onClick={() => onAllocate(c)}>
          {label}
          <span className="sr-only">, chia mã {c.displayName} cho nhân viên</span>
        </button>
      );
    },
  },
  {
    key: "code",
    label: "Tên hiển thị",
    sortText: (c) => c.displayName,
    render: (c) => c.displayName,
  },
  {
    // Cùng nhãn với kho mã: "Đã ngừng" đè lên nhãn tiến độ, mã tắt thì còn chỗ cũng không ai chọn được.
    key: "status",
    label: "Trạng thái",
    render: (c) =>
      c.active ? (
        <StatusTag ok={c.status === "available"}>{CODE_STATUS_LABEL[c.status]}</StatusTag>
      ) : (
        <StatusTag ok={false}>Đã ngừng</StatusTag>
      ),
  },
];

/**
 * Nút MGT trên header màn Ngân hàng (chốt 2026-10-15): Trưởng phòng, Phó phòng
 * và Ban giám đốc xem mã giới thiệu trong phạm vi mình, không phải vào kho mã
 * P-61. Mặc định chỉ liệt kê mã còn dùng được; bỏ tick "Ẩn mã đã đầy và đã
 * ngừng" thì thấy hết (chốt 2026-10-19, nhớ theo máy ở `usePrefs`). Mã text
 * không hiện: tên hiển thị đủ để biết mã nào, và mã ẩn thì không được lộ.
 */
export function AvailableReferralCodesDialog() {
  const [open, setOpen] = useState(false);
  const [bankId, setBankId] = useState("");
  const [allocating, setAllocating] = useState<ReferralCode | null>(null);
  const user = useSession((s) => s.user);
  const hideUnusable = usePrefs((s) => s.hideUnusableReferralCodes);
  const setHideUnusable = usePrefs((s) => s.setHideUnusableReferralCodes);
  const onlyAllocatable = usePrefs((s) => s.onlyAllocatableReferralCodes);
  const setOnlyAllocatable = usePrefs((s) => s.setOnlyAllocatableReferralCodes);
  const columns = columnsFor(
    (c) => canAllocateReferralCodes(user, c.departmentIds[0]),
    setAllocating,
  );

  const { data: allCodes = [], isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["referral-codes", "available", hideUnusable],
    queryFn: () => fetchAvailableReferralCodes(hideUnusable),
    enabled: open,
  });

  /**
   * Lọc ở trình duyệt, ngoại lệ của AGENTS.md §5.1: danh sách đã tải trọn (vài
   * chục mã, không phân trang), và ô chọn chỉ bày ngân hàng CÓ mã còn chỗ —
   * lấy từ chính danh sách này, không gọi thêm danh mục ngân hàng.
   */
  // "Chỉ mã chia được" lọc trước, để ô ngân hàng chỉ bày ngân hàng có mã chia được.
  const base = onlyAllocatable ? allCodes.filter(isAllocatable) : allCodes;
  const bankOptions = [...new Map(base.map((c) => [c.bankId, c.bankCode])).entries()].map(
    ([value, label]) => ({ value, label }),
  );
  const codes = bankId ? base.filter((c) => c.bankId === bankId) : base;

  const used = codes.reduce((sum, c) => sum + c.used, 0);
  const total = codes.reduce((sum, c) => sum + c.total, 0);

  return (
    <>
      <Button
        variant="secondary"
        aria-label="MGT - mã giới thiệu của phòng"
        tooltip="Mã giới thiệu"
        onClick={() => setOpen(true)}
      >
        MGT
      </Button>
      <Dialog open={open} full title="Mã giới thiệu" onClose={() => setOpen(false)}>
        <div className={styles.filters}>
          <Select
            label="Ngân hàng"
            value={bankId}
            onChange={setBankId}
            options={[{ value: "", label: "Tất cả ngân hàng" }, ...bankOptions]}
          />
          <Checkbox
            label="Ẩn mã đã đầy và đã ngừng"
            checked={hideUnusable}
            onCheckedChange={setHideUnusable}
          />
          <Checkbox
            label="Chỉ mã chia được"
            checked={onlyAllocatable}
            onCheckedChange={setOnlyAllocatable}
          />
        </div>
        {isError ? (
          <ErrorState what="mã giới thiệu" onRetry={refetch} retrying={isFetching} />
        ) : isPending ? (
          <SkeletonTable rows={6} columns={columns.length} label="Đang tải mã giới thiệu" />
        ) : (
          <RankTable
            rows={codes}
            columns={columns}
            rowKey={(c) => c.id}
            // Giữ thứ tự máy chủ: ngân hàng theo ưu tiên như ô chọn mã, trong
            // ngân hàng thì mã nhiều chỗ lên trước.
            defaultSort="server"
            caption="Mã giới thiệu theo ngân hàng, kèm số đã dùng trên tổng và trạng thái"
            emptyText={
              onlyAllocatable
                ? "Chưa có mã nào bật chia cho từng nhân viên."
                : hideUnusable
                  ? "Chưa có mã nào còn chỗ."
                  : "Chưa có mã nào."
            }
            summaryRow={
              codes.length > 0
                ? [
                    "Tổng",
                    `${formatCount(used)}/${formatCount(total)}`,
                    "",
                    `${formatCount(codes.length)} mã`,
                    "",
                  ]
                : undefined
            }
          />
        )}
      </Dialog>
      {allocating && (
        <ReferralCodeAllocationDialog code={allocating} onClose={() => setAllocating(null)} />
      )}
    </>
  );
}
