"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Briefcase, Gift, ShieldCheck, Trophy } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { BarChart } from "@/components/ui/BarChart";
import { FilterButton } from "@/components/ui/FilterButton";
import { KpiHighlight } from "@/components/ui/KpiHighlight";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { RateDelta } from "@/components/ui/RateDelta";
import {
  DEFAULT_PERIOD,
  PeriodPicker,
  periodKey,
  type Period,
} from "@/components/ui/PeriodPicker";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { StatStack } from "@/components/ui/StatStack";
import { fetchDashboard, type DepartmentRanking } from "@/lib/api/dashboard";
import { useChartColors } from "@/lib/chart-colors";
import { availableScopes } from "@/lib/permissions";
import type { Scope } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

/** Trục ngang của biểu đồ đổi theo kỳ — một ngày thì chia giờ, dài hơn thì chia ngày. */
const BUCKET_LABEL = {
  hour: "khung giờ",
  day: "ngày",
  week: "tuần",
  month: "tháng",
} as const;

const installRate = (d: DepartmentRanking) =>
  d.accountsOpened === 0 ? 0 : Math.round((d.appsInstalled / d.accountsOpened) * 100);

const DEPARTMENT_COLUMNS: RankColumn<DepartmentRanking>[] = [
  { key: "name", label: "Phòng", render: (d) => d.name },
  {
    key: "accountsOpened",
    label: "TK mở",
    sortBy: (d) => d.accountsOpened,
    render: (d) => d.accountsOpened,
  },
  {
    key: "appsInstalled",
    label: "App cài",
    sortBy: (d) => d.appsInstalled,
    render: (d) => d.appsInstalled,
  },
  {
    key: "installRate",
    label: "Tỉ lệ cài",
    // Sắp theo MỨC THAY ĐỔI, không theo tỉ lệ tuyệt đối: phòng tụt mạnh nhất là
    // phòng cần gọi trước, dù tỉ lệ của nó vẫn còn cao.
    sortBy: installRate,
    render: (d) => (
      <span className={styles.rateCell}>
        <span className="tabular-nums">{installRate(d)}%</span>
        {d.previousInstallRate !== null && (
          <RateDelta points={installRate(d) - d.previousInstallRate} />
        )}
      </span>
    ),
  },
  {
    key: "customers",
    label: "Khách hàng",
    sortBy: (d) => d.customers,
    render: (d) => d.customers,
  },
];

/** P-80 · Dashboard tổng — Ban giám đốc và trưởng phòng (phạm vi hẹp hơn). */
export default function DashboardPage() {
  const user = useSession((s) => s.user);
  const chartColors = useChartColors();
  const scopes = availableScopes(user, "banking", "view-summary");
  const scope: Scope = scopes.at(-1) ?? "own";
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

  /**
   * Kỳ đem so. Khoảng ngày tự chọn thì `null` — một khoảng tuỳ ý không có kỳ
   * liền trước nào định nghĩa được, và máy chủ cũng trả previousPercent = null.
   */
  const previousLabel =
    period.kind === "today"
      ? "hôm qua"
      : period.kind === "this-month"
        ? "tháng trước"
        : null;

  const previous = data?.installRate.previousPercent ?? null;
  const installGap = previous === null ? null : data!.installRate.percent - previous;

  return (
    <>
      <TopBar title="Tổng quan">
        <div className="desktop-only">
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
        {/* Trên desktop bộ chọn kỳ đã hiện thẳng ở trên — nút "Bộ lọc" ở đây
            chỉ có việc trên điện thoại, ẩn hẳn (không chỉ ẩn nội dung) ở
            desktop để khỏi thừa một nút mở ra không có gì bên trong. */}
        <div className="mobile-only">
          <FilterButton
            activeCount={period.kind === "today" ? 0 : 1}
            onClear={() => setPeriod(DEFAULT_PERIOD)}
          >
            <PeriodPicker value={period} onChange={setPeriod} />
          </FilterButton>
        </div>
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
                detail={`${data.installRate.appsInstalled} app / ${data.installRate.accountsOpened} tài khoản mở ${periodLabel}`}
                delta={
                  installGap === null
                    ? undefined
                    : {
                        up: installGap >= 0,
                        text: `${previousLabel} ${previous}% (${installGap >= 0 ? "↑" : "↓"} ${Math.abs(installGap)}%)`,
                      }
                }
              />

              <StatStack
                items={[
                  { value: data.banking.accountsOpened, label: "tài khoản mở" },
                  {
                    value: data.banking.customers,
                    label: `khách hàng ${periodLabel}`,
                  },
                ]}
              />

              <StatStack
                items={[
                  { value: data.banking.appsInstalled, label: "app đã cài" },
                  {
                    value: data.banking.giftsPending,
                    label: "chưa phát thưởng",
                    badge: "Đủ ĐK quà",
                  },
                ]}
              />
            </div>

            <div className={styles.grid}>
              <SectionCard
                title={`Bảo hiểm ${periodLabel}`}
                icon={<ShieldCheck size={17} />}
                className={styles.wide}
              >
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
                    { key: "motorbike", label: "BH xe máy", color: chartColors.primary },
                    { key: "electric", label: "BH tai nạn điện", color: chartColors.secondary },
                  ]}
                />
              </SectionCard>

              <SectionCard
                title="Xếp hạng phòng"
                icon={<Trophy size={17} />}
                meta={periodLabel}
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
                  không tính quà, không tính điểm. Số nhỏ bên cạnh là mức thay đổi
                  so với {previousLabel ?? "kỳ trước"}; chọn khoảng ngày thì không
                  có kỳ nào để so nên cột này chỉ còn tỉ lệ.
                </p>
              </SectionCard>

              <SectionCard
                title="Dịch vụ theo loại"
                icon={<Briefcase size={17} />}
                meta={periodLabel}
              >
                <dl className={styles.pairs}>
                  {data.services.byType.map((s) => (
                    <div key={s.label}>
                      <dt>{s.label}</dt>
                      <dd className="tabular-nums">{s.count}</dd>
                    </div>
                  ))}
                </dl>
                <p className={styles.footnote}>
                  Xã nhiều nhất · {data.services.topWard.name}{" "}
                  <span className="tabular-nums">{data.services.topWard.count}</span>
                </p>
              </SectionCard>

              <SectionCard
                title="Quà đã tặng"
                icon={<Gift size={17} />}
                meta={periodLabel}
              >
                <dl className={styles.pairs}>
                  {data.gifts.byType.map((g) => (
                    <div key={g.label}>
                      <dt>{g.label}</dt>
                      <dd className="tabular-nums">{g.count}</dd>
                    </div>
                  ))}
                </dl>
                <p className={styles.footnote}>
                  Chưa phát · <span className="tabular-nums">{data.gifts.pending}</span> khách
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
