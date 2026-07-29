"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { monthLabel, thisMonth } from "@/components/ui/MonthPicker";
import { PeoplePeriodPicker } from "@/components/ui/PeoplePeriodPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { ScopeSwitcher } from "@/components/ui/ScopeSwitcher";
import { Select } from "@/components/ui/Select";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  fetchPeople,
  isOnTarget,
  periodMonth,
  periodParam,
  pointsGap,
  showsKpi,
  totalPoints,
  type PeriodMode,
  type PersonScore,
} from "@/lib/api/people";
import { fetchDepartments } from "@/lib/api/departments";
import { SearchField } from "@/components/ui/SearchField";
import { exportExcel } from "@/lib/excel";
import { useDebouncedValue } from "@/lib/hooks";
import { availableScopes } from "@/lib/permissions";
import type { Scope } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.css";

const BASE_COLUMNS: RankColumn<PersonScore>[] = [
  { key: "fullName", label: "Nhân viên", render: (p) => p.fullName },
  { key: "departmentName", label: "Đơn vị", render: (p) => p.departmentName },
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
];

/** Chỉ hiện khi xem theo tháng — điểm một ngày không so được với chỉ tiêu tháng. */
const KPI_COLUMNS: RankColumn<PersonScore>[] = [
  {
    key: "points",
    label: "Điểm tháng",
    align: "right",
    sortBy: totalPoints,
    render: (p) => totalPoints(p),
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
  const [period, setPeriod] = useState<PeriodMode>({ kind: "this-month" });
  const [departmentId, setDepartmentId] = useState("");
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    staleTime: Infinity,
  });

  const current = thisMonth();
  const summaryMonth = periodMonth(period, current);
  const param = periodParam(period, current);

  const { data, isPending, isError } = useQuery({
    queryKey: ["people", scope, param, summaryMonth, departmentId, searchQuery],
    queryFn: () =>
      fetchPeople({
        scope,
        period: param,
        summaryMonth,
        departmentId,
        search: searchQuery,
      }),
    // Giữ bảng cũ trong lúc gõ tiếp — không thì mỗi lần đổi từ khoá bảng lại
    // biến mất rồi hiện lại, nhìn giật.
    placeholderData: (previous) => previous,
  });

  const people = data?.people ?? [];
  const withKpi = showsKpi(period);
  const columns = withKpi
    ? [...BASE_COLUMNS.slice(0, 2), ...KPI_COLUMNS.slice(0, 1), ...BASE_COLUMNS.slice(2), KPI_COLUMNS[1]]
    : BASE_COLUMNS;
  const periodText = period.kind === "today" ? "Hôm nay" : monthLabel(summaryMonth);

  const download = () =>
    exportExcel({
      fileName: `nhan-vien-diem-${param}.xlsx`,
      sheetName: periodText,
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
        <SearchField
          label="Tìm nhân viên"
          placeholder="Tìm tên nhân viên, đơn vị…"
          value={search}
          onChange={setSearch}
        />
        <ScopeSwitcher options={scopes} value={scope} onChange={setScope} />
        <Select
          label="Đơn vị"
          hideLabel
          value={departmentId}
          onChange={setDepartmentId}
          options={[
            { value: "", label: "Tất cả đơn vị" },
            ...departments.map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
        <PeoplePeriodPicker value={period} onChange={setPeriod} />
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
              <StatCard value={data.summary.headcount} label="nhân viên" />
              <StatCard value={data.summary.onTarget} label="đã đạt chỉ tiêu" />
              <StatCard
                value={data.summary.offTarget}
                label="chưa đạt"
                tone={data.summary.offTarget > 0 ? "attention" : "normal"}
                detail={data.daysLeft > 0 ? `còn ${data.daysLeft} ngày` : undefined}
              />
              <StatCard value={data.summary.averagePoints} label="điểm trung bình" />
            </div>

            <SectionCard
              title="Nhân viên"
              meta={
                searchQuery
                  ? `${periodText} · khớp ${people.length}/${data.summary.headcount}`
                  : periodText
              }
              variant="plain"
            >
              {people.length === 0 && (
                <p className="text-muted">
                  {searchQuery
                    ? `Không tìm thấy nhân viên nào khớp “${searchQuery}”.`
                    : "Không có nhân viên nào trong đơn vị đang lọc."}
                </p>
              )}
              <RankTable
                key={withKpi ? "kpi" : "daily"}
                rows={people}
                columns={columns}
                rowKey={(p) => p.id}
                defaultSort={withKpi ? "points" : "accounts"}
                pageSize={10}
                caption={`Nhân viên và số liệu ${periodText}`}
              />
              {searchQuery && (
                <p className={styles.footnote}>
                  Bốn số tóm tắt phía trên không đổi theo ô tìm kiếm — chúng là
                  của cả {departmentId ? "đơn vị đang lọc" : "phạm vi đang xem"},
                  còn ô tìm kiếm chỉ lọc bảng.
                </p>
              )}
              <p className={styles.footnote}>
                {withKpi ? (
                  <>
                    Điểm gồm <strong>ngân hàng</strong> (hệ số app đã cài) cộng{" "}
                    <strong>dịch vụ</strong> (hệ số theo loại). Chỉ tiêu hiện tại là{" "}
                    <span className="so">100</span> điểm mỗi tháng.
                  </>
                ) : (
                  <>
                    Xem theo ngày nên không có cột điểm và trạng thái — chỉ tiêu tính
                    theo tháng, điểm của một ngày không so với chỉ tiêu nào được. Bốn
                    số tóm tắt phía trên vẫn là của {monthLabel(summaryMonth)}.
                  </>
                )}
              </p>
            </SectionCard>
          </>
        )}
      </main>
    </>
  );
}
