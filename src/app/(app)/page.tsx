"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Briefcase, Gift, ShieldCheck, Trophy } from "lucide-react";
import { SkeletonStats, SkeletonTable } from "@/components/ui/Skeleton";
import { Checkbox } from "@/components/ui/Checkbox";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { BarChart } from "@/components/ui/BarChart";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterField } from "@/components/ui/FilterField";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { RateDelta } from "@/components/ui/RateDelta";
import { Sparkline } from "@/components/ui/Sparkline";
import { growthPercent, rankingShare, rankingShareTitle, rankingTip } from "@/components/ui/ranking";
import {
  DEFAULT_PERIOD,
  PeriodPicker,
  periodDates,
  periodKey,
  type Period,
} from "@/components/ui/PeriodPicker";
import {
  OVERVIEW_PERIOD_KINDS,
  periodNarrativeLabel,
  previousPeriodLabel,
} from "@/lib/period";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { BankingHeadline } from "@/components/dashboard/BankingHeadline";
import { StaffDashboard } from "@/components/dashboard/StaffDashboard";
import { fetchDashboard, type DepartmentRanking } from "@/lib/api/dashboard";
import { useChartColors } from "@/lib/chart-colors";
import { formatCount, formatPoints } from "@/lib/format";
import { usePrefs } from "@/store/prefs";
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

/**
 * Bốn cột số dùng chung cho bảng phòng và bảng nhân viên — chỉ cột đầu đổi nhãn.
 * Viết hai bộ cột là hai chỗ sớm muộn lệch nhau.
 *
 * `hideSingleAccountCustomers` đổi cột "Khách có TK" sang chỉ đếm khách có TỪ 2
 * tài khoản trở lên — người xem chỉ quan tâm khách mở 2-3 tài khoản, khách 1
 * tài khoản không đáng chú ý.
 */
const rankingColumns = (
  kind: "department" | "staff",
  hideSingleAccountCustomers: boolean,
  rows: DepartmentRanking[],
): RankColumn<DepartmentRanking>[] => {
  // Thanh tỉ lệ so với TỔNG bảng, không so với phòng dẫn đầu — so max thì
  // phòng nhất luôn đầy 100% và các phòng còn lại nhìn như lỗi thanh.
  const totalOpened = rows.reduce((sum, d) => sum + d.accountsOpened, 0);
  const totalApps = rows.reduce((sum, d) => sum + d.appsInstalled, 0);
  const totalPoints = rows.reduce((sum, d) => sum + (d.points ?? 0), 0);

  return [
  { key: "name", label: kind === "staff" ? "Nhân viên" : "Phòng", render: (d) => d.name, title: (d) => d.name },
  {
    key: "accountsOpened",
    label: "TK mở",
    sortBy: (d) => d.accountsOpened,
    sortPrevious: (d) => d.previousAccountsOpened,
    ratio: (d) => rankingShare(d.accountsOpened, totalOpened),
    title: (d) => rankingShareTitle(d.accountsOpened, totalOpened, "tài khoản mở"),
    render: (d) => formatCount(d.accountsOpened),
  },
  {
    key: "appsInstalled",
    label: "App cài",
    sortBy: (d) => d.appsInstalled,
    sortPrevious: (d) => d.previousAppsInstalled,
    ratio: (d) => rankingShare(d.appsInstalled, totalApps),
    title: (d) => rankingShareTitle(d.appsInstalled, totalApps, "app đã cài"),
    render: (d) => formatCount(d.appsInstalled),
  },
  {
    key: "installRate",
    label: "Tỉ lệ cài",
    // Sắp theo MỨC THAY ĐỔI, không theo tỉ lệ tuyệt đối: phòng tụt mạnh nhất là
    // phòng cần gọi trước, dù tỉ lệ của nó vẫn còn cao.
    sortBy: installRate,
    sortPrevious: (d) =>
      d.previousAccountsOpened == null ? null : (d.previousInstallRate ?? 0),
    ratio: installRate,
    title: (d) =>
      d.accountsOpened === 0
        ? "Chưa mở tài khoản"
        : `${installRate(d)}% · ${formatCount(d.appsInstalled)} app trên ${formatCount(d.accountsOpened)} tài khoản`,
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
    label: "Khách có TK",
    sortBy: (d) => (hideSingleAccountCustomers ? d.customersMultiAccount : d.customers),
    sortPrevious: (d) =>
      hideSingleAccountCustomers ? d.previousCustomersMultiAccount : d.previousCustomers,
    render: (d) =>
      formatCount(hideSingleAccountCustomers ? d.customersMultiAccount : d.customers),
    title: (d) =>
      `${formatCount(hideSingleAccountCustomers ? d.customersMultiAccount : d.customers)} ${
        hideSingleAccountCustomers ? "khách có từ 2 tài khoản" : "khách có tài khoản"
      }`,
  },
  {
    key: "points",
    label: "Điểm",
    // ⚠️ Cột này gom theo NGƯỜI LẬP HỒ SƠ KHÁCH, bốn cột kia gom theo người mở
    // tài khoản (thể lệ câu 7.11). Hai cách lệch nhau ở ca mở hộ tài khoản cho
    // khách của đồng nghiệp, và cột điểm phải khớp bảng lương.
    sortBy: (d) => d.points ?? 0,
    sortPrevious: (d) => d.previousPoints,
    ratio: (d) => rankingShare(d.points ?? 0, totalPoints),
    title: (d) => rankingShareTitle(d.points ?? 0, totalPoints, "điểm"),
    render: (d) => <span className="tabular-nums">{formatPoints(d.points ?? 0)}</span>,
  },
  {
    key: "growth",
    label: "Tăng trưởng",
    sortBy: (d) =>
      growthPercent(d.accountsOpened, d.previousAccountsOpened) ?? Number.NEGATIVE_INFINITY,
    title: (d) => {
      const percent = growthPercent(d.accountsOpened, d.previousAccountsOpened);
      const change =
        percent == null
          ? null
          : percent === 0
            ? "Không đổi so với kỳ trước"
            : `${percent > 0 ? "+" : ""}${percent}% so với kỳ trước`;
      const series = d.growth.length
        ? `Tài khoản mở 7 ngày: ${d.growth.join(", ")}`
        : null;
      return rankingTip(change, series);
    },
    render: (d) => {
      const percent = growthPercent(d.accountsOpened, d.previousAccountsOpened);
      return (
        <span className={styles.growthCell}>
          {percent != null && percent !== 0 && (
            <span className={percent > 0 ? styles.growthUp : styles.growthDown}>
              <RateDelta points={percent} />%
            </span>
          )}
          <Sparkline
            values={d.growth}
            label={`Tài khoản mở 7 ngày đến hết kỳ, ${d.name}: ${d.growth.join(", ")}`}
          />
        </span>
      );
    },
  },
];
};

/**
 * P-80 · Tổng quan — bốn cách nhìn, MÁY CHỦ chọn (chốt 06/08).
 *
 *   Giám đốc         toàn công ty
 *   Phó giám đốc     những phòng họ quản
 *   Trưởng/Phó phòng phòng của họ
 *   Nhân viên        chỉ số của chính mình — đổi hẳn sang khối hồ sơ P-52
 *
 * Trang KHÔNG gửi phạm vi lên: phiên đăng nhập đã nói đủ, và một tham số phạm
 * vi trên đường truyền chỉ là chỗ để nặn tay.
 */
export default function DashboardPage() {
  const chartColors = useChartColors();
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const hideSingleAccountCustomers = usePrefs((s) => s.hideSingleAccountCustomers);
  const setHideSingleAccountCustomers = usePrefs((s) => s.setHideSingleAccountCustomers);

  const { data: view, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["dashboard", periodKey(period)],
    queryFn: () => fetchDashboard(period),
    refetchInterval: 15_000,
  });

  const overview = view && view.kind === "overview" ? view : null;
  const data = overview?.data ?? null;

  const periodLabel = periodNarrativeLabel(period.kind);
  const previousLabel = previousPeriodLabel(period.kind);

  const previous = data?.banking.previousInstallPercent ?? null;
  const installGap = previous === null ? null : data!.banking.installPercent - previous;

  /** Hàng tổng của bảng Xếp hạng phòng/nhân viên — cùng cách cộng với trang Phòng ban. */
  const rankingTotals = (data?.departments ?? []).reduce(
    (sum, d) => ({
      accountsOpened: sum.accountsOpened + d.accountsOpened,
      appsInstalled: sum.appsInstalled + d.appsInstalled,
      customers: sum.customers + d.customers,
      customersMultiAccount: sum.customersMultiAccount + d.customersMultiAccount,
      points: sum.points + (d.points ?? 0),
    }),
    { accountsOpened: 0, appsInstalled: 0, customers: 0, customersMultiAccount: 0, points: 0 },
  );
  const rankingInstallRate =
    rankingTotals.accountsOpened === 0
      ? 0
      : Math.round((rankingTotals.appsInstalled / rankingTotals.accountsOpened) * 100);

  return (
    <>
      <TopBar title="Tổng quan" keepTitleOnMobile welcome>
        <div className="desktop-only">
          <PeriodPicker
            value={period}
            onChange={setPeriod}
            kinds={OVERVIEW_PERIOD_KINDS}
            variant="toolbar"
          />
        </div>
        {/* Trên desktop bộ chọn kỳ đã hiện thẳng ở trên — nút "Bộ lọc" ở đây
            chỉ có việc trên điện thoại, ẩn hẳn (không chỉ ẩn nội dung) ở
            desktop để khỏi thừa một nút mở ra không có gì bên trong. */}
        <div className="mobile-only">
          <FilterButton
            activeCount={period.kind === "today" ? 0 : 1}
            onClear={() => setPeriod(DEFAULT_PERIOD)}
          >
            <FilterField id="period" label="Kỳ" count={period.kind === "today" ? 0 : 1}>
              <PeriodPicker
                value={period}
                onChange={setPeriod}
                kinds={OVERVIEW_PERIOD_KINDS}
              />
            </FilterField>
          </FilterButton>
        </div>
      </TopBar>

      <main className={styles.body}>
        {isPending && (
          <>
            <SkeletonStats count={3} />
            <SkeletonTable rows={5} columns={4} />
          </>
        )}
        {isError && (
          <ErrorState what="số liệu tổng quan" onRetry={refetch} retrying={isFetching} />
        )}

        {/* Nhân viên: layout riêng — vòng điểm luôn theo THÁNG (chỉ tiêu là
            con số của cả tháng), ba thẻ đếm đi theo kỳ đang chọn. */}
        {view && view.kind === "personal" && (
          <StaffDashboard
            person={view.person}
            draftAccounts={view.draftAccounts}
            periodLabel={periodLabel}
            {...periodDates(period)}
          />
        )}

        {data && (
          <>
            {/* Cùng một màn cho bốn cách nhìn, nên phải nói rõ đang nhìn phạm vi
                nào — thiếu dòng này thì trưởng phòng đọc số của phòng mình mà
                tưởng là số của cả công ty. */}
            <p className={styles.scopeNote}>
              Phạm vi: <strong>{overview!.scopeLabel}</strong>
            </p>

            <BankingHeadline
              summary={data.banking}
              periodLabel={periodLabel}
              delta={
                installGap === null || previousLabel === null
                  ? undefined
                  : {
                      up: installGap >= 0,
                      text: `${previousLabel} ${previous}% (${installGap >= 0 ? "↑" : "↓"} ${Math.abs(installGap)}%)`,
                    }
              }
              appsCompanion={{
                value: formatCount(data.banking.giftsPending),
                label: "chưa phát thưởng",
                badge: "Đủ ĐK quà",
              }}
            >
              {/* Giám đốc thấy điểm cả công ty; Trưởng phòng, Phó phòng và Phó
                  GĐ thấy điểm phòng mình. Nhân viên xem mặt cá nhân nên máy chủ
                  trả `null`.

                  `!== null` chứ không kiểm trung thực: phạm vi được 0 điểm vẫn
                  phải hiện ô, chứ không phải ẩn đi như người không có quyền. */}
              {data.scopePoints !== null && (
                <StatCard
                  value={formatPoints(data.scopePoints.points)}
                  label={
                    data.scopePoints.kind === "company" ? "điểm tổng cty" : "điểm tổng phòng"
                  }
                  detail={`${overview!.scopeLabel} ${periodLabel}`}
                />
              )}
            </BankingHeadline>

            <div className={styles.grid}>
              <SectionCard
                title={`Bảo hiểm ${periodLabel}`}
                icon={<ShieldCheck size={17} />}
                className={styles.wide}
              >
                <div className={styles.statRow}>
                  <StatCard
                    value={formatCount(data.insurance.createdToday)}
                    label={`đơn BH tạo ${periodLabel}`}
                    detail={`BH tai nạn điện ${formatCount(data.insurance.electricCount)} · BH xe máy ${formatCount(data.insurance.motorbikeCount)}`}
                  />
                  <StatCard
                    value={formatCount(data.insurance.completed)}
                    label="hoàn thành"
                    detail={`${data.insurance.completedPercent}%`}
                  />
                  <StatCard
                    value={formatCount(data.insurance.pending)}
                    label="đơn tồn hiện tại"
                    detail={`${formatCount(data.insurance.pendingBot)} đang chạy · ${formatCount(data.insurance.pendingManual)} chờ làm tay`}
                  />
                  {/* Đứng riêng vì nó KHÔNG nằm trong ô "đơn BH tạo" bên trái —
                      hai số cộng lại mới ra tổng đơn đã lập trong kỳ. */}
                  <StatCard
                    value={formatCount(data.insurance.cancelled)}
                    label={`huỷ ${periodLabel}`}
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

              {/* Trưởng phòng và Phó phòng chỉ thấy một phòng, nên máy chủ đổi
                  bảng sang xếp hạng nhân viên trong phòng đó (chốt 13/08). Bốn
                  cột số y hệt, chỉ cột đầu đổi nhãn. */}
              <SectionCard
                title={data.rankingKind === "staff" ? "Xếp hạng nhân viên" : "Xếp hạng phòng"}
                icon={<Trophy size={17} />}
                meta={periodLabel}
                className={styles.wide}
                action={
                  <Checkbox
                    checked={hideSingleAccountCustomers}
                    onCheckedChange={setHideSingleAccountCustomers}
                    label="Ẩn khách 1 tài khoản"
                  />
                }
              >
                <RankTable
                  rows={data.departments}
                  columns={rankingColumns(
                    data.rankingKind,
                    hideSingleAccountCustomers,
                    data.departments,
                  )}
                  rowKey={(d) => d.id}
                  defaultSort="accountsOpened"
                  highlightTop={3}
                  caption={
                    data.rankingKind === "staff"
                      ? "Xếp hạng nhân viên trong phòng theo số tài khoản mở, app đã cài, tỉ lệ cài app và số khách có tài khoản"
                      : "Xếp hạng phòng kinh doanh theo số tài khoản mở, app đã cài, tỉ lệ cài app và số khách có tài khoản"
                  }
                  summaryRow={
                    data.departments.length > 0
                      ? [
                          "Tổng",
                          formatCount(rankingTotals.accountsOpened),
                          formatCount(rankingTotals.appsInstalled),
                          `${rankingInstallRate}%`,
                          formatCount(
                            hideSingleAccountCustomers
                              ? rankingTotals.customersMultiAccount
                              : rankingTotals.customers,
                          ),
                          formatPoints(rankingTotals.points),
                          "",
                        ]
                      : undefined
                  }
                />
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
                      <dd className="tabular-nums">{formatCount(s.count)}</dd>
                    </div>
                  ))}
                </dl>
                <p className={styles.footnote}>
                  Xã nhiều nhất · {data.services.topWard.name}{" "}
                  <span className="tabular-nums">{formatCount(data.services.topWard.count)}</span>
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
                      <dd className="tabular-nums">{formatCount(g.count)}</dd>
                    </div>
                  ))}
                </dl>
              </SectionCard>
            </div>
          </>
        )}
      </main>
    </>
  );
}
