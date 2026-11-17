"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { fetchVpaDeductedAccounts, type VpaDeductedAccount } from "@/lib/api/vpaTargets";
import { formatCount, formatPoints, roundPoints } from "@/lib/format";
import styles from "./VpaDeductionDialog.module.scss";

const banksText = (banks: string[] | null) => (banks && banks.length > 0 ? banks.join(" + ") : "-");
const pointsText = (points: number | null) => (points === null ? "-" : formatPoints(points));
// VPa nằm ngoài tổ hợp thắng thì khách không mất điểm; Intl in số âm 0 thành "-0".
const deductedText = (points: number) => formatPoints(points === 0 ? 0 : -points);

const COLUMNS: RankColumn<VpaDeductedAccount>[] = [
  {
    key: "customer",
    label: "Khách hàng",
    render: (r) => (
      <Link href={`/customers/${r.customerId}`} className={styles.nameLink}>
        {r.customerName}
      </Link>
    ),
  },
  { key: "account", label: "STK VPa", render: (r) => r.accountNumber || "-" },
  { key: "banksBefore", label: "Ngân hàng trước", render: (r) => banksText(r.banksBefore) },
  { key: "pointsBefore", label: "Điểm trước", render: (r) => <span className="tabular-nums">{pointsText(r.pointsBefore)}</span> },
  { key: "banksAfter", label: "Ngân hàng sau", render: (r) => banksText(r.banksAfter) },
  { key: "pointsAfter", label: "Điểm sau", render: (r) => <span className="tabular-nums">{pointsText(r.pointsAfter)}</span> },
  { key: "points", label: "Điểm trừ", render: (r) => <span className="tabular-nums">{deductedText(r.points)}</span> },
];

type Props = { personId: string; adjustmentIds: string[]; onClose: () => void };

/**
 * P-52 và màn Tổng quan · Từng khách trong các dòng điểm trừ của file chốt chỉ
 * tiêu VPa. Màn Tổng quan gộp mọi dòng của tháng vì mỗi lần nhập file là một dòng.
 */
export function VpaDeductionDialog({ personId, adjustmentIds, onClose }: Props) {
  const { data: rows = [], isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["vpa-deducted-accounts", personId, ...adjustmentIds],
    queryFn: async () =>
      (await Promise.all(adjustmentIds.map((id) => fetchVpaDeductedAccounts(personId, id)))).flat(),
  });

  const total = roundPoints(rows.reduce((sum, r) => sum + r.points, 0));

  return (
    <Dialog open full title="Tài khoản VPa không đạt chỉ tiêu" onClose={onClose}>
      {isError ? (
        <ErrorState what="danh sách tài khoản bị trừ điểm" onRetry={refetch} retrying={isFetching} />
      ) : isPending ? (
        <SkeletonTable rows={4} columns={COLUMNS.length} label="Đang tải danh sách tài khoản" />
      ) : (
        <RankTable
          rows={rows}
          columns={COLUMNS}
          rowKey={(r) => r.bankAccountId}
          defaultSort="server"
          caption="Khách có tài khoản VPa không đạt chỉ tiêu, kèm ngân hàng và điểm combo trước, sau khi trừ"
          emptyText="Không có tài khoản nào."
          summaryRow={
            rows.length > 0
              ? ["Tổng", `${formatCount(rows.length)} tài khoản`, "", "", "", "", deductedText(total)]
              : undefined
          }
        />
      )}
    </Dialog>
  );
}
