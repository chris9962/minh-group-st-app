"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { UserCog, Users } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { SkeletonCard, SkeletonStats, SkeletonTable } from "@/components/ui/Skeleton";
import { Checkbox } from "@/components/ui/Checkbox";
import { Count } from "@/components/ui/Count";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterField } from "@/components/ui/FilterField";
import {
  DEFAULT_PERIOD,
  type Period,
  PeriodPicker,
  periodDates,
  periodKey,
} from "@/components/ui/PeriodPicker";
import { MonthPicker } from "@/components/ui/MonthPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { BankingHeadline } from "@/components/dashboard/BankingHeadline";
import { SocialInsuranceHeadline } from "@/components/socialInsurance/SocialInsuranceHeadline";
import { EMPTY_PAGE } from "@/lib/api/pagination";
import { formatPoints, monthRange } from "@/lib/format";
import { formatCents } from "@/lib/money";
import {
  fetchDepartmentDetail,
  fetchDepartmentSocialInsurance,
  fetchDepartmentSummary,
  type DepartmentSocialInsurance,
} from "@/lib/api/org";
import { fetchDepartmentStaff, SOCIAL_DEPARTMENT_CODE, type StaffRow } from "@/lib/api/staff";
import { personHref } from "@/lib/api/people";
import { scopeFor, visibleDepartmentIds } from "@/lib/permissions";
import { ROLE_LABEL, ROLE_RANK } from "@/lib/types";
import { useSession } from "@/store/session";
import { SalaryAmount } from "@/components/payroll/SalaryAmount";
import { SalaryBreakdownButton } from "@/components/payroll/SalaryBreakdownButton";
import styles from "./page.module.scss";

/**
 * Cùng bộ cột với bảng nhân sự P-51, TRỪ cột Chỉ tiêu.
 *
 * Chỉ tiêu lưu theo tháng ở `kpi_scores`, mà màn này lọc theo kỳ — "chỉ tiêu
 * của ngày 05/08 đến 12/08" không có nghĩa. Bảng phòng ban ở P-91 cũng không có
 * cột đó, và nó dùng đúng bộ chọn kỳ này.
 *
 * Sắp xếp do TRÌNH DUYỆT làm, nên mỗi cột mang `sortBy` hoặc `sortText` chứ
 * không mang `sortable` — xem `fetchDepartmentStaff` cho lý do bỏ phân trang.
 */
const EMPLOYEE_COLUMNS: RankColumn<StaffRow>[] = [
  {
    key: "name",
    label: "Tên",
    sortText: (s) => s.fullName,
    render: (s) => (
      <Link href={personHref(s.id, s.salaryBreakdown.month)} className={styles.nameLink}>
        {s.fullName}
      </Link>
    ),
  },
  {
    key: "role",
    label: "Chức vụ",
    // `ROLE_RANK` chứ không phải chuỗi `role`: số càng cao chức vụ càng cao, nên
    // mũi tên ↓ đẩy Trưởng phòng lên đầu như người đọc trông đợi.
    sortBy: (s) => ROLE_RANK[s.monthRole],
    render: (s) => ROLE_LABEL[s.monthRole],
  },
  {
    key: "active",
    label: "Trạng thái",
    // Trạng thái của THÁNG đang xem: người nghỉ ở tháng sau vẫn là người đang
    // làm của tháng này.
    sortBy: (s) => (s.monthActive ? 1 : 0),
    render: (s) => (
      <StatusTag ok={s.monthActive}>{s.monthActive ? "Đang hoạt động" : "Đã khoá"}</StatusTag>
    ),
  },
  {
    key: "customers",
    label: "Tổng khách",
    sortBy: (s) => s.customers,
    render: (s) => <Count n={s.customers} />,
  },
  {
    key: "customersWithAccounts",
    label: "Khách có TK",
    sortBy: (s) => s.customersWithAccounts,
    render: (s) => <Count n={s.customersWithAccounts} />,
  },
  {
    key: "accounts",
    label: "TK ngân hàng",
    sortBy: (s) => s.accounts,
    render: (s) => <Count n={s.accounts} />,
  },
  {
    key: "services",
    label: "Dịch vụ",
    sortBy: (s) => s.services,
    render: (s) => <Count n={s.services} />,
  },
  {
    key: "rangePoints",
    label: "Điểm",
    // ⚠️ Gom theo NGƯỜI LẬP HỒ SƠ KHÁCH, ba cột đếm bên trái thì đếm theo người
    // TẠO bản ghi (thể lệ câu 7.11). Hai cách lệch nhau ở ca mở hộ tài khoản
    // cho khách của đồng nghiệp, và cột điểm phải khớp bảng lương.
    sortBy: (s) => s.rangePoints ?? 0,
    render: (s) => <span className="tabular-nums">{formatPoints(s.rangePoints ?? 0)}</span>,
  },
  {
    key: "salary",
    label: "Lương",
    align: "right",
    render: (staff) => (
      <span className={styles.salaryCell}>
        <SalaryAmount amount={staff.salary} visible />
        <SalaryBreakdownButton
          iconOnly={{ personName: staff.fullName }}
          amount={staff.salary}
          breakdown={staff.salaryBreakdown}
        />
      </span>
    ),
  },
];

type PersonRevenue = DepartmentSocialInsurance["people"][number];

const columnOf = (key: string) => EMPLOYEE_COLUMNS.find((c) => c.key === key)!;

/** Phòng An Sinh chỉ xem doanh thu BHYT/BHXH: bốn cột khách, tài khoản, dịch vụ đổi thành hồ sơ và doanh thu. */
function socialColumns(revenueOf: (id: string) => PersonRevenue | undefined): RankColumn<StaffRow>[] {
  const records = (kind: "bhyt" | "bhxh", label: string): RankColumn<StaffRow> => ({
    key: `${kind}Records`,
    label,
    sortBy: (s) => revenueOf(s.id)?.[kind].records ?? 0,
    render: (s) => <Count n={revenueOf(s.id)?.[kind].records ?? 0} />,
  });
  const collected = (kind: "bhyt" | "bhxh", label: string): RankColumn<StaffRow> => ({
    key: `${kind}Collected`,
    label,
    sortBy: (s) => revenueOf(s.id)?.[kind].collectedCents ?? 0,
    render: (s) => (
      <span className="tabular-nums">{formatCents(revenueOf(s.id)?.[kind].collectedCents ?? 0)}</span>
    ),
  });
  return [
    columnOf("name"),
    columnOf("role"),
    columnOf("active"),
    records("bhyt", "Hồ sơ BHYT"),
    collected("bhyt", "Doanh thu BHYT"),
    records("bhxh", "Hồ sơ BHXH"),
    collected("bhxh", "Doanh thu BHXH"),
    columnOf("rangePoints"),
    columnOf("salary"),
  ];
}

const startOfDay = (isoDate: string) => new Date(`${isoDate}T00:00:00`);

/** Chi tiết một phòng ban — mở rộng P-91: bấm tên phòng ở bảng đi tới đây. */
export default function DepartmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const user = useSession((s) => s.user);
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);

  const periodRange = periodDates(period);
  // Người quản lý và lương của họ là của THÁNG đang xem.
  const month = periodRange.from.slice(0, 7);
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["org-department", id, month],
    queryFn: () => fetchDepartmentDetail(id, month),
    placeholderData: keepPreviousData,
  });

  // Phòng An Sinh tính điểm, doanh thu, lương theo tháng biên lai, nên luôn đọc trọn tháng.
  const social = data?.department.code === SOCIAL_DEPARTMENT_CODE;
  const { from, to } = social ? monthRange(month) : periodRange;
  const pickMonth = (picked: string) => {
    const range = monthRange(picked);
    setPeriod({ kind: "range", range: { from: startOfDay(range.from), to: startOfDay(range.to) } });
  };

  /**
   * Trọn danh sách nhân viên của phòng, một lượt gọi cho cả kỳ. Trình duyệt tự
   * sắp — xem `fetchDepartmentStaff` cho lý do bỏ phân trang.
   */
  const {
    data: staffData,
    isPending: staffPending,
    isError: staffError,
    refetch: refetchStaff,
    isFetching: staffFetching,
  } = useQuery({
    queryKey: ["staff-by-department", id, from, to],
    queryFn: () => fetchDepartmentStaff(id, { from, to }),
    enabled: Boolean(data),
    placeholderData: keepPreviousData,
  });

  /** Khối số ngân hàng của phòng, cùng hàm đếm và cùng ba thẻ với Tổng quan. */
  const { data: summary } = useQuery({
    queryKey: ["org-department-summary", id, periodKey(period)],
    queryFn: () => fetchDepartmentSummary(id, periodKey(period)),
    enabled: Boolean(data) && !social,
    placeholderData: keepPreviousData,
  });

  const { data: revenue } = useQuery({
    queryKey: ["org-department-social-insurance", id, month],
    queryFn: () => fetchDepartmentSocialInsurance(id, month),
    enabled: social,
    placeholderData: keepPreviousData,
  });
  const revenueById = new Map(revenue?.people.map((p) => [p.userId, p]) ?? []);
  const columns = social ? socialColumns((userId) => revenueById.get(userId)) : EMPLOYEE_COLUMNS;

  const periodLabel =
    period.kind === "today"
      ? "hôm nay"
      : period.kind === "this-month"
        ? "tháng này"
        : "khoảng đã chọn";

  /**
   * Phòng ban mở được rộng hơn danh sách nhân viên của nó.
   *
   * Phó giám đốc đọc sơ đồ tổ chức toàn công ty (`department:view-detail`) nhưng
   * chỉ đọc nhân sự của phòng mình quản, nên mở phòng khác thì máy chủ trả bảng
   * rỗng. Câu "phòng này chưa có nhân viên nào" lúc đó nói sai về phòng đang mở.
   */
  const staffVisible = visibleDepartmentIds(user, scopeFor(user, "staff", "view-detail") ?? "own");
  const staffInScope = staffVisible === null || staffVisible.includes(id);

  const rows = staffData?.page.rows ?? EMPTY_PAGE.rows;

  /**
   * Tài khoản đã khoá ẩn mặc định.
   *
   * Người rời công ty vẫn nằm trong phòng cũ để giữ lịch sử bản ghi, nên bảng
   * phòng lâu năm lẫn nhiều dòng không còn làm việc. Lọc ở TRÌNH DUYỆT được vì
   * `fetchDepartmentStaff` trả trọn danh sách, không phân trang.
   */
  const [showLocked, setShowLocked] = useState(false);
  const lockedCount = rows.filter((s) => !s.monthActive).length;
  const visibleRows = showLocked ? rows : rows.filter((s) => s.monthActive);
  const totals = visibleRows.reduce(
    (sum, staff) => ({
      customers: sum.customers + staff.customers,
      customersWithAccounts: sum.customersWithAccounts + staff.customersWithAccounts,
      accounts: sum.accounts + staff.accounts,
      services: sum.services + staff.services,
      points: sum.points + (staff.rangePoints ?? 0),
      salary: sum.salary + staff.salary,
    }),
    {
      customers: 0,
      customersWithAccounts: 0,
      accounts: 0,
      services: 0,
      points: 0,
      salary: 0,
    },
  );
  const revenueTotals = visibleRows.reduce(
    (sum, staff) => {
      const r = revenueById.get(staff.id);
      return {
        bhytRecords: sum.bhytRecords + (r?.bhyt.records ?? 0),
        bhytCollected: sum.bhytCollected + (r?.bhyt.collectedCents ?? 0),
        bhxhRecords: sum.bhxhRecords + (r?.bhxh.records ?? 0),
        bhxhCollected: sum.bhxhCollected + (r?.bhxh.collectedCents ?? 0),
      };
    },
    { bhytRecords: 0, bhytCollected: 0, bhxhRecords: 0, bhxhCollected: 0 },
  );
  const pointsCell = (
    <span key="points" className="tabular-nums">
      {formatPoints(totals.points)}
    </span>
  );
  const salaryCell = <SalaryAmount key="salary" amount={totals.salary} visible />;
  const summaryRow = social
    ? [
        "Tổng",
        null,
        null,
        <Count key="bhytRecords" n={revenueTotals.bhytRecords} />,
        <span key="bhytCollected" className="tabular-nums">
          {formatCents(revenueTotals.bhytCollected)}
        </span>,
        <Count key="bhxhRecords" n={revenueTotals.bhxhRecords} />,
        <span key="bhxhCollected" className="tabular-nums">
          {formatCents(revenueTotals.bhxhCollected)}
        </span>,
        pointsCell,
        salaryCell,
      ]
    : [
        "Tổng",
        null,
        null,
        <Count key="customers" n={totals.customers} />,
        <Count key="customersWithAccounts" n={totals.customersWithAccounts} />,
        <Count key="accounts" n={totals.accounts} />,
        <Count key="services" n={totals.services} />,
        pointsCell,
        salaryCell,
      ];

  return (
    <>
      <TopBar title={data?.department.name ?? "Phòng ban"}>
        {social ? (
          <MonthPicker value={month} onChange={pickMonth} monthsAhead={1} />
        ) : (
          <>
            <div className={styles.periodInline}>
              <PeriodPicker value={period} onChange={setPeriod} />
            </div>
            <div className={styles.periodCollapsed}>
              <FilterButton
                activeCount={period.kind === "today" ? 0 : 1}
                onClear={() => setPeriod(DEFAULT_PERIOD)}
              >
                <FilterField id="period" label="Kỳ" count={period.kind === "today" ? 0 : 1}>
                  <PeriodPicker value={period} onChange={setPeriod} />
                </FilterField>
              </FilterButton>
            </div>
          </>
        )}
      </TopBar>

      <main className={styles.body}>
        <BackLink href="/departments">Phòng ban</BackLink>

        {isPending && <SkeletonCard lines={4} />}
        {isError && (
          <ErrorState what="phòng ban này" onRetry={refetch} retrying={isFetching} />
        )}

        {data && (
          <>
            {social ? (
              revenue ? (
                <SocialInsuranceHeadline data={revenue} />
              ) : (
                <SkeletonStats count={3} />
              )
            ) : summary ? (
              <BankingHeadline summary={summary} periodLabel={periodLabel} />
            ) : (
              <SkeletonStats count={3} />
            )}

            <SectionCard title="Người quản lý" icon={<UserCog size={17} />}>
              <ul className={styles.managers}>
                {data.managers.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={personHref(m.id, m.salaryBreakdown.month)}
                      className={styles.nameLink}
                    >
                      {m.fullName}
                    </Link>
                    <span className={styles.managerTitle}>{m.title}</span>
                    {!data.managedByDefault && (
                      <span className={styles.managerSalary}>
                        <span>Lương:</span>
                        <SalaryAmount amount={m.salary} visible />
                        <SalaryBreakdownButton
                          amount={m.salary}
                          breakdown={m.salaryBreakdown}
                        />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {data.managedByDefault && (
                <p className={styles.footnote}>
                  Phòng này chưa có Phó Giám Đốc phụ trách — Giám đốc quản trực tiếp.
                </p>
              )}
            </SectionCard>

            <SectionCard
              title="Nhân viên"
              icon={<Users size={17} />}
              meta={
                staffPending
                  ? undefined
                  : staffData?.departmentPoints === null || staffData === undefined
                    ? `${visibleRows.length} người`
                    : `${visibleRows.length} người · ${formatPoints(staffData.departmentPoints)} điểm`
              }
              action={
                lockedCount > 0 ? (
                  <Checkbox
                    checked={showLocked}
                    onCheckedChange={setShowLocked}
                    label={`Hiện ${lockedCount} tài khoản đã khoá`}
                  />
                ) : undefined
              }
            >
              {/* Hỏng hoặc bị kẹp phạm vi thì bảng cũng rỗng, và câu "chưa có
                  nhân viên nào" nói ra một điều KHÔNG đúng về phòng đang mở —
                  sĩ số ngay bên trên thường vẫn khác 0. */}
              {staffError ? (
                <ErrorState
                  what="danh sách nhân viên của phòng"
                  onRetry={refetchStaff}
                  retrying={staffFetching}
                />
              ) : staffPending ? (
                <SkeletonTable rows={5} columns={columns.length} />
              ) : (
                <RankTable
                  rows={visibleRows}
                  columns={columns}
                  rowKey={(s) => s.id}
                  defaultSort="role"
                  caption="Nhân viên của phòng, Trưởng và Phó phòng nằm đầu bảng"
                  summaryRow={visibleRows.length > 0 ? summaryRow : undefined}
                  emptyText={
                    !staffInScope
                      ? "Bạn không xem được danh sách nhân viên của phòng này."
                      : rows.length > 0
                        ? "Phòng này chỉ còn tài khoản đã khoá."
                        : "Phòng này chưa có nhân viên nào."
                  }
                />
              )}
            </SectionCard>
          </>
        )}
      </main>
    </>
  );
}
