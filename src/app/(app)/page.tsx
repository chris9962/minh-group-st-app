"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { BarChart } from "@/components/ui/BarChart";
import { KpiHighlight } from "@/components/ui/KpiHighlight";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import {
  DEFAULT_PERIOD,
  PeriodPicker,
  periodKey,
  type Period,
} from "@/components/ui/PeriodPicker";
import { ScopeSwitcher } from "@/components/ui/ScopeSwitcher";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { fetchDashboard } from "@/lib/api/dashboard";
import { CHART_COLORS } from "@/lib/chart-colors";
import { availableScopes } from "@/lib/permissions";
import type { Scope } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.css";

/** Trục ngang của biểu đồ đổi theo kỳ — một ngày thì chia giờ, dài hơn thì chia ngày. */
const BUCKET_LABEL = {
  hour: "khung giờ",
  day: "ngày",
  week: "tuần",
  month: "tháng",
} as const;

type DepartmentRow = {
  id: string;
  name: string;
  accountsOpened: number;
  appsInstalled: number;
  customers: number;
};

const installRate = (d: DepartmentRow) =>
  d.accountsOpened === 0 ? 0 : Math.round((d.appsInstalled / d.accountsOpened) * 100);

const DEPARTMENT_COLUMNS: RankColumn<DepartmentRow>[] = [
  { key: "name", label: "Phòng", render: (d) => d.name },
  {
    key: "accountsOpened",
    label: "TK mở",
    align: "right",
    sortBy: (d) => d.accountsOpened,
    render: (d) => d.accountsOpened,
  },
  {
    key: "appsInstalled",
    label: "App cài",
    align: "right",
    sortBy: (d) => d.appsInstalled,
    render: (d) => d.appsInstalled,
  },
  {
    key: "installRate",
    label: "Tỉ lệ cài",
    align: "right",
    sortBy: installRate,
    ratio: installRate,
    render: (d) => `${installRate(d)}%`,
  },
  {
    key: "customers",
    label: "Khách hàng",
    align: "right",
    sortBy: (d) => d.customers,
    render: (d) => d.customers,
  },
];

/** P-80 · Dashboard tổng — Ban giám đốc và trưởng phòng (phạm vi hẹp hơn). */
export default function DashboardPage() {
  const user = useSession((s) => s.user);
  const scopes = availableScopes(user, "banking", "view-stats");
  const [scope, setScope] = useState<Scope>(scopes.at(-1) ?? "own");
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);

  const { data, isPending, isError } = useQuery({
    queryKey: ["dashboard", scope, periodKey(period)],
    queryFn: () => fetchDashboard(scope, period),
  });

  const periodLabel =
    period.kind === "today"
      ? "hôm nay"
      : period.kind === "this-month"
        ? "tháng này"
        : "khoảng đã chọn";

  return (
    <>
      <TopBar title="Tổng quan">
        <ScopeSwitcher options={scopes} value={scope} onChange={setScope} />
        <PeriodPicker value={period} onChange={setPeriod} />
      </TopBar>

      <main className={styles.body}>
        {isPending && <p className="text-muted">Đang tải số liệu…</p>}
        {isError && <p className="text-muted">Không tải được số liệu tổng quan.</p>}

        {data && (
          <>
            <div className={styles.headline}>
              <KpiHighlight
                ariaLabel="Tỉ lệ cài app trên số tài khoản mở"
                percent={data.installRate.percent}
                description={
                  <>
                    tỉ lệ cài app trên
                    <br />
                    số tài khoản mở
                  </>
                }
                detail={`${data.installRate.appsInstalled} app / ${data.installRate.accountsOpened} tài khoản mở ${periodLabel} · kỳ trước ${data.installRate.previousPercent}%`}
              />

              <div className={styles.statGrid}>
                <StatCard value={data.banking.accountsOpened} label="tài khoản mở" />
                <StatCard value={data.banking.appsInstalled} label="app đã cài" />
                <StatCard value={data.banking.customers} label={`khách hàng ${periodLabel}`} />
                <StatCard
                  value={data.banking.giftsPending}
                  label="đủ ĐK quà, chưa phát"
                  tone="attention"
                />
              </div>
            </div>

            <div className={styles.grid}>
              <SectionCard title={`Bảo hiểm ${periodLabel}`} className={styles.wide}>
                <div className={styles.statRow}>
                  <StatCard
                    value={data.insurance.createdToday}
                    label={`đơn BH tạo ${periodLabel}`}
                    detail={`BH tai nạn điện ${data.insurance.electricCount} · BH xe máy ${data.insurance.motorbikeCount}`}
                  />
                  <StatCard
                    value={data.insurance.completed}
                    label="hoàn thành"
                    detail={`${data.insurance.completedPercent}%`}
                  />
                  <StatCard
                    value={data.insurance.pending}
                    label="đơn tồn hiện tại"
                    detail={`${data.insurance.pendingBot} đang chạy · ${data.insurance.pendingManual} chờ làm tay`}
                  />
                </div>

                <BarChart
                  title={`Đơn theo ${BUCKET_LABEL[data.insurance.bucketType]}`}
                  caption={`Đơn bảo hiểm theo ${BUCKET_LABEL[data.insurance.bucketType]}, tách theo loại sản phẩm`}
                  labelKey="label"
                  rows={data.insurance.buckets}
                  series={[
                    { key: "motorbike", label: "BH xe máy", color: CHART_COLORS.primary },
                    { key: "electric", label: "BH tai nạn điện", color: CHART_COLORS.secondary },
                  ]}
                />
              </SectionCard>

              <SectionCard
                title="Xếp hạng phòng"
                meta={periodLabel}
                variant="plain"
                className={styles.wide}
              >
                <RankTable
                  rows={data.departments}
                  columns={DEPARTMENT_COLUMNS}
                  rowKey={(d) => d.id}
                  defaultSort="accountsOpened"
                  caption="Xếp hạng phòng kinh doanh theo số tài khoản mở, app đã cài, tỉ lệ cài app và số khách hàng"
                />
                <p className={styles.footnote}>
                  Bấm tên cột để sắp xếp. Lật cột <strong>Tỉ lệ cài</strong> để tìm
                  phòng mở nhiều tài khoản nhưng khách ít cài app — số tài khoản đó
                  không tính quà, không tính điểm.
                </p>
              </SectionCard>

              <SectionCard title="Dịch vụ theo loại" meta={periodLabel}>
                <dl className={styles.pairs}>
                  {data.services.byType.map((s) => (
                    <div key={s.label}>
                      <dt>{s.label}</dt>
                      <dd className="so">{s.count}</dd>
                    </div>
                  ))}
                </dl>
                <p className={styles.footnote}>
                  Xã nhiều nhất · {data.services.topWard.name}{" "}
                  <span className="so">{data.services.topWard.count}</span>
                </p>
              </SectionCard>

              <SectionCard title="Quà đã tặng" meta={periodLabel}>
                <dl className={styles.pairs}>
                  {data.gifts.byType.map((g) => (
                    <div key={g.label}>
                      <dt>{g.label}</dt>
                      <dd className="so">{g.count}</dd>
                    </div>
                  ))}
                </dl>
                <p className={styles.footnote}>
                  Chưa phát · <span className="so">{data.gifts.pending}</span> khách
                  đủ điều kiện. Tổng ở đây lớn hơn số khách vì mỗi khách nhận tiền
                  mặt <em>cộng thêm</em> một món trong rổ quà.
                </p>
              </SectionCard>
            </div>
          </>
        )}
      </main>
    </>
  );
}
