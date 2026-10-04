import { BarChart3 } from "lucide-react";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import type { DepartmentSocialInsurance, SocialInsuranceRevenue } from "@/lib/api/org";
import { KIND_LABEL, PLAN_LABEL } from "@/lib/api/socialInsurance";
import { formatCount, formatPoints } from "@/lib/format";
import { formatCents } from "@/lib/money";
import styles from "./SocialInsuranceHeadline.module.css";

type Group = DepartmentSocialInsurance["groups"][number];

const sum = (rows: SocialInsuranceRevenue[]) =>
  rows.reduce(
    (total, r) => ({
      records: total.records + r.records,
      collectedCents: total.collectedCents + r.collectedCents,
      points: total.points + r.points,
    }),
    { records: 0, collectedCents: 0, points: 0 },
  );

const GROUP_COLUMNS: RankColumn<Group>[] = [
  { key: "kind", label: "Loại", render: (g) => KIND_LABEL[g.kind] },
  { key: "plan", label: "Phương án", render: (g) => PLAN_LABEL[g.plan] },
  { key: "records", label: "Hồ sơ", sortBy: (g) => g.records, render: (g) => formatCount(g.records) },
  {
    key: "collected",
    label: "Doanh thu",
    sortBy: (g) => g.collectedCents,
    render: (g) => <span className="tabular-nums">{formatCents(g.collectedCents)}</span>,
  },
  {
    key: "points",
    label: "Điểm",
    sortBy: (g) => g.points,
    render: (g) => <span className="tabular-nums">{formatPoints(g.points)}</span>,
  },
];

/** Đầu trang chi tiết Phòng An Sinh: doanh thu theo tháng biên lai, thay khối số ngân hàng. */
export function SocialInsuranceHeadline({ data }: { data: DepartmentSocialInsurance }) {
  const all = sum(data.groups);
  const bhyt = sum(data.groups.filter((g) => g.kind === "bhyt"));
  const bhxh = sum(data.groups.filter((g) => g.kind === "bhxh"));

  return (
    <>
      <div className={styles.cards}>
        <StatCard value={formatCents(all.collectedCents)} label="Doanh thu" detail={`${formatCount(all.records)} hồ sơ`} />
        <StatCard value={formatCents(bhyt.collectedCents)} label="Doanh thu BHYT" detail={`${formatCount(bhyt.records)} hồ sơ`} />
        <StatCard value={formatCents(bhxh.collectedCents)} label="Doanh thu BHXH" detail={`${formatCount(bhxh.records)} hồ sơ`} />
      </div>

      <SectionCard title="Doanh thu theo loại" icon={<BarChart3 size={17} />}>
        <RankTable
          rows={data.groups}
          columns={GROUP_COLUMNS}
          rowKey={(g) => `${g.kind}-${g.plan}`}
          defaultSort="kind"
          caption="Doanh thu BHYT, BHXH của phòng theo phương án"
          summaryRow={[
            "Tổng",
            null,
            formatCount(all.records),
            <span key="collected" className="tabular-nums">
              {formatCents(all.collectedCents)}
            </span>,
            <span key="points" className="tabular-nums">
              {formatPoints(all.points)}
            </span>,
          ]}
        />
      </SectionCard>
    </>
  );
}
