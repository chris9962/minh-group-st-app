"use client";

import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { fetchPersonAccountsByBank, type PersonBankCount } from "@/lib/api/person";

const COLUMNS: RankColumn<PersonBankCount>[] = [
  { key: "bankName", label: "Ngân hàng", sortText: (b) => b.bankName, render: (b) => b.bankName },
  {
    key: "total",
    label: "Tổng",
    hint: "Tổng = Thường + CNKD + HKD",
    sortBy: (b) => b.total,
    render: (b) => b.total,
  },
  { key: "cnkd", label: "CNKD", sortBy: (b) => b.cnkd, render: (b) => b.cnkd },
  { key: "hkd", label: "HKD", sortBy: (b) => b.hkd, render: (b) => b.hkd },
];

type Props = {
  staffId: string;
  from: string;
  to: string;
  periodText: string;
};

export function PersonBankSummary({ staffId, from, to, periodText }: Props) {
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["person-accounts-by-bank", staffId, from, to],
    queryFn: () => fetchPersonAccountsByBank({ id: staffId, from, to }),
  });

  if (isError)
    return (
      <ErrorState what="số tài khoản theo ngân hàng" onRetry={refetch} retrying={isFetching} />
    );
  if (isPending) return <SkeletonCard lines={3} />;

  const sum = (pick: (b: PersonBankCount) => number) => data.reduce((n, b) => n + pick(b), 0);

  return (
    <RankTable
      rows={data}
      columns={COLUMNS}
      rowKey={(b) => b.bankName}
      defaultSort="total"
      caption={`Tài khoản theo ngân hàng ${periodText}`}
      summaryRow={["Tổng", sum((b) => b.total), sum((b) => b.cnkd), sum((b) => b.hkd)]}
    />
  );
}
