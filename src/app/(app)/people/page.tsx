"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Pencil, Plus, Users } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { monthLabel, thisMonth } from "@/components/ui/MonthPicker";
import { PeoplePeriodPicker } from "@/components/ui/PeoplePeriodPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { ScopeSwitcher } from "@/components/ui/ScopeSwitcher";
import { Select } from "@/components/ui/Select";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  fetchPeople,
  isOnTarget,
  periodMonth,
  periodParam,
  pointsGap,
  showsKpi,
  totalPoints,
  type PeriodMode,
  type PersonScore,
} from "@/lib/api/people";
import { fetchDepartments } from "@/lib/api/departments";
import { fetchStaff, type StaffAccount } from "@/lib/api/staff";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { Checkbox } from "@/components/ui/Checkbox";
import { SearchField } from "@/components/ui/SearchField";
import { StaffFormDialog } from "@/components/staff/StaffFormDialog";
import { useDebouncedValue } from "@/lib/hooks";
import { availableScopes, can } from "@/lib/permissions";
import { ROLE_LABEL, RoleKey, type Scope } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const BASE_COLUMNS: RankColumn<PersonScore>[] = [
  {
    key: "fullName",
    label: "Nhân viên",
    render: (p) => (
      <Link href={`/people/${p.id}`} className={styles.nameLink}>
        {p.fullName}
      </Link>
    ),
  },
  { key: "departmentName", label: "Đơn vị", render: (p) => p.departmentName },
  {
    key: "accounts",
    label: "Tài khoản",
    align: "right",
    sortBy: (p) => p.accounts,
    render: (p) => p.accounts,
  },
  {
    key: "apps",
    label: "App",
    align: "right",
    sortBy: (p) => p.apps,
    render: (p) => p.apps,
  },
  {
    key: "insuranceOrders",
    label: "Đơn BH",
    align: "right",
    sortBy: (p) => p.insuranceOrders,
    render: (p) => p.insuranceOrders,
  },
];

/** Chỉ hiện khi xem theo tháng — điểm một ngày không so được với chỉ tiêu tháng. */
const KPI_COLUMNS: RankColumn<PersonScore>[] = [
  {
    key: "points",
    label: "Điểm tháng",
    align: "right",
    sortBy: totalPoints,
    render: (p) => totalPoints(p),
  },
  {
    key: "status",
    label: "Trạng thái",
    sortBy: pointsGap,
    render: (p) => {
      const gap = pointsGap(p);
      return (
        <StatusTag ok={isOnTarget(p)}>
          {isOnTarget(p) ? `Đã đạt · vượt ${gap}` : `Chưa đạt · còn ${-gap}`}
        </StatusTag>
      );
    },
  },
];

/**
 * Hàng của bảng khi người xem quản trị được tài khoản.
 *
 * Nguồn là DANH SÁCH TÀI KHOẢN chứ không phải danh sách có điểm, nên gồm cả kế
 * toán và quản trị hệ thống. Người không thuộc diện tính điểm để trống cột điểm
 * — 0 điểm nghĩa là có chỉ tiêu mà chưa làm được gì, khác hẳn "không có chỉ tiêu".
 */
type StaffRow = StaffAccount & { score: PersonScore | null };

/**
 * Cột thêm cho người quản trị tài khoản. Cố ý KHÔNG tách thành một bảng riêng:
 * hai bảng cho cùng một danh sách người là chỗ dễ lạc nhất — đổi qua lại thì
 * bộ lọc, số tóm tắt và cả nghĩa của chữ "trạng thái" đều đổi theo.
 */
const ACCOUNT_COLUMNS: RankColumn<StaffRow>[] = [
  {
    key: "fullName",
    label: "Nhân viên",
    render: (r) => (
      <Link href={`/people/${r.id}`} className={styles.nameLink}>
        {r.fullName}
      </Link>
    ),
  },
  { key: "departmentName", label: "Đơn vị", render: (r) => r.departmentName || "—" },
  { key: "role", label: "Chức vụ", render: (r) => ROLE_LABEL[r.role] },
  {
    key: "points",
    label: "Điểm tháng",
    align: "right",
    // -1 để người không có chỉ tiêu nằm cuối chứ không lẫn với người 0 điểm.
    sortBy: (r) => (r.score ? totalPoints(r.score) : -1),
    render: (r) => (r.score ? totalPoints(r.score) : "—"),
  },
  {
    key: "kpi",
    label: "Chỉ tiêu",
    sortBy: (r) => (r.score ? pointsGap(r.score) : -999),
    render: (r) =>
      r.score ? (
        <StatusTag ok={isOnTarget(r.score)}>
          {isOnTarget(r.score)
            ? `Đã đạt · vượt ${pointsGap(r.score)}`
            : `Chưa đạt · còn ${-pointsGap(r.score)}`}
        </StatusTag>
      ) : (
        "—"
      ),
  },
];

const ROLE_FILTERS = RoleKey.options.map((value) => ({
  value,
  label: ROLE_LABEL[value],
}));

/** P-51 · Danh sách nhân viên + điểm + quản trị tài khoản. */
export default function PeoplePage() {
  const user = useSession((s) => s.user);
  const scopes = availableScopes(user, "banking", "view-stats");
  const [scope, setScope] = useState<Scope>(scopes.at(-1) ?? "own");
  const [period, setPeriod] = useState<PeriodMode>({ kind: "this-month" });
  const [departmentId, setDepartmentId] = useState("");
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  // Mặc định KHÔNG chọn gì = lấy hết. Giữ mảng rỗng thay vì nhồi sẵn cả 6 mục
  // để "chưa lọc" và "lọc đúng 6 mục" không lẫn vào nhau ở tầng gọi API.
  const [roles, setRoles] = useState<RoleKey[]>([]);
  const [editing, setEditing] = useState<StaffAccount | null>(null);
  const [creating, setCreating] = useState(false);

  const canManage = can(user, "system", "manage-users");

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    staleTime: Infinity,
  });

  const current = thisMonth();
  const summaryMonth = periodMonth(period, current);
  const param = periodParam(period, current);

  const { data, isPending, isError } = useQuery({
    queryKey: ["people", scope, param, summaryMonth, departmentId, searchQuery],
    queryFn: () =>
      fetchPeople({
        scope,
        period: param,
        summaryMonth,
        departmentId,
        search: searchQuery,
      }),
    // Giữ bảng cũ trong lúc gõ tiếp — không thì mỗi lần đổi từ khoá bảng lại
    // biến mất rồi hiện lại, nhìn giật.
    placeholderData: (previous) => previous,
  });

  // Danh sách tài khoản chỉ tải khi có quyền — không thì gọi API vô nghĩa.
  const { data: staffData } = useQuery({
    queryKey: ["staff", scope, departmentId, searchQuery, roles],
    // Chỉ người đang làm. Người đã khoá xem trong hồ sơ của họ, không lẫn vào
    // danh sách hằng ngày.
    queryFn: () =>
      fetchStaff({
        scope,
        departmentId,
        search: searchQuery,
        status: "active",
        roles,
      }),
    enabled: canManage,
    placeholderData: (previous) => previous,
  });

  const people = data?.people ?? [];
  const scoreById = new Map(people.map((p) => [p.id, p]));
  const staffRows: StaffRow[] = (staffData?.staff ?? []).map((s) => ({
    ...s,
    score: scoreById.get(s.id) ?? null,
  }));

  // Nút chỉ có icon nên `aria-label` phải kèm tên người: giữa mười dòng giống
  // nhau, "Sửa" một mình không nói đang sửa ai.
  const accountColumns = useMemo<RankColumn<StaffRow>[]>(
    () => [
      ...ACCOUNT_COLUMNS,
      {
        key: "actions",
        label: "Thao tác",
        align: "right",
        render: (r) => (
          <Button
            variant="secondary"
            icon
            aria-label={`Sửa ${r.fullName}`}
            onClick={() => setEditing(r)}
          >
            <Pencil size={16} aria-hidden />
          </Button>
        ),
      },
    ],
    [],
  );

  const withKpi = showsKpi(period);
  const columns = withKpi
    ? [...BASE_COLUMNS.slice(0, 2), ...KPI_COLUMNS.slice(0, 1), ...BASE_COLUMNS.slice(2), KPI_COLUMNS[1]]
    : BASE_COLUMNS;
  const periodText = period.kind === "today" ? "Hôm nay" : monthLabel(summaryMonth);

  return (
    <>
      <TopBar title="Nhân sự & KPI">
        <SearchField
          label="Tìm nhân viên"
          placeholder="Tìm tên nhân viên, đơn vị…"
          value={search}
          onChange={setSearch}
        />
        <ScopeSwitcher options={scopes} value={scope} onChange={setScope} />
        <PeoplePeriodPicker value={period} onChange={setPeriod} />
        <FilterButton
          activeCount={(departmentId ? 1 : 0) + (roles.length > 0 ? 1 : 0)}
          onClear={() => {
            setDepartmentId("");
            setRoles([]);
          }}
        >
          <Select
            label="Đơn vị"
            value={departmentId}
            onChange={setDepartmentId}
            options={[
              { value: "", label: "Tất cả đơn vị" },
              ...departments.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />

          <fieldset className={styles.roleSet}>
            <legend className={styles.roleLegend}>Chức vụ</legend>
            {ROLE_FILTERS.map((r) => (
              <Checkbox
                key={r.value}
                label={r.label}
                // Rỗng = lấy hết, nên lúc chưa lọc thì tích sẵn mọi ô: người
                // dùng thấy "tất cả" chứ không thấy "chưa chọn gì".
                checked={roles.length === 0 || roles.includes(r.value)}
                onCheckedChange={(on) => {
                  const current =
                    roles.length === 0 ? ROLE_FILTERS.map((x) => x.value) : roles;
                  const next = on
                    ? [...current, r.value]
                    : current.filter((x) => x !== r.value);
                  // Bỏ tích hết cũng coi như lấy hết — bảng trống trơn thì
                  // người dùng tưởng mất dữ liệu.
                  setRoles(next.length === ROLE_FILTERS.length ? [] : next);
                }}
              />
            ))}
          </fieldset>
        </FilterButton>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            Thêm nhân viên
          </Button>
        )}
      </TopBar>

      <main className={styles.body}>
        {canManage && (
          <FilterChips
            chips={[
              ...(departmentId
                ? [
                    {
                      label: `Đơn vị: ${departments.find((d) => d.id === departmentId)?.name ?? departmentId}`,
                      onRemove: () => setDepartmentId(""),
                    },
                  ]
                : []),
              ...(roles.length > 0
                ? [
                    {
                      label: `Chức vụ: ${roles
                        .map(
                          (r) =>
                            ROLE_FILTERS.find((x) => x.value === r)?.label ?? r,
                        )
                        .join(", ")}`,
                      onRemove: () => setRoles([]),
                    },
                  ]
                : []),
            ]}
          />
        )}

        {isPending && <p className="text-muted">Đang tải danh sách…</p>}
        {isError && <p className="text-muted">Không tải được danh sách nhân viên.</p>}

        {data && (
          <>
            <div className={styles.stats}>
              <StatCard
                value={
                  canManage && staffData
                    ? staffData.summary.active + staffData.summary.locked
                    : data.summary.headcount
                }
                label="nhân viên"
              />
              <StatCard value={data.summary.onTarget} label="đã đạt chỉ tiêu" />
              <StatCard
                value={data.summary.offTarget}
                label="chưa đạt"
                tone={data.summary.offTarget > 0 ? "attention" : "normal"}
                detail={data.daysLeft > 0 ? `còn ${data.daysLeft} ngày` : undefined}
              />
            </div>

            <SectionCard
              title="Nhân viên"
              icon={<Users size={17} />}
              meta={
                searchQuery
                  ? `${periodText} · khớp ${people.length}/${data.summary.headcount}`
                  : periodText
              }
            >
              {people.length === 0 && (
                <p className="text-muted">
                  {searchQuery
                    ? `Không tìm thấy nhân viên nào khớp “${searchQuery}”.`
                    : "Không có nhân viên nào trong đơn vị đang lọc."}
                </p>
              )}
              {canManage ? (
                <RankTable
                  rows={staffRows}
                  columns={accountColumns}
                  rowKey={(r) => r.id}
                  defaultSort="points"
                  pageSize={10}
                  caption={`Nhân viên, tài khoản và số liệu ${periodText}`}
                />
              ) : (
                <RankTable
                  key={withKpi ? "kpi" : "daily"}
                  rows={people}
                  columns={columns}
                  rowKey={(p) => p.id}
                  defaultSort={withKpi ? "points" : "accounts"}
                  pageSize={10}
                  caption={`Nhân viên và số liệu ${periodText}`}
                />
              )}
              {searchQuery && (
                <p className={styles.footnote}>
                  Bốn số tóm tắt phía trên không đổi theo ô tìm kiếm — chúng là
                  của cả {departmentId ? "đơn vị đang lọc" : "phạm vi đang xem"},
                  còn ô tìm kiếm chỉ lọc bảng.
                </p>
              )}
              {canManage && (
                <p className={styles.footnote}>
                  Danh sách gồm <strong>cả người không có chỉ tiêu</strong> — kế
                  toán, quản trị hệ thống. Cột điểm để trống chứ không để 0: 0
                  điểm nghĩa là có chỉ tiêu mà chưa làm được gì. Bấm tên để mở hồ
                  sơ, bấm bút chì để sửa tài khoản ngay tại bảng.
                </p>
              )}
              <p className={styles.footnote}>
                {withKpi ? (
                  <>
                    Điểm gồm <strong>ngân hàng</strong> (hệ số app đã cài) cộng{" "}
                    <strong>dịch vụ</strong> (hệ số theo loại). Chỉ tiêu hiện tại là{" "}
                    <span className="tabular-nums">100</span> điểm mỗi tháng.
                  </>
                ) : (
                  <>
                    Xem theo ngày nên không có cột điểm và trạng thái — chỉ tiêu tính
                    theo tháng, điểm của một ngày không so với chỉ tiêu nào được. Bốn
                    số tóm tắt phía trên vẫn là của {monthLabel(summaryMonth)}.
                  </>
                )}
              </p>
            </SectionCard>
          </>
        )}

        {(creating || editing) && (
          <StaffFormDialog
            open
            staff={editing}
            departments={departments}
            onClose={() => {
              setCreating(false);
              setEditing(null);
            }}
          />
        )}
      </main>
    </>
  );
}
