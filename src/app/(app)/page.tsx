"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Briefcase, Gift, ShieldCheck, Trophy } from "lucide-react";
import { SkeletonStats, SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
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
import { PersonKpiPanel } from "@/components/people/PersonKpiPanel";
import { fetchDashboard, type DepartmentRanking } from "@/lib/api/dashboard";
import { useChartColors } from "@/lib/chart-colors";
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
 */
const rankingColumns = (kind: "department" | "staff"): RankColumn<DepartmentRanking>[] => [
  { key: "name", label: kind === "staff" ? "Nhân viên" : "Phòng", render: (d) => d.name },
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

  const { data: view, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["dashboard", periodKey(period)],
    queryFn: () => fetchDashboard(period),
  });

  const overview = view && view.kind === "overview" ? view : null;
  const data = overview?.data ?? null;

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
        {isPending && (
          <>
            <SkeletonStats count={3} />
            <SkeletonTable rows={5} columns={4} />
          </>
        )}
        {isError && (
          <ErrorState what="số liệu tổng quan" onRetry={refetch} retrying={isFetching} />
        )}

        {/* Nhân viên: chỉ số của CHÍNH họ, đúng khối hồ sơ mà cấp trên nhìn
            thấy ở P-52. Vòng điểm luôn theo THÁNG (chỉ tiêu là con số của cả
            tháng), còn ba thẻ đếm bên dưới đi theo kỳ đang chọn. */}
        {view && view.kind === "personal" && (
          <div className={styles.personal}>
            <PersonKpiPanel person={view.person} withKpi />
            <div className={styles.statRow}>
              <StatCard
                value={view.person.counts.accounts}
                label={`tài khoản mở ${periodLabel}`}
              />
              <StatCard
                value={view.person.counts.insurance}
                label={`đơn bảo hiểm ${periodLabel}`}
              />
              <StatCard
                value={view.person.counts.services}
                label={`lượt dịch vụ ${periodLabel}`}
              />
            </div>
          </div>
        )}

        {data && (
          <>
            {/* Cùng một màn cho bốn cách nhìn, nên phải nói rõ đang nhìn phạm vi
                nào — thiếu dòng này thì trưởng phòng đọc số của phòng mình mà
                tưởng là số của cả công ty. */}
            <p className={styles.scopeNote}>
              Phạm vi: <strong>{overview!.scopeLabel}</strong>
            </p>

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

              {/* Trưởng phòng và Phó phòng chỉ thấy một phòng, nên máy chủ đổi
                  bảng sang xếp hạng nhân viên trong phòng đó (chốt 13/08). Bốn
                  cột số y hệt, chỉ cột đầu đổi nhãn. */}
              <SectionCard
                title={data.rankingKind === "staff" ? "Xếp hạng nhân viên" : "Xếp hạng phòng"}
                icon={<Trophy size={17} />}
                meta={periodLabel}
                className={styles.wide}
              >
                <RankTable
                  rows={data.departments}
                  columns={rankingColumns(data.rankingKind)}
                  rowKey={(d) => d.id}
                  defaultSort="accountsOpened"
                  caption={
                    data.rankingKind === "staff"
                      ? "Xếp hạng nhân viên trong phòng theo số tài khoản mở, app đã cài, tỉ lệ cài app và số khách hàng"
                      : "Xếp hạng phòng kinh doanh theo số tài khoản mở, app đã cài, tỉ lệ cài app và số khách hàng"
                  }
                />
                <p className={styles.footnote}>
                  Bấm tên cột để sắp xếp. Lật cột <strong>Tỉ lệ cài</strong> để tìm{" "}
                  {data.rankingKind === "staff" ? "người" : "phòng"} mở nhiều tài khoản
                  nhưng khách ít cài app — số tài khoản đó không tính quà, không tính
                  điểm. Số nhỏ bên cạnh là mức thay đổi so với{" "}
                  {previousLabel ?? "kỳ trước"}; chọn khoảng ngày thì không có kỳ nào
                  để so nên cột này chỉ còn tỉ lệ.
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
