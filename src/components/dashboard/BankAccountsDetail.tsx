"use client";

import { Maximize2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import type { BankingSummary } from "@/lib/api/dashboard";
import { formatCount } from "@/lib/format";

type Row = BankingSummary["accountsByBank"][number];

const COLUMNS: RankColumn<Row>[] = [
  { key: "code", label: "Ngân hàng", sortText: (r) => r.code, render: (r) => r.code },
  {
    key: "accountsOpened",
    label: "Tài khoản mở",
    sortBy: (r) => r.accountsOpened,
    render: (r) => formatCount(r.accountsOpened),
  },
  {
    key: "appsInstalled",
    label: "App đã cài",
    sortBy: (r) => r.appsInstalled,
    render: (r) => formatCount(r.appsInstalled),
  },
  {
    key: "percent",
    label: "Tỉ lệ cài app",
    sortBy: (r) => r.percent,
    render: (r) => `${r.percent}%`,
  },
];

export function BankAccountsDetail({
  summary,
  periodLabel,
}: {
  summary: BankingSummary;
  periodLabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        icon
        aria-label="Xem tài khoản mở theo ngân hàng"
        onClick={() => setOpen(true)}
      >
        <Maximize2 size={16} />
      </Button>
      <Dialog
        open={open}
        full
        title={`Tài khoản mở theo ngân hàng ${periodLabel}`}
        onClose={() => setOpen(false)}
      >
        <RankTable
          rows={summary.accountsByBank}
          columns={COLUMNS}
          rowKey={(r) => r.code}
          defaultSort="accountsOpened"
          caption="Số tài khoản mở, app đã cài và tỉ lệ cài app của từng ngân hàng"
          emptyText="Chưa có tài khoản mở"
          summaryRow={[
            "Tổng",
            formatCount(summary.accountsOpened),
            formatCount(summary.appsInstalled),
            `${summary.installPercent}%`,
          ]}
        />
      </Dialog>
    </>
  );
}
