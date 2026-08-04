"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Pencil, Plus, Users } from "lucide-react";
import { SkeletonStats, SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { monthLabel, thisMonth } from "@/components/ui/MonthPicker";
import { PeoplePeriodPicker } from "@/components/ui/PeoplePeriodPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { Select } from "@/components/ui/Select";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { KpiRing } from "@/components/ui/KpiRing";
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

/**
 * Ô tên nhân viên: tên ở trên, mã nhân viên ở dưới.
 *
 * Mã là thứ dùng đối chiếu với app khác, nên phải thấy ngay ở bảng chứ không
 * bắt mở từng hồ sơ. Xếp dọc chứ không nối bằng dấu · để tên vẫn là dòng bấm
 * được và mắt không phải lọc chữ ra khỏi mã.
 */
function StaffName({ id, fullName, staffCode }: { id: string; fullName: string; staffCode: string | null }) {
  return (
    <Link href={`/users/${id}`} className={styles.nameCell}>
      <span className={styles.nameText}>{fullName}</span>
      {staffCode && <span className={`${styles.nameCode} tabular-nums`}>{staffCode}</span>}
    </Link>
  );
}

const BASE_COLUMNS: RankColumn<PersonScore>[] = [
  {
    key: "fullName",
    label: "Nhân viên",
    render: (p) => <StaffName id={p.id} fullName={p.fullName} staffCode={p.staffCode} />,
  },
  { key: "departmentName", label: "Đơn vị", render: (p) => p.departmentName },
  {
    key: "accounts",
    label: "Tài khoản",
    sortBy: (p) => p.accounts,
    render: (p) => p.accounts,
  },
  {
    key: "apps",
    label: "App",
    sortBy: (p) => p.apps,
    render: (p) => p.apps,
  },
  {
    key: "insuranceOrders",
    label: "Đơn BH",
    sortBy: (p) => p.insuranceOrders,
    render: (p) => p.insuranceOrders,
  },
];

/**
 * Ô chỉ tiêu: vòng tiến độ + chênh lệch, rê chuột ra câu đầy đủ.
 *
 * Cả cột nhìn một lượt là thấy ngay ai gần chỉ tiêu (vòng xanh, gần đầy) và ai
 * còn xa (vòng cam, hở nhiều) — nhanh hơn hẳn đọc từng dòng "Chưa đạt · còn 100".
 */
function KpiGap({ score }: { score: PersonScore }) {
  const total = totalPoints(score);
  const gap = pointsGap(score);
  const detail = isOnTarget(score)
    ? `Đã đạt chỉ tiêu: ${total}/${score.target} điểm, vượt ${gap}.`
    : `Chưa đạt: ${total}/${score.target} điểm, còn thiếu ${-gap}.`;
  return <KpiRing value={total} target={score.target} detail={detail} />;
}

/** Chỉ hiện khi xem theo tháng — điểm một ngày không so được với chỉ tiêu tháng. */
const KPI_COLUMNS: RankColumn<PersonScore>[] = [
  {
    key: "status",
    label: "Chỉ tiêu",
    // Sắp theo TỈ LỆ đạt, không theo hiệu số: mốc mỗi phòng có thể khác nhau
    // nên "còn thiếu 10" của người mốc 50 nặng hơn của người mốc 200.
    sortBy: (p) => (p.target > 0 ? totalPoints(p) / p.target : 0),
    render: (p) => <KpiGap score={p} />,
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
    render: (r) => <StaffName id={r.id} fullName={r.fullName} staffCode={r.staffCode} />,
  },
  { key: "departmentName", label: "Đơn vị", render: (r) => r.departmentName || "—" },
  { key: "role", label: "Chức vụ", render: (r) => ROLE_LABEL[r.role] },
  {
    key: "kpi",
    label: "Chỉ tiêu",
    // -1 để người không thuộc diện tính điểm nằm cuối, không lẫn với người 0%.
    sortBy: (r) => (r.score && r.score.target > 0 ? totalPoints(r.score) / r.score.target : -1),
    render: (r) => (r.score ? <KpiGap score={r.score} /> : "—"),
  },
];

const ROLE_FILTERS = RoleKey.options.map((value) => ({
  value,
  label: ROLE_LABEL[value],
}));

/** P-51 · Danh sách nhân viên + điểm + quản trị tài khoản. */
export default function PeoplePage() {
  const user = useSession((s) => s.user);
  // Phạm vi phải hỏi theo ĐÚNG module đang liệt kê. Trước đây hỏi theo
  // `banking`: tài khoản quản trị không có `banking:view-summary` nên rơi về
  // `own`, mà `own` lại là "phòng của tôi" — quản trị không thuộc phòng nào nên
  // bảng trống trơn dù họ có quyền xem toàn công ty.
  //
  // Và đúng HÀNH ĐỘNG máy chủ dùng để kẹp: `staffFor` kẹp theo `view-detail`.
  // Hỏi `view-summary` thì thanh lọc hiện "Toàn công ty" trong khi máy chủ
  // đang thu về phòng mình quản, mà không chỗ nào nói ra điều đó.
  const scopes = availableScopes(user, "staff", "view-detail");
  const scope: Scope = scopes.at(-1) ?? "own";
  const [period, setPeriod] = useState<PeriodMode>({ kind: "this-month" });
  const [departmentId, setDepartmentId] = useState("");
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  // Mặc định KHÔNG chọn gì = lấy hết. Giữ mảng rỗng thay vì nhồi sẵn cả 6 mục
  // để "chưa lọc" và "lọc đúng 6 mục" không lẫn vào nhau ở tầng gọi API.
  const [roles, setRoles] = useState<RoleKey[]>([]);
  const [editing, setEditing] = useState<StaffAccount | null>(null);
  const [creating, setCreating] = useState(false);

  const canManage = can(user, "staff", "create") || can(user, "staff", "update");

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    staleTime: Infinity,
  });

  const current = thisMonth();
  const summaryMonth = periodMonth(period, current);
  const param = periodParam(period, current);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
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
  const {
    data: staffData,
    isError: staffError,
    refetch: refetchStaff,
    isFetching: staffFetching,
  } = useQuery({
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
    [setEditing],
  );

  const withKpi = showsKpi(period);
  const columns = withKpi
    ? [...BASE_COLUMNS.slice(0, 2), ...KPI_COLUMNS, ...BASE_COLUMNS.slice(2)]
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
        <FilterButton
          activeCount={(departmentId ? 1 : 0) + (roles.length > 0 ? 1 : 0)}
          onClear={() => {
            setDepartmentId("");
            setRoles([]);
          }}
        >
          <PeoplePeriodPicker value={period} onChange={setPeriod} />
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
          <Button aria-label="Thêm nhân viên" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden />
            <span className={buttonStyles.label}>Thêm nhân viên</span>
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

        {isPending && (
          <>
            <SkeletonStats count={3} />
            <SkeletonTable rows={8} columns={6} />
          </>
        )}
        {isError && (
          <ErrorState what="danh sách nhân viên" onRetry={refetch} retrying={isFetching} />
        )}

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
              {/* `canManage` là create||update, còn /api/staff đòi view-detail —
                  hai vế khác nhau, nên query này 403 được trong khi bảng vẫn
                  dựng. Không có nhánh lỗi thì ra bảng RỖNG, không skeleton
                  không báo lỗi, đọc ra như "phòng không còn ai". */}
              {canManage && staffError ? (
                <ErrorState
                  what="danh sách tài khoản nhân viên"
                  onRetry={refetchStaff}
                  retrying={staffFetching}
                />
              ) : canManage ? (
                <RankTable
                  rows={staffRows}
                  columns={accountColumns}
                  rowKey={(r) => r.id}
                  defaultSort="kpi"
                  pageSize={10}
                  caption={`Nhân viên, tài khoản và số liệu ${periodText}`}
                />
              ) : (
                <RankTable
                  key={withKpi ? "kpi" : "daily"}
                  rows={people}
                  columns={columns}
                  rowKey={(p) => p.id}
                  defaultSort={withKpi ? "status" : "accounts"}
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
              {!withKpi && (
                <p className={styles.footnote}>
                  Xem theo ngày nên không có cột điểm và trạng thái — chỉ tiêu tính
                  theo tháng, điểm của một ngày không so với chỉ tiêu nào được. Bốn
                  số tóm tắt phía trên vẫn là của {monthLabel(summaryMonth)}.
                </p>
              )}
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
