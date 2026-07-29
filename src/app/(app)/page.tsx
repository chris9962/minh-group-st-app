"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { BarChart } from "@/components/ui/BarChart";
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

  const { data, isPending, isError } = useQuery({
    queryKey: ["dashboard", scope],
    queryFn: () => fetchDashboard(scope),
  });

  const today = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date());

  return (
    <>
      <TopBar title="Tổng quan">
        <ScopeSwitcher options={scopes} value={scope} onChange={setScope} />
        <span className={styles.today}>Hôm nay · {today}</span>
      </TopBar>

      <main className={styles.body}>
        {isPending && <p className="text-muted">Đang tải số liệu…</p>}
        {isError && <p className="text-muted">Không tải được số liệu tổng quan.</p>}

        {data && (
          <>
            <SectionCard title="Chỉ số quan trọng nhất">
              <div className={styles.headline}>
                <StatCard
                  featured
                  value={`${data.installRate.percent}%`}
                  label="tỉ lệ cài app trên số tài khoản mở"
                  detail={`${data.installRate.appsInstalled} app / ${data.installRate.accountsOpened} tài khoản mở hôm nay · tháng trước ${data.installRate.previousPercent}%`}
                />
                <div className={styles.headlineSide}>
                  <StatCard value={data.banking.accountsOpened} label="tài khoản mở" />
                  <StatCard value={data.banking.appsInstalled} label="app đã cài" />
                  <StatCard value={data.banking.codesRunningLow} label="mã sắp hết" />
                  <StatCard
                    value={data.banking.giftsPending}
                    label="đủ ĐK quà, chưa phát"
                  />
                </div>
              </div>
            </SectionCard>

            <div className={styles.grid}>
              <SectionCard title="Bảo hiểm hôm nay" className={styles.wide}>
                <div className={styles.statRow}>
                  <StatCard
                    value={data.insurance.createdToday}
                    label="đơn BH tạo hôm nay"
                    detail={`cháy nổ ${data.insurance.fireCount} · xe máy ${data.insurance.motorbikeCount}`}
                  />
                  <StatCard
                    value={data.insurance.completed}
                    label="hoàn thành"
                    detail={`${data.insurance.completedPercent}%`}
                  />
                  <StatCard
                    value={data.insurance.pending}
                    label="đơn tồn"
                    detail={`${data.insurance.pendingBot} đang chạy · ${data.insurance.pendingManual} chờ làm tay`}
                  />
                  <StatCard
                    value={`${data.insurance.avgMinutes}′${String(data.insurance.avgSeconds).padStart(2, "0")}″`}
                    label="thời gian TB mỗi đơn"
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

              <SectionCard title="Chất lượng vận hành" meta="7 ngày">
                <dl className={styles.pairs}>
                  <div>
                    <dt>Tỉ lệ bot thành công</dt>
                    <dd className="so">{data.quality.botSuccessPercent}%</dd>
                  </div>
                  <div>
                    <dt>Thời gian bot TB</dt>
                    <dd className="so">
                      {data.quality.botAvgMinutes}′
                      {String(data.quality.botAvgSeconds).padStart(2, "0")}″
                    </dd>
                  </div>
                  <div>
                    <dt>Đơn phải làm tay</dt>
                    <dd className="so">{data.quality.manualOrders}</dd>
                  </div>
                  <div>
                    <dt>Đơn KD nhập sai</dt>
                    <dd className="so">{data.quality.badInputOrders}</dd>
                  </div>
                  <div>
                    <dt>Đơn tồn qua đêm</dt>
                    <dd className="so">{data.quality.overnightOrders}</dd>
                  </div>
                </dl>
              </SectionCard>

              <SectionCard title="Dịch vụ theo loại">
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
