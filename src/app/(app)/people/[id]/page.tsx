"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { KpiHighlight } from "@/components/ui/KpiHighlight";
import { monthLabel, thisMonth } from "@/components/ui/MonthPicker";
import { PeoplePeriodPicker } from "@/components/ui/PeoplePeriodPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { periodMonth, periodParam, showsKpi, type PeriodMode } from "@/lib/api/people";
import {
  fetchPerson,
  type PersonAccount,
  type PersonService,
} from "@/lib/api/person";
import { formatDate, formatPhone } from "@/lib/format";
import styles from "./page.module.css";

/** Sắp theo ngày cần một con số — lấy chính chuỗi YYYY-MM-DD bỏ dấu gạch. */
const dateOrder = (row: { date: string }) => Number(row.date.replace(/-/g, ""));

const ACCOUNT_COLUMNS: RankColumn<PersonAccount>[] = [
  {
    key: "date",
    label: "Ngày",
    sortBy: dateOrder,
    render: (a) => formatDate(a.date),
  },
  { key: "customerName", label: "Khách hàng", render: (a) => a.customerName },
  { key: "bankName", label: "Ngân hàng", render: (a) => a.bankName },
  { key: "referralCode", label: "Mã giới thiệu", render: (a) => a.referralCode },
  { key: "channel", label: "Kênh", render: (a) => a.channel },
  {
    key: "appInstalled",
    label: "App",
    render: (a) => (
      <StatusTag ok={a.appInstalled}>
        {a.appInstalled ? "Đã cài" : "Chưa cài"}
      </StatusTag>
    ),
  },
];

const SERVICE_COLUMNS: RankColumn<PersonService>[] = [
  {
    key: "date",
    label: "Ngày",
    sortBy: dateOrder,
    render: (s) => formatDate(s.date),
  },
  { key: "customerName", label: "Khách hàng", render: (s) => s.customerName },
  { key: "serviceType", label: "Loại dịch vụ", render: (s) => s.serviceType },
  { key: "ward", label: "Xã", render: (s) => s.ward || "—" },
  {
    key: "points",
    label: "Điểm",
    align: "right",
    sortBy: (s) => s.points,
    render: (s) => s.points,
  },
];

/** Chữ cái đầu của họ và tên — ảnh đại diện tạm khi chưa có ảnh thật. */
const initialsOf = (fullName: string): string => {
  const parts = fullName.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
};

/** P-52 · Xem theo một nhân viên. */
export default function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [period, setPeriod] = useState<PeriodMode>({ kind: "this-month" });

  const current = thisMonth();
  const summaryMonth = periodMonth(period, current);
  const param = periodParam(period, current);

  const { data, isPending, isError } = useQuery({
    queryKey: ["person", id, param, summaryMonth],
    queryFn: () => fetchPerson({ id, period: param, summaryMonth }),
  });

  const withKpi = showsKpi(period);
  const periodText = period.kind === "today" ? "Hôm nay" : monthLabel(summaryMonth);

  return (
    <>
      <TopBar title={data?.fullName ?? "Nhân viên"}>
        <PeoplePeriodPicker value={period} onChange={setPeriod} />
      </TopBar>

      <main className={styles.body}>
        <Link href="/people" className={styles.back}>
          ‹ Nhân sự &amp; KPI
        </Link>

        {isPending && <p className="text-muted">Đang tải hồ sơ…</p>}
        {isError && <p className="text-muted">Không tải được hồ sơ nhân viên này.</p>}

        {data && (
          <>
            <div className={styles.identity}>
              <span className={styles.avatar} aria-hidden>
                {initialsOf(data.fullName)}
              </span>
              <div>
                <strong className={styles.name}>{data.fullName}</strong>
                <span className={styles.sub}>
                  {data.departmentName} · vào từ {monthLabel(data.joinedMonth)}
                </span>
                <span className={styles.sub}>
                  {data.username} · <span className="so">{formatPhone(data.phone)}</span>
                </span>
              </div>
            </div>

            {withKpi && (
              <div className={styles.headline}>
                <KpiHighlight
                  ariaLabel={`Điểm ${monthLabel(data.summaryMonth)} trên chỉ tiêu`}
                  percent={Math.round((data.points.total / data.points.target) * 100)}
                  value={
                    <>
                      {data.points.total}
                      <span className={styles.target}> / {data.points.target}</span>
                    </>
                  }
                  description={<>điểm {monthLabel(data.summaryMonth)}</>}
                  detail={
                    data.points.total >= data.points.target
                      ? `Đã vượt chỉ tiêu ${data.points.total - data.points.target} điểm.`
                      : `Còn ${data.points.target - data.points.total} điểm nữa mới đạt chỉ tiêu.` +
                        (data.daysLeft > 0 ? ` Còn ${data.daysLeft} ngày.` : "")
                  }
                />

                <SectionCard title="Điểm đến từ đâu" meta={monthLabel(data.summaryMonth)}>
                  <dl className={styles.pairs}>
                    {data.pointSources.map((s) => (
                      <div key={s.label}>
                        <dt>
                          {s.label}
                          <span className={styles.pairDetail}>{s.detail}</span>
                        </dt>
                        <dd className="so">{s.points}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className={styles.footnote}>
                    Tài khoản khách <strong>chưa cài app</strong> không sinh điểm —
                    đó là lý do bảng bên dưới có dòng mà điểm vẫn chưa lên.
                  </p>
                </SectionCard>
              </div>
            )}

            <div className={styles.stats}>
              <StatCard value={data.accounts.length} label={`tài khoản mở ${periodText.toLowerCase()}`} />
              <StatCard value={data.services.length} label={`dịch vụ đã làm ${periodText.toLowerCase()}`} />
              <StatCard
                value={data.accounts.filter((a) => a.appInstalled).length}
                label="tài khoản đã cài app"
              />
            </div>

            {data.accounts.length > 0 && (
              <SectionCard title="Khách hàng đã tiếp" meta={periodText} variant="plain">
                <RankTable
                  rows={data.accounts}
                  columns={ACCOUNT_COLUMNS}
                  rowKey={(a) => a.id}
                  defaultSort="date"
                  pageSize={10}
                  caption={`Tài khoản đã mở cho khách ${periodText}`}
                />
              </SectionCard>
            )}

            {data.services.length > 0 && (
              <SectionCard title="Dịch vụ đã làm" meta={periodText} variant="plain">
                <RankTable
                  rows={data.services}
                  columns={SERVICE_COLUMNS}
                  rowKey={(s) => s.id}
                  defaultSort="date"
                  pageSize={10}
                  caption={`Dịch vụ đã làm cho khách ${periodText}`}
                />
              </SectionCard>
            )}

            {data.accounts.length === 0 && data.services.length === 0 && (
              <p className="text-muted">
                {periodText} chưa có hoạt động nào của {data.fullName}.
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
