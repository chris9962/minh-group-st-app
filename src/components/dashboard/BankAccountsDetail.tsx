"use client";

import { Maximize2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { ACCOUNT_TYPE_LABEL } from "@/lib/api/bankAccounts";
import type { BankingSummary } from "@/lib/api/dashboard";
import { formatCount } from "@/lib/format";
import styles from "./BankAccountsDetail.module.css";

type Row = BankingSummary["accountsByBank"][number];

const COUNT_COLUMNS = [
  ["error", "Lỗi"],
  ["fixed", "Chờ duyệt"],
  ["done", "Hoàn thành"],
] as const;

const COLUMNS: RankColumn<Row>[] = [
  { key: "code", label: "Ngân hàng", sortText: (r) => r.code, render: (r) => r.code },
  {
    key: "accountType",
    label: "Loại TK",
    sortText: (r) => ACCOUNT_TYPE_LABEL[r.accountType],
    render: (r) => ACCOUNT_TYPE_LABEL[r.accountType],
  },
  ...COUNT_COLUMNS.map(
    ([key, label]): RankColumn<Row> => ({
      key,
      label,
      sortBy: (r) => r[key],
      render: (r) => <span className={styles[key]}>{formatCount(r[key])}</span>,
    }),
  ),
];

export function BankAccountsDetail({
  summary,
  periodLabel,
}: {
  summary: BankingSummary;
  periodLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rows = summary.accountsByBank;

  return (
    <>
      <Button
        variant="ghost"
        icon
        aria-label="Xem tài khoản theo ngân hàng"
        onClick={() => setOpen(true)}
      >
        <Maximize2 size={16} />
      </Button>
      <Dialog
        open={open}
        full
        title={`Tài khoản theo ngân hàng ${periodLabel}`}
        onClose={() => setOpen(false)}
      >
        <RankTable
          rows={rows}
          columns={COLUMNS}
          rowKey={(r) => `${r.code}-${r.accountType}`}
          // Không trùng cột nào: giữ thứ tự máy chủ, các loại của một ngân hàng đứng liền nhau.
          defaultSort="server"
          caption="Số tài khoản lỗi, chờ duyệt và hoàn thành theo ngân hàng và loại tài khoản"
          emptyText="Chưa có tài khoản"
          summaryRow={[
            "Tổng",
            "",
            ...COUNT_COLUMNS.map(([k]) => formatCount(rows.reduce((sum, r) => sum + r[k], 0))),
          ]}
        />
      </Dialog>
    </>
  );
}
