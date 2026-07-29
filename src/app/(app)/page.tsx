"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { BarChart } from "@/components/ui/BarChart";
import { KpiHighlight } from "@/components/ui/KpiHighlight";
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
import { availableScopes } from "@/lib/permissions";
import type { Scope } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.css";

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
                kicker="Chỉ số quan trọng nhất"
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
                    detail={`cháy nổ ${data.insurance.fireCount} · xe máy ${data.insurance.motorbikeCount}`}
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
                  caption="Đơn bảo hiểm theo khung giờ, tách đơn tự động và đơn làm tay"
                  series={[
                    { label: "tự động", color: "var(--color-accent-2-500)" },
                    { label: "làm tay", color: "var(--color-accent-500)" },
                  ]}
                  rows={data.insurance.byHour.map((h) => ({
                    label: h.label,
                    values: [h.automatic, h.manual],
                  }))}
                />
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
            </div>
          </>
        )}
      </main>
    </>
  );
}
