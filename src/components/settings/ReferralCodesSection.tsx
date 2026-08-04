"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Ticket } from "lucide-react";
import { useState } from "react";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/Button";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  CODE_STATUS_LABEL,
  codeStatusOf,
  fetchBanks,
  fetchReferralCodes,
  type CodeStatus,
  type ReferralCode,
} from "@/lib/api/bankCatalog";
import { ReferralCodeFormDialog } from "./ReferralCodeFormDialog";
import styles from "./ReferralCodesSection.module.scss";

/** P-61 · Kho mã giới thiệu — thêm mã lẻ ở đây; nhập hàng loạt từ Excel vẫn là P-62 (chưa làm). */
export function ReferralCodesSection() {
  const [bankId, setBankId] = useState("");
  const [status, setStatus] = useState<CodeStatus | "">("");
  const [creating, setCreating] = useState(false);

  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const bankName = (id: string) => banks.find((b) => b.id === id)?.code ?? id;

  const { data: codes = [], isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["referral-codes", bankId, status],
    queryFn: () => fetchReferralCodes({ bankId, status }),
  });

  const columns: RankColumn<ReferralCode>[] = [
    { key: "bank", label: "Ngân hàng", render: (c) => bankName(c.bankId) },
    { key: "code", label: "Mã", render: (c) => c.code },
    {
      key: "progress",
      label: "Đã dùng",
      sortBy: (c) => c.used / c.total,
      ratio: (c) => (c.used / c.total) * 100,
      render: (c) => (
        <span className="tabular-nums">
          {c.used}/{c.total}
        </span>
      ),
    },
    {
      key: "holding",
      label: "Đang giữ",
      sortBy: (c) => c.holding,
      render: (c) => c.holding,
    },
    {
      key: "status",
      label: "Trạng thái",
      render: (c) => {
        const s = codeStatusOf(c);
        return <StatusTag ok={s === "available"}>{CODE_STATUS_LABEL[s]}</StatusTag>;
      },
    },
  ];

  return (
    <SectionCard
      title="Kho mã giới thiệu"
      icon={<Ticket size={17} />}
      meta={`${codes.length} mã`}
    >
      <div className={styles.filters}>
        <Select
          label="Ngân hàng"
          value={bankId}
          onChange={setBankId}
          options={[
            { value: "", label: "Tất cả ngân hàng" },
            ...banks.map((b) => ({ value: b.id, label: b.code })),
          ]}
        />
        <Select
          label="Trạng thái"
          value={status}
          onChange={(v) => setStatus(v as CodeStatus | "")}
          options={[
            { value: "", label: "Tất cả trạng thái" },
            ...Object.entries(CODE_STATUS_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
      </div>

      {isPending && <SkeletonTable rows={5} columns={5} />}
      {isError && (
          <ErrorState what="kho mã giới thiệu" onRetry={refetch} retrying={isFetching} />
        )}

      {!isPending && !isError && (
        <>
          {codes.length === 0 ? (
            <p className="text-muted">Không có mã nào khớp bộ lọc.</p>
          ) : (
            <RankTable
              rows={codes}
              columns={columns}
              rowKey={(c) => c.id}
              defaultSort="progress"
              pageSize={15}
              caption="Mã giới thiệu theo ngân hàng, tiến độ sử dụng và trạng thái"
            />
          )}
        </>
      )}

      <div className={styles.footRow}>
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} />
          Thêm mã
        </Button>
      </div>

      <p className={styles.footnote}>
        Thêm từng mã một ở đây. Nhập <strong>hàng loạt</strong> từ Excel vẫn là
        việc riêng của màn <strong>Nhập mã hàng loạt</strong> (P-62, chưa làm).
      </p>

      {creating && (
        <ReferralCodeFormDialog open onClose={() => setCreating(false)} />
      )}
    </SectionCard>
  );
}
