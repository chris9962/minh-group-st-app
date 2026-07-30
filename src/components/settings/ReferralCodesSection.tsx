"use client";

import { useQuery } from "@tanstack/react-query";
import { Ticket } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
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
import styles from "./ReferralCodesSection.module.scss";

/** P-61 · Kho mã giới thiệu — chỉ xem; tạo/nhập hàng loạt thuộc P-62 (chưa làm). */
export function ReferralCodesSection() {
  const [bankId, setBankId] = useState("");
  const [status, setStatus] = useState<CodeStatus | "">("");

  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const bankName = (id: string) => banks.find((b) => b.id === id)?.code ?? id;

  const { data: codes = [], isPending, isError } = useQuery({
    queryKey: ["referral-codes", bankId, status],
    queryFn: () => fetchReferralCodes({ bankId, status }),
  });

  // Cảnh báo nổi bật ở đầu trang, không phụ thuộc bộ lọc đang chọn — thiếu mã
  // ở phòng nào cũng phải thấy ngay, không phải bỏ lọc ra mới biết.
  const { data: allCodes = [] } = useQuery({
    queryKey: ["referral-codes", "", ""],
    queryFn: () => fetchReferralCodes({ bankId: "", status: "" }),
  });
  const runningLow = allCodes.filter((c) => codeStatusOf(c) !== "available");

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
      align: "right",
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
      {runningLow.length > 0 && (
        <Alert tone="warning" className={styles.warning}>
          <strong>Sắp hết hoặc đã hết mã:</strong>{" "}
          {runningLow
            .map((c) => `${bankName(c.bankId)} · ${c.code} (${c.used}/${c.total})`)
            .join(", ")}
        </Alert>
      )}

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

      {isPending && <p className="text-muted">Đang tải kho mã…</p>}
      {isError && <p className="text-muted">Không tải được kho mã giới thiệu.</p>}

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

      <p className={styles.footnote}>
        Tạo mã mới hoặc nhập hàng loạt từ Excel làm ở màn <strong>Nhập mã hàng
        loạt</strong> (P-62) — màn này chỉ để xem và lọc kho hiện có.
      </p>
    </SectionCard>
  );
}
