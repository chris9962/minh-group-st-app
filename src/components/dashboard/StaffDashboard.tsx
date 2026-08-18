"use client";

import Link from "next/link";
import { ChartColumn, Landmark, Target } from "lucide-react";
import { BarChart } from "@/components/ui/BarChart";
import { monthLabel } from "@/components/ui/MonthPicker";
import { KpiScoreBlock } from "@/components/people/KpiScoreBlock";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import type { DashboardDraftAccount } from "@/lib/api/dashboard";
import type { PersonDetail } from "@/lib/api/person";
import { sourceColor, useChartColors } from "@/lib/chart-colors";
import { formatDate, formatPoints } from "@/lib/format";
import styles from "./StaffDashboard.module.scss";

type Props = {
  person: PersonDetail;
  /** Tài khoản đang tạo dở của chính người xem — mới tạo nhất đứng đầu. */
  draftAccounts: DashboardDraftAccount[];
  /** "hôm nay" · "tháng này" · "khoảng đã chọn" — nhãn cho ba thẻ đếm. */
  periodLabel: string;
};

const shortMonth = (month: string) => `T${Number(month.slice(5, 7))}`;

/**
 * Mặt `personal` của màn Tổng quan P-80 — layout RIÊNG cho nhân viên tự xem.
 *
 * Không dùng `PersonKpiPanel`: khối đó dựng làm cột bên cho P-52 (cấp trên xem
 * hồ sơ người khác) nên có dòng nhận diện và bề ngang cột hẹp — đem đặt làm
 * nội dung chính của cả màn thì lửng lơ giữa trang. Ở đây người xem là chính
 * chủ, không cần tự giới thiệu; điểm và việc đang dở là thứ đứng đầu.
 */
export function StaffDashboard({ person, draftAccounts, periodLabel }: Props) {
  const chartColors = useChartColors();

  return (
    <div className={styles.wrap}>
      <div className={styles.statRow}>
        <StatCard value={person.counts.accounts} label={`tài khoản mở ${periodLabel}`} />
        <StatCard value={person.counts.insurance} label={`đơn bảo hiểm ${periodLabel}`} />
        <StatCard value={person.counts.services} label={`lượt dịch vụ ${periodLabel}`} />
      </div>

      <div className={styles.grid}>
        <SectionCard
          title={`Điểm ${monthLabel(person.summaryMonth)}`}
          icon={<Target size={17} />}
          meta={person.daysLeft > 0 ? `còn ${person.daysLeft} ngày` : undefined}
        >
          <KpiScoreBlock
            sources={person.pointSources}
            target={person.points.target}
            ariaLabel={`Điểm ${monthLabel(person.summaryMonth)} trên chỉ tiêu`}
            facts={
              <>
                <div>
                  <dt>Chỉ tiêu</dt>
                  <dd className="tabular-nums">{formatPoints(person.points.target)} điểm</dd>
                </div>
                <div>
                  <dt>{person.points.total >= person.points.target ? "Vượt" : "Còn thiếu"}</dt>
                  <dd className="tabular-nums">
                    {formatPoints(Math.abs(person.points.target - person.points.total))} điểm
                  </dd>
                </div>
              </>
            }
          />
        </SectionCard>

        <SectionCard title="Điểm theo tháng" icon={<ChartColumn size={17} />}>
          <BarChart
            rows={person.monthlyPoints.map((m) => ({
              label: shortMonth(m.month),
              points: m.points,
            }))}
            labelKey="label"
            series={[{ key: "points", label: "Điểm", color: chartColors.primary }]}
            highlight={shortMonth(person.summaryMonth)}
            showLegend={false}
            height={180}
            caption="Điểm trong 5 tháng gần nhất"
          />
        </SectionCard>
      </div>

      {/* Việc đang dở — mỗi bản `creating` là một lượt mã đang bị giữ, bỏ quên
          thì mã nằm chết. Mới tạo nhất đứng đầu (máy chủ sắp). */}
      {draftAccounts.length > 0 && (
        <SectionCard
          title="Tài khoản chưa hoàn thành"
          icon={<Landmark size={17} />}
          meta={`${draftAccounts.length} tài khoản`}
        >
          <ul className={styles.drafts}>
            {draftAccounts.map((a) => (
              <li key={a.id} className={styles.draftRow}>
                <span>
                  <strong>{a.bankCode}</strong> · {a.referralCode} —{" "}
                  <Link href={`/customers/${a.customerId}`} className={styles.draftCustomer}>
                    {a.customerName}
                  </Link>
                  <span className={styles.draftDate}>{formatDate(a.createdAt)}</span>
                </span>
                <Link href={`/banking/${a.id}`} className="btn btn-secondary">
                  Tiếp tục
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
