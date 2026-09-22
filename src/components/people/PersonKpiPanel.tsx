"use client";

import { ChartColumn } from "lucide-react";
import { SalaryFact } from "@/components/payroll/SalaryFact";
import { BarChart } from "@/components/ui/BarChart";
import { monthLabel } from "@/components/ui/MonthPicker";
import { KpiScoreBlock } from "@/components/people/KpiScoreBlock";
import { PersonIdentity } from "@/components/people/PersonIdentity";
import { SectionCard } from "@/components/ui/SectionCard";
import type { PersonDetail } from "@/lib/api/person";
import { useChartColors } from "@/lib/chart-colors";
import styles from "./PersonKpiPanel.module.scss";

/**
 * Khối điểm KPI của MỘT người: nhận diện · vòng điểm trên chỉ tiêu · chú thích
 * nguồn điểm · biểu đồ 5 tháng.
 *
 * Tách ra vì hai màn cần đúng khối này: hồ sơ nhân viên P-52 (cấp trên xem) và
 * màn Tổng quan của chính nhân viên đó (tự xem). Để nguyên trong trang P-52 thì
 * màn kia phải chép cả JSX lẫn ~90 dòng CSS — AGENTS.md §2.
 */
type Props = {
  person: PersonDetail;
};

const shortMonth = (month: string) => `T${Number(month.slice(5, 7))}`;

/* Khối KPI hiện Ở MỌI KỲ và luôn theo THÁNG HIỆN TẠI (chốt 2026-08-27) — kỳ
   lọc chỉ đổi các danh sách hoạt động, không đổi điểm. */
export function PersonKpiPanel({ person }: Props) {
  const chartColors = useChartColors();

  return (
    <>
      <div className={styles.person}>
        <PersonIdentity person={person} />

        <KpiScoreBlock
          sources={person.pointSources}
          target={person.points.target}
          ariaLabel={`Điểm ${monthLabel(person.summaryMonth)} trên chỉ tiêu`}
          facts={
            <div>
              <dt>Lương</dt>
              <dd>
                <SalaryFact amount={person.salary} breakdown={person.salaryBreakdown} />
              </dd>
            </div>
          }
        />
      </div>

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
          height={160}
          caption="Điểm trong 5 tháng gần nhất"
        />
      </SectionCard>
    </>
  );
}
