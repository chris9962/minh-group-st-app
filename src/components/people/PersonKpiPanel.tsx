"use client";

import { ChartColumn } from "lucide-react";
import { BarChart } from "@/components/ui/BarChart";
import { monthLabel } from "@/components/ui/MonthPicker";
import { KpiScoreBlock } from "@/components/people/KpiScoreBlock";
import { SectionCard } from "@/components/ui/SectionCard";
import type { PersonDetail } from "@/lib/api/person";
import { sourceColor, useChartColors } from "@/lib/chart-colors";
import { formatPhone, formatPoints } from "@/lib/format";
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

/** Hai chữ cái đầu của tên — ảnh đại diện chưa có, và tên viết tắt đọc nhanh hơn một ô xám. */
const initialsOf = (fullName: string): string => {
  const parts = fullName.trim().split(/\s+/);
  const last = parts.at(-1) ?? "";
  return (parts.length > 1 ? `${parts[0][0]}${last[0]}` : last.slice(0, 2)).toUpperCase();
};

const shortMonth = (month: string) => `T${Number(month.slice(5, 7))}`;

/* Khối KPI hiện Ở MỌI KỲ và luôn theo THÁNG HIỆN TẠI (chốt 2026-08-27) — kỳ
   lọc chỉ đổi các danh sách hoạt động, không đổi điểm. */
export function PersonKpiPanel({ person }: Props) {
  const chartColors = useChartColors();

  return (
    <>
      <div className={styles.person}>
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden>
            {initialsOf(person.fullName)}
          </span>
          <div>
            <strong className={styles.name}>{person.fullName}</strong>
            {/* Mã nhân viên là thứ dùng để đối chiếu với app khác, nên đứng cạnh
                số điện thoại ở dòng nhận diện. Tên đăng nhập thì không. */}
            <span className={`${styles.sub} tabular-nums`}>
              {[person.staffCode, formatPhone(person.phone)].filter(Boolean).join(" · ")}
            </span>
            {/* Ban giám đốc không thuộc phòng nào nên chuỗi phòng rỗng — nối
                cứng dấu · sẽ để lại một dấu chấm mồ côi đầu dòng. */}
            <span className={styles.sub}>
              {[person.departmentName, `vào từ ${monthLabel(person.joinedMonth)}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </div>

        <KpiScoreBlock
          sources={person.pointSources}
          target={person.points.target}
          ariaLabel={`Điểm ${monthLabel(person.summaryMonth)} trên chỉ tiêu`}
          facts={
            <>
              {/* Hai con số thay cho một câu văn: người xem chỉ cần biết còn
                  cách chỉ tiêu bao xa và còn bao nhiêu ngày. */}
              <div>
                <dt>{person.points.total >= person.points.target ? "Vượt" : "Còn thiếu"}</dt>
                <dd className="tabular-nums">
                  {formatPoints(Math.abs(person.points.target - person.points.total))} điểm
                </dd>
              </div>
              {person.daysLeft > 0 && (
                <div>
                  <dt>Còn lại</dt>
                  <dd className="tabular-nums">{person.daysLeft} ngày</dd>
                </div>
              )}
            </>
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
