"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { ChevronLeft, UserCog, Users } from "lucide-react";
import { SkeletonCard, SkeletonTable } from "@/components/ui/Skeleton";
import { Count } from "@/components/ui/Count";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { FilterButton } from "@/components/ui/FilterButton";
import {
  DEFAULT_PERIOD,
  type Period,
  PeriodPicker,
  periodDates,
} from "@/components/ui/PeriodPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { EMPTY_PAGE, PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { fetchDepartmentDetail } from "@/lib/api/org";
import { fetchStaff, type StaffQuery, type StaffRow, type StaffSort } from "@/lib/api/staff";
import { scopeFor, visibleDepartmentIds } from "@/lib/permissions";
import { ROLE_LABEL } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

/**
 * Cùng bộ cột với bảng nhân sự P-51, TRỪ cột Chỉ tiêu.
 *
 * Chỉ tiêu lưu theo tháng ở `kpi_scores`, mà màn này lọc theo kỳ — "chỉ tiêu
 * của ngày 05/08 đến 12/08" không có nghĩa. Bảng phòng ban ở P-91 cũng không có
 * cột đó, và nó dùng đúng bộ chọn kỳ này.
 *
 * `sortable` chỉ đặt ở cột nào máy chủ sắp được (`STAFF_SORT`). Ba cột đếm nằm
 * ngoài vì máy chủ đếm SAU khi đã cắt trang — xem `countsInRange`.
 */
const EMPLOYEE_COLUMNS: RankColumn<StaffRow>[] = [
  {
    key: "name",
    label: "Tên",
    sortable: true,
    render: (s) => (
      <Link href={`/users/${s.id}`} className={styles.nameLink}>
        {s.fullName}
      </Link>
    ),
  },
  { key: "role", label: "Chức vụ", sortable: true, render: (s) => ROLE_LABEL[s.role] },
  {
    key: "active",
    label: "Trạng thái",
    render: (s) => (
      <StatusTag ok={s.active}>{s.active ? "Đang hoạt động" : "Đã khoá"}</StatusTag>
    ),
  },
  { key: "customers", label: "Khách hàng", render: (s) => <Count n={s.customers} /> },
  { key: "accounts", label: "TK ngân hàng", render: (s) => <Count n={s.accounts} /> },
  { key: "services", label: "Dịch vụ", render: (s) => <Count n={s.services} /> },
  {
    key: "rangePoints",
    label: "Điểm",
    // ⚠️ Gom theo NGƯỜI LẬP HỒ SƠ KHÁCH, ba cột đếm bên trái thì đếm theo người
    // TẠO bản ghi (thể lệ câu 7.11). Hai cách lệch nhau ở ca mở hộ tài khoản
    // cho khách của đồng nghiệp, và cột điểm phải khớp bảng lương.
    render: (s) => <span className="tabular-nums">{s.rangePoints ?? 0}</span>,
  },
];

/** Chi tiết một phòng ban — mở rộng P-91: bấm tên phòng ở bảng đi tới đây. */
export default function DepartmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const user = useSession((s) => s.user);
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<StaffSort>("role");
  const [dir, setDir] = useState<SortDir>("desc");

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["org-department", id],
    queryFn: () => fetchDepartmentDetail(id),
  });

  /**
   * Dùng chung route với bảng nhân sự P-51, chỉ khác ba tham số: khoá theo
   * phòng đang mở, lấy cả người đã khoá, và gửi kỳ cho ba cột đếm.
   *
   * `summaryMonth` để rỗng — máy chủ tự lấy tháng làm việc. Bảng này không có
   * cột Chỉ tiêu nên tháng đó chỉ còn dùng cho luật `createdByEndOf`.
   */
  const { from, to } = periodDates(period);
  const query: StaffQuery = {
    scope: "company",
    departmentId: id,
    search: "",
    summaryMonth: "",
    from,
    to,
    status: "all",
    roles: [],
    page,
    sort,
    dir,
  };

  const {
    data: staffData,
    isPending: staffPending,
    isError: staffError,
    refetch: refetchStaff,
    isFetching: staffFetching,
  } = useQuery({
    queryKey: ["staff-by-department", query],
    queryFn: () => fetchStaff(query),
    enabled: Boolean(data),
    placeholderData: keepPreviousData,
  });

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
  const total = staffData?.page.total ?? 0;

  /** Đổi kỳ thì về trang đầu — giữ trang 3 của kết quả cũ là hiện một khúc rỗng. */
  const refinePeriod = (next: Period) => {
    setPeriod(next);
    setPage(0);
  };

  return (
    <>
      <TopBar title={data?.department.name ?? "Phòng ban"}>
        <div className={styles.periodInline}>
          <PeriodPicker value={period} onChange={refinePeriod} sameMonthOnly />
        </div>
        <div className={styles.periodCollapsed}>
          <FilterButton
            activeCount={period.kind === "today" ? 0 : 1}
            onClear={() => refinePeriod(DEFAULT_PERIOD)}
          >
            <PeriodPicker value={period} onChange={refinePeriod} sameMonthOnly />
          </FilterButton>
        </div>
      </TopBar>

      <main className={styles.body}>
        <Link href="/departments" className={styles.back}>
          <ChevronLeft size={15} aria-hidden />
          Phòng ban
        </Link>

        {isPending && <SkeletonCard lines={4} />}
        {isError && (
          <ErrorState what="phòng ban này" onRetry={refetch} retrying={isFetching} />
        )}

        {data && (
          <>
            <SectionCard title="Người quản lý" icon={<UserCog size={17} />}>
              <ul className={styles.managers}>
                {data.managers.map((m) => (
                  <li key={m.id}>
                    <Link href={`/users/${m.id}`} className={styles.nameLink}>
                      {m.fullName}
                    </Link>
                    <span className={styles.managerTitle}>{m.title}</span>
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
                    ? `${total} người`
                    : `${total} người · ${staffData.departmentPoints} điểm`
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
                <SkeletonTable rows={5} columns={EMPLOYEE_COLUMNS.length} />
              ) : (
                <RankTable
                  rows={rows}
                  columns={EMPLOYEE_COLUMNS}
                  rowKey={(s) => s.id}
                  defaultSort="role"
                  caption="Nhân viên của phòng, Trưởng và Phó phòng nằm đầu bảng"
                  emptyText={
                    staffInScope
                      ? "Phòng này chưa có nhân viên nào."
                      : "Bạn không xem được danh sách nhân viên của phòng này."
                  }
                  server={{
                    sort,
                    dir,
                    page,
                    total,
                    pageSize: PAGE_SIZE,
                    onSortChange: (nextSort, nextDir) => {
                      setSort(nextSort as StaffSort);
                      setDir(nextDir);
                      setPage(0);
                    },
                    onPageChange: setPage,
                  }}
                />
              )}
            </SectionCard>
          </>
        )}
      </main>
    </>
  );
}
