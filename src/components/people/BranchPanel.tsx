"use client";

import { Building2 } from "lucide-react";
import Link from "next/link";
import { SalaryFact } from "@/components/payroll/SalaryFact";
import { PersonIdentity } from "@/components/people/PersonIdentity";
import { monthLabel } from "@/components/ui/MonthPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import type { BranchDepartment, PersonDetail } from "@/lib/api/person";
import { formatCount, formatPoints, formatVnd } from "@/lib/format";
import styles from "./BranchPanel.module.scss";

/**
 * Hồ sơ P-52 của Phó giám đốc: các phòng họ quản thay cho vòng điểm cá nhân.
 *
 * Phó giám đốc không lập hồ sơ khách nên vòng điểm, biểu đồ 5 tháng và bốn tab
 * hoạt động của họ luôn trống. Giám đốc mở hồ sơ này để xem nhánh, nên số của
 * nhánh đứng đầu: hàng thẻ tổng rồi bảng từng phòng, cùng bốn cột với bảng xếp
 * hạng phòng ở Tổng quan (chốt 2026-09-22).
 */
type Props = {
  person: PersonDetail;
  branch: NonNullable<PersonDetail["branch"]>;
  /** "Hôm nay" hoặc tên tháng, để nhãn thẻ nói rõ số theo kỳ nào. */
  periodText: string;
};

const columns: RankColumn<BranchDepartment>[] = [
  {
    key: "name",
    label: "Phòng",
    sortText: (d) => d.name,
    render: (d) => (
      <Link href={`/departments/${d.id}`} className={styles.nameLink}>
        {d.name}
      </Link>
    ),
  },
  { key: "staffCount", label: "Nhân viên", sortBy: (d) => d.staffCount, render: (d) => formatCount(d.staffCount) },
  { key: "accountsOpened", label: "TK mở", sortBy: (d) => d.accountsOpened, render: (d) => formatCount(d.accountsOpened) },
  { key: "appsInstalled", label: "App cài", sortBy: (d) => d.appsInstalled, render: (d) => formatCount(d.appsInstalled) },
  {
    key: "installPercent",
    label: "Tỉ lệ cài",
    sortBy: (d) => d.installPercent,
    ratio: (d) => d.installPercent / 100,
    title: (d) =>
      d.accountsOpened === 0
        ? "Chưa mở tài khoản"
        : `${d.installPercent}% · ${formatCount(d.appsInstalled)} app trên ${formatCount(d.accountsOpened)} tài khoản`,
    render: (d) => `${d.installPercent}%`,
  },
  { key: "points", label: "Điểm", sortBy: (d) => d.points, render: (d) => formatPoints(d.points) },
  { key: "salary", label: "Lương tạm tính", sortBy: (d) => d.salary, render: (d) => formatVnd(d.salary) },
];

export function BranchPanel({ person, branch, periodText }: Props) {
  const { totals } = branch;
  const salaryLabel = `lương tạm tính ${monthLabel(branch.salaryMonth)}`;

  return (
    <div className={styles.wrap}>
      <div className={styles.person}>
        <PersonIdentity person={person} />
        <dl className={styles.facts}>
          <div>
            <dt>Lương</dt>
            <dd>
              <SalaryFact amount={person.salary} breakdown={person.salaryBreakdown} />
            </dd>
          </div>
          <div>
            <dt>Phòng phụ trách</dt>
            <dd>{branch.departments.map((d) => d.name).join(", ") || "Chưa được giao"}</dd>
          </div>
        </dl>
      </div>

      <div className={styles.statRow}>
        <StatCard value={formatCount(totals.staffCount)} label="nhân viên các phòng phụ trách" />
        <StatCard value={formatCount(totals.accountsOpened)} label={`tài khoản mở ${periodText}`} />
        <StatCard
          value={formatCount(totals.appsInstalled)}
          label={`app đã cài ${periodText}`}
          detail={totals.accountsOpened > 0 ? `${totals.installPercent}% tài khoản` : undefined}
        />
        <StatCard value={formatPoints(totals.points)} label={`điểm tổng nhánh ${periodText}`} />
        <StatCard value={formatVnd(totals.salary)} label={salaryLabel} />
      </div>

      <SectionCard title="Theo phòng" icon={<Building2 size={17} />} meta={periodText}>
        <RankTable
          rows={branch.departments}
          columns={columns}
          rowKey={(d) => d.id}
          defaultSort="accountsOpened"
          caption="Từng phòng Phó giám đốc phụ trách: nhân viên, tài khoản mở, app đã cài, tỉ lệ cài app, điểm và lương tạm tính"
          emptyText="Chưa được giao phòng nào"
          summaryRow={
            branch.departments.length > 0
              ? [
                  "Tổng",
                  formatCount(totals.staffCount),
                  formatCount(totals.accountsOpened),
                  formatCount(totals.appsInstalled),
                  `${totals.installPercent}%`,
                  formatPoints(totals.points),
                  formatVnd(totals.salary),
                ]
              : undefined
          }
        />
      </SectionCard>
    </div>
  );
}
