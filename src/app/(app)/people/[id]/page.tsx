"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { ChartColumn } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { AccountCard } from "@/components/staff/AccountCard";
import { BarChart } from "@/components/ui/BarChart";
import { monthLabel, thisMonth } from "@/components/ui/MonthPicker";
import { PeoplePeriodPicker } from "@/components/ui/PeoplePeriodPicker";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedTabs, type TabOption } from "@/components/ui/SegmentedTabs";
import { StatusTag } from "@/components/ui/StatusTag";
import { periodMonth, periodParam, showsKpi, type PeriodMode } from "@/lib/api/people";
import {
  fetchPerson,
  groupAccountsByCustomer,
  INSURANCE_STATUS,
  type CustomerAccounts,
  type PersonInsurance,
  type PersonService,
} from "@/lib/api/person";
import { sourceColor, useChartColors } from "@/lib/chart-colors";
import { formatDate, formatPhone } from "@/lib/format";
import styles from "./page.module.css";

/** Sắp theo ngày cần một con số — lấy chính chuỗi YYYY-MM-DD bỏ dấu gạch. */
const dateOrder = (row: { date: string }) => Number(row.date.replace(/-/g, ""));

const DATE_COLUMN = {
  key: "date",
  label: "Ngày",
  sortBy: dateOrder,
  render: (row: { date: string }) => formatDate(row.date),
};

/** Một hàng một khách, mọi ngân hàng của khách nằm cùng ô. */
const ACCOUNT_COLUMNS: RankColumn<CustomerAccounts>[] = [
  { ...DATE_COLUMN, label: "Gần nhất" },
  { key: "customerName", label: "Khách hàng", render: (c) => c.customerName },
  { key: "banks", label: "Ngân hàng", render: (c) => c.banks.join(", ") },
  {
    key: "appBanks",
    label: "App đã cài",
    render: (c) =>
      c.appBanks.length > 0 ? (
        c.appBanks.join(", ")
      ) : (
        <StatusTag ok={false}>Chưa cài</StatusTag>
      ),
  },
  {
    key: "gift",
    label: "Quà tặng",
    // Ba trạng thái khác hẳn nhau: đã tặng gì · đủ điều kiện mà chưa phát ·
    // không thuộc diện. Gộp hai cái sau thành "—" là giấu mất việc phải làm.
    render: (c) =>
      c.giftItems.length > 0 ? (
        c.giftItems.join(", ")
      ) : c.giftEligible ? (
        <StatusTag ok={false}>Đủ ĐK · chưa phát</StatusTag>
      ) : (
        "—"
      ),
  },
];

const INSURANCE_COLUMNS: RankColumn<PersonInsurance>[] = [
  DATE_COLUMN,
  { key: "customerName", label: "Khách hàng", render: (o) => o.customerName },
  { key: "product", label: "Loại bảo hiểm", render: (o) => o.product },
  { key: "packageName", label: "Gói", render: (o) => o.packageName },
  {
    key: "status",
    label: "Trạng thái",
    render: (o) => (
      <StatusTag ok={o.status === "done"}>{INSURANCE_STATUS[o.status]}</StatusTag>
    ),
  },
];

const SERVICE_COLUMNS: RankColumn<PersonService>[] = [
  DATE_COLUMN,
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

/** Nhãn cột biểu đồ: `2026-07` → `T7`. */
const shortMonth = (month: string) => `T${Number(month.slice(5, 7))}`;

type TabKey = "accounts" | "insurance" | "services";

/** P-52 · Xem theo một nhân viên. */
export default function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const chartColors = useChartColors();
  const [period, setPeriod] = useState<PeriodMode>({ kind: "this-month" });
  const [tab, setTab] = useState<TabKey>("accounts");

  const current = thisMonth();
  const summaryMonth = periodMonth(period, current);
  const param = periodParam(period, current);

  const { data, isPending, isError } = useQuery({
    queryKey: ["person", id, param, summaryMonth],
    queryFn: () => fetchPerson({ id, period: param, summaryMonth }),
  });

  const withKpi = showsKpi(period);
  const periodText = period.kind === "today" ? "Hôm nay" : monthLabel(summaryMonth);
  const customers = data ? groupAccountsByCustomer(data.accounts, data.gifts) : [];

  // Chỉ hiện thẻ có dòng. Thẻ rỗng chỉ để người dùng bấm vào rồi thấy trống.
  const tabs: TabOption[] = data
    ? (
        [
          { value: "accounts", label: "Tài khoản", count: data.accounts.length },
          { value: "insurance", label: "Đơn bảo hiểm", count: data.insurance.length },
          { value: "services", label: "Dịch vụ", count: data.services.length },
        ] as TabOption[]
      ).filter((t) => t.count > 0)
    : [];
  const activeTab = tabs.some((t) => t.value === tab) ? tab : tabs[0]?.value;

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
          <div className={styles.columns}>
            <aside className={styles.side}>
              <div className={styles.person}>
                <div className={styles.identity}>
                  <span className={styles.avatar} aria-hidden>
                    {initialsOf(data.fullName)}
                  </span>
                  <div>
                    <strong className={styles.name}>{data.fullName}</strong>
                    <span className={styles.sub}>
                      {data.username} ·{" "}
                      <span className="so">{formatPhone(data.phone)}</span>
                    </span>
                    <span className={styles.sub}>
                      {data.departmentName} · vào từ {monthLabel(data.joinedMonth)}
                    </span>
                  </div>
                </div>

                {withKpi && (
                  <>
                    <div className={styles.score}>
                      <ProgressRing
                        segments={data.pointSources.map((s, i) => ({
                          label: s.label,
                          value: s.points,
                          color: sourceColor(s.label, i),
                        }))}
                        max={data.points.target}
                        ariaLabel={`Điểm ${monthLabel(data.summaryMonth)} trên chỉ tiêu`}
                      />
                      <p className={styles.scoreNote}>
                        {data.points.total >= data.points.target
                          ? `Đã vượt chỉ tiêu ${monthLabel(data.summaryMonth).toLowerCase()} ${data.points.total - data.points.target} điểm.`
                          : `Còn ${data.points.target - data.points.total} điểm nữa mới đạt chỉ tiêu ${monthLabel(data.summaryMonth).toLowerCase()}.` +
                            (data.daysLeft > 0 ? ` Còn ${data.daysLeft} ngày.` : "")}
                      </p>
                    </div>

                    <dl className={styles.legend}>
                      {data.pointSources.map((s, i) => (
                        <div key={s.label}>
                          <dt>
                            <span
                              className={styles.dot}
                              style={{
                                background: sourceColor(s.label, i),
                              }}
                              aria-hidden
                            />
                            {s.label}
                            <span className={styles.legendDetail}>{s.detail}</span>
                          </dt>
                          <dd className="so">{s.points}</dd>
                        </div>
                      ))}
                    </dl>

                    <p className={styles.footnote}>
                      Tài khoản khách <strong>chưa cài app</strong> không sinh điểm —
                      đó là lý do bảng bên cạnh có dòng mà điểm vẫn chưa lên.
                    </p>
                  </>
                )}
              </div>

              <AccountCard staffId={id} />

              {withKpi && (
                <SectionCard title="Điểm theo tháng" icon={<ChartColumn size={17} />}>
                  <BarChart
                    rows={data.monthlyPoints.map((m) => ({
                      label: shortMonth(m.month),
                      points: m.points,
                    }))}
                    labelKey="label"
                    series={[
                      { key: "points", label: "Điểm", color: chartColors.primary },
                    ]}
                    highlight={shortMonth(data.summaryMonth)}
                    showLegend={false}
                    height={160}
                    caption="Điểm của nhân viên trong 5 tháng gần nhất"
                  />
                </SectionCard>
              )}
            </aside>

            <div className={styles.content}>
              {tabs.length === 0 ? (
                <p className="text-muted">
                  {periodText} chưa có hoạt động nào của {data.fullName}.
                </p>
              ) : (
                <>
                  <SegmentedTabs
                    label="Loại hoạt động"
                    options={tabs}
                    value={activeTab ?? "accounts"}
                    onChange={(v) => setTab(v as TabKey)}
                  />

                  {activeTab === "accounts" && (
                    <div className={styles.panel}>
                      <RankTable
                        rows={customers}
                        columns={ACCOUNT_COLUMNS}
                        rowKey={(c) => c.customerName}
                        defaultSort="date"
                        pageSize={10}
                        caption={`Khách hàng đã tiếp ${periodText}, gộp mọi ngân hàng của một khách vào một hàng`}
                      />
                      <p className={styles.footnote}>
                        Mỗi hàng là một khách — <span className="so">{data.accounts.length}</span>{" "}
                        tài khoản gộp thành <span className="so">{customers.length}</span> hàng.
                        Ô <strong>App đã cài</strong> ghi kèm loại đăng ký khi có:{" "}
                        <em>VPa (CNKD)</em>.
                      </p>
                    </div>
                  )}

                  {activeTab === "insurance" && (
                    <div className={styles.panel}>
                      <RankTable
                        rows={data.insurance}
                        columns={INSURANCE_COLUMNS}
                        rowKey={(o) => o.id}
                        defaultSort="date"
                        pageSize={10}
                        caption={`Đơn bảo hiểm đã tạo ${periodText}`}
                      />
                    </div>
                  )}

                  {activeTab === "services" && (
                    <div className={styles.panel}>
                      <RankTable
                        rows={data.services}
                        columns={SERVICE_COLUMNS}
                        rowKey={(s) => s.id}
                        defaultSort="date"
                        pageSize={10}
                        caption={`Dịch vụ đã làm cho khách ${periodText}`}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
