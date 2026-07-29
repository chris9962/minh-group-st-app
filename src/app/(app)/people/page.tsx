"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { MonthPicker, monthLabel, thisMonth, type Month } from "@/components/ui/MonthPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { ScopeSwitcher } from "@/components/ui/ScopeSwitcher";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  fetchPeople,
  isOnTarget,
  pointsGap,
  totalPoints,
  type PersonScore,
} from "@/lib/api/people";
import { exportExcel } from "@/lib/excel";
import { availableScopes } from "@/lib/permissions";
import type { Scope } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.css";

const COLUMNS: RankColumn<PersonScore>[] = [
  { key: "fullName", label: "Nhân viên", render: (p) => p.fullName },
  { key: "departmentName", label: "Đơn vị", render: (p) => p.departmentName },
  {
    key: "points",
    label: "Điểm tháng",
    align: "right",
    sortBy: totalPoints,
    render: (p) => totalPoints(p),
  },
  {
    key: "accounts",
    label: "Tài khoản",
    align: "right",
    sortBy: (p) => p.accounts,
    render: (p) => p.accounts,
  },
  {
    key: "apps",
    label: "App",
    align: "right",
    sortBy: (p) => p.apps,
    render: (p) => p.apps,
  },
  {
    key: "insuranceOrders",
    label: "Đơn BH",
    align: "right",
    sortBy: (p) => p.insuranceOrders,
    render: (p) => p.insuranceOrders,
  },
  {
    key: "status",
    label: "Trạng thái",
    sortBy: pointsGap,
    render: (p) => {
      const gap = pointsGap(p);
      return (
        <StatusTag ok={isOnTarget(p)}>
          {isOnTarget(p) ? `Đã đạt · vượt ${gap}` : `Chưa đạt · còn ${-gap}`}
        </StatusTag>
      );
    },
  },
];

/** P-51 · Danh sách nhân viên + điểm. */
export default function PeoplePage() {
  const user = useSession((s) => s.user);
  const scopes = availableScopes(user, "banking", "view-stats");
  const [scope, setScope] = useState<Scope>(scopes.at(-1) ?? "own");
  const [month, setMonth] = useState<Month>(thisMonth());

  const { data, isPending, isError } = useQuery({
    queryKey: ["people", scope, month],
    queryFn: () => fetchPeople(scope, month),
  });

  const people = data?.people ?? [];
  const onTarget = people.filter(isOnTarget).length;
  const average = people.length
    ? Math.round(people.reduce((sum, p) => sum + totalPoints(p), 0) / people.length)
    : 0;

  const download = () =>
    exportExcel({
      fileName: `nhan-vien-diem-${month}.xlsx`,
      sheetName: monthLabel(month),
      rows: people,
      columns: [
        { header: "Nhân viên", width: 26, transform: "name", value: (p) => p.fullName },
        { header: "Đơn vị", width: 24, value: (p) => p.departmentName },
        { header: "Điểm ngân hàng", value: (p) => p.bankingPoints },
        { header: "Điểm dịch vụ", value: (p) => p.servicePoints },
        { header: "Tổng điểm", value: totalPoints },
        { header: "Chỉ tiêu", value: (p) => p.target },
        { header: "Tài khoản", value: (p) => p.accounts },
        { header: "App đã cài", value: (p) => p.apps },
        { header: "Đơn bảo hiểm", value: (p) => p.insuranceOrders },
        {
          header: "Trạng thái",
          width: 14,
          value: (p) => (isOnTarget(p) ? "Đã đạt" : "Chưa đạt"),
        },
      ],
    });

  return (
    <>
      <TopBar title="Nhân sự & KPI">
        <ScopeSwitcher options={scopes} value={scope} onChange={setScope} />
        <MonthPicker value={month} onChange={setMonth} />
        <Button
          variant="secondary"
          onClick={download}
          disabled={people.length === 0}
        >
          Xuất Excel
        </Button>
      </TopBar>

      <main className={styles.body}>
        {isPending && <p className="text-muted">Đang tải danh sách…</p>}
        {isError && <p className="text-muted">Không tải được danh sách nhân viên.</p>}

        {data && (
          <>
            <div className={styles.stats}>
              <StatCard value={people.length} label="nhân viên" />
              <StatCard value={onTarget} label="đã đạt chỉ tiêu" />
              <StatCard
                value={people.length - onTarget}
                label="chưa đạt"
                tone={people.length - onTarget > 0 ? "attention" : "normal"}
                detail={data.daysLeft > 0 ? `còn ${data.daysLeft} ngày` : undefined}
              />
              <StatCard value={average} label="điểm trung bình" />
            </div>

            <SectionCard title="Nhân viên" meta={monthLabel(month)}>
              <RankTable
                rows={people}
                columns={COLUMNS}
                rowKey={(p) => p.id}
                defaultSort="points"
                caption={`Nhân viên và điểm KPI ${monthLabel(month)}`}
              />
              <p className={styles.footnote}>
                Điểm gồm <strong>ngân hàng</strong> (hệ số app đã cài) cộng{" "}
                <strong>dịch vụ</strong> (hệ số theo loại). Chỉ tiêu hiện tại là{" "}
                <span className="so">100</span> điểm mỗi tháng.
              </p>
            </SectionCard>
          </>
        )}
      </main>
    </>
  );
}
