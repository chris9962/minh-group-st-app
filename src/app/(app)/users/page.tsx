"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Pencil, Plus, Users } from "lucide-react";
import { SkeletonStats, SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { MonthPicker, monthLabel, thisMonth } from "@/components/ui/MonthPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { Select } from "@/components/ui/Select";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { KpiRing } from "@/components/ui/KpiRing";
import { formatPoints } from "@/lib/format";
import { fetchDepartments } from "@/lib/api/departments";
import {
  fetchStaff,
  isOnTarget,
  pointsGap,
  type StaffAccount,
  type StaffQuery,
  type StaffRow,
  type StaffSort,
} from "@/lib/api/staff";
import { EMPTY_PAGE, PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
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

/**
 * Ô đơn vị: bấm sang trang phòng ban đó.
 *
 * Chỉ người có `manage-org` mới thấy link — API chi tiết phòng chặn ở đúng
 * quyền đó, nên link cho người khác chỉ dẫn tới một màn báo lỗi.
 */
function DepartmentCell({ id, name }: { id: string | null; name: string }) {
  const user = useSession((s) => s.user);
  if (!id || !name) return <>{name || "—"}</>;
  if (!can(user, "system", "manage-org")) return <>{name}</>;
  return (
    <Link href={`/departments/${id}`} className={styles.nameLink}>
      {name}
    </Link>
  );
}

/**
 * Ô chỉ tiêu: vòng tiến độ + chênh lệch, rê chuột ra câu đầy đủ.
 *
 * Cả cột nhìn một lượt là thấy ngay ai gần chỉ tiêu (vòng xanh, gần đầy) và ai
 * còn xa (vòng cam, hở nhiều) — nhanh hơn hẳn đọc từng dòng "Chưa đạt · còn 100".
 */
function KpiGap({ row }: { row: StaffRow }) {
  const gap = pointsGap(row);
  const detail = isOnTarget(row)
    ? `Đã đạt chỉ tiêu: ${formatPoints(row.points)}/${row.target} điểm, vượt ${formatPoints(gap)}.`
    : `Chưa đạt: ${formatPoints(row.points)}/${row.target} điểm, còn thiếu ${formatPoints(-gap)}.`;
  return <KpiRing value={row.points} target={row.target} detail={detail} />;
}

/**
 * MỘT bộ cột cho mọi người có quyền xem nhân sự.
 *
 * Trước đây màn này có hai bảng khác nhau tuỳ quyền, và bảng của người quản trị
 * thiếu hẳn ba cột đếm mà máy chủ vẫn đi gộp cả kho tài khoản để tính. Một bảng
 * thì không còn chỗ cho kiểu lãng phí đó.
 *
 * `sortable` chỉ đặt ở cột nào máy chủ sắp được (`STAFF_SORT`) — khoá sắp đi
 * thẳng vào `ORDER BY`, cột nào không có trong danh sách trắng thì bấm cũng
 * không đổi gì mà người dùng lại tưởng bảng hỏng.
 */
const BASE_COLUMNS: RankColumn<StaffRow>[] = [
  {
    key: "name",
    label: "Nhân viên",
    sortable: true,
    render: (r) => <StaffName id={r.id} fullName={r.fullName} staffCode={r.staffCode} />,
  },
  {
    key: "departmentName",
    label: "Đơn vị",
    render: (r) => <DepartmentCell id={r.departmentId} name={r.departmentName} />,
  },
  { key: "role", label: "Chức vụ", sortable: true, render: (r) => ROLE_LABEL[r.role] },
  { key: "kpi", label: "Chỉ tiêu", sortable: true, render: (r) => <KpiGap row={r} /> },
];

const ROLE_FILTERS = RoleKey.options.map((value) => ({
  value,
  label: ROLE_LABEL[value],
}));

/** P-51 · Danh sách nhân viên + chỉ tiêu + quản trị tài khoản. */
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

  const [month, setMonth] = useState(thisMonth());
  const [departmentId, setDepartmentId] = useState("");
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  // Mặc định KHÔNG chọn gì = lấy hết. Giữ mảng rỗng thay vì nhồi sẵn cả 6 mục
  // để "chưa lọc" và "lọc đúng 6 mục" không lẫn vào nhau ở tầng gọi API.
  const [roles, setRoles] = useState<RoleKey[]>([]);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<StaffSort>("kpi");
  const [dir, setDir] = useState<SortDir>("desc");
  const [editing, setEditing] = useState<StaffAccount | null>(null);
  const [creating, setCreating] = useState(false);

  const canManage = can(user, "staff", "create") || can(user, "staff", "update");

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    staleTime: Infinity,
  });

  /** Đổi bộ lọc thì về trang đầu — giữ nguyên trang 5 của kết quả cũ là hiện một khúc rỗng. */
  const refine = (apply: () => void) => {
    apply();
    setPage(0);
  };

  const query: StaffQuery = {
    scope,
    departmentId,
    search: searchQuery,
    summaryMonth: month,
    // Chỉ người đang làm. Người đã khoá xem trong hồ sơ của họ, không lẫn vào
    // danh sách hằng ngày.
    status: "active",
    roles,
    page,
    sort,
    dir,
  };

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    // `roles` sắp lại trước khi vào khoá: ô tích bỏ rồi tích lại đẩy phần tử
    // xuống cuối mảng, cùng một tập nhưng khác khoá — thêm một ô cache trùng
    // nội dung và một lượt gọi mạng thừa.
    queryKey: ["staff", { ...query, roles: [...roles].sort() }],
    queryFn: () => fetchStaff(query),
    /**
     * Giữ trang cũ trong lúc tải trang mới. Không giữ thì `isPending` bật lại
     * theo từng lần đổi khoá: bảng bị thay bằng skeleton, số đếm nhảy về 0, và
     * nút "Sau" rời khỏi DOM — bấm hai lần liên tiếp là cú thứ hai rơi vào chỗ
     * trống, còn người dùng bàn phím thì mất tiêu điểm (AGENTS.md §8).
     */
    placeholderData: keepPreviousData,
  });

  const rows = data?.page.rows ?? EMPTY_PAGE.rows;
  const summary = data?.summary;

  // Kho rỗng và "lọc không ra gì" là hai chuyện khác nhau. Nói nhầm thì trưởng
  // phòng của một phòng mới đi tìm bộ lọc để xoá, trong khi không có cái nào bật.
  const filtering = Boolean(searchQuery || departmentId || roles.length > 0);

  // Nút chỉ có icon nên `aria-label` phải kèm tên người: giữa mười dòng giống
  // nhau, "Sửa" một mình không nói đang sửa ai.
  const columns = useMemo<RankColumn<StaffRow>[]>(
    () =>
      canManage
        ? [
            ...BASE_COLUMNS,
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
          ]
        : BASE_COLUMNS,
    [canManage],
  );

  return (
    <>
      <TopBar title="Nhân sự & KPI">
        <SearchField
          label="Tìm nhân viên"
          placeholder="Tìm tên, tên đăng nhập, đơn vị…"
          value={search}
          onChange={(v) => {
            // Về trang đầu ngay lúc gõ, không đợi hoãn xong: đang ở trang 3 mà
            // kết quả mới chỉ có 2 dòng thì trang 3 là một khúc rỗng.
            setSearch(v);
            setPage(0);
          }}
        />
        <FilterButton
          activeCount={(departmentId ? 1 : 0) + (roles.length > 0 ? 1 : 0)}
          onClear={() =>
            refine(() => {
              setDepartmentId("");
              setRoles([]);
            })
          }
        >
          <MonthPicker value={month} onChange={(m) => refine(() => setMonth(m))} />
          <Select
            label="Đơn vị"
            value={departmentId}
            onChange={(v) => refine(() => setDepartmentId(v))}
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
                  refine(() => setRoles(next.length === ROLE_FILTERS.length ? [] : next));
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
        <FilterChips
          chips={[
            ...(departmentId
              ? [
                  {
                    label: `Đơn vị: ${departments.find((d) => d.id === departmentId)?.name ?? departmentId}`,
                    onRemove: () => refine(() => setDepartmentId("")),
                  },
                ]
              : []),
            ...(roles.length > 0
              ? [
                  {
                    label: `Chức vụ: ${roles
                      .map((r) => ROLE_FILTERS.find((x) => x.value === r)?.label ?? r)
                      .join(", ")}`,
                    onRemove: () => refine(() => setRoles([])),
                  },
                ]
              : []),
          ]}
        />

        {isPending && (
          <>
            <SkeletonStats count={3} />
            <SkeletonTable rows={8} columns={5} />
          </>
        )}
        {isError && (
          <ErrorState what="danh sách nhân viên" onRetry={refetch} retrying={isFetching} />
        )}

        {data && summary && (
          <>
            <div className={styles.stats}>
              <StatCard value={summary.active + summary.locked} label="nhân viên" />
              <StatCard value={summary.onTarget} label="đã đạt chỉ tiêu" />
              <StatCard
                value={summary.offTarget}
                label="chưa đạt"
                tone={summary.offTarget > 0 ? "attention" : "normal"}
                detail={data.daysLeft > 0 ? `còn ${data.daysLeft} ngày` : undefined}
              />
            </div>

            <SectionCard
              title="Nhân viên"
              icon={<Users size={17} />}
              meta={
                searchQuery
                  ? `${monthLabel(month)} · khớp ${data.page.total}`
                  : monthLabel(month)
              }
            >
              <RankTable
                rows={rows}
                columns={columns}
                rowKey={(r) => r.id}
                defaultSort={sort}
                caption={`Nhân viên và chỉ tiêu ${monthLabel(month)}`}
                emptyText={
                  searchQuery
                    ? `Không tìm thấy nhân viên nào khớp “${searchQuery}”.`
                    : filtering
                      ? "Không có nhân viên nào khớp bộ lọc đang chọn."
                      : "Chưa có nhân viên nào."
                }
                server={{
                  sort,
                  dir,
                  page,
                  total: data.page.total,
                  pageSize: PAGE_SIZE,
                  onSortChange: (nextSort, nextDir) => {
                    setSort(nextSort as StaffSort);
                    setDir(nextDir);
                    setPage(0);
                  },
                  onPageChange: setPage,
                }}
              />
              {searchQuery && (
                <p className={styles.footnote}>
                  Ba số tóm tắt phía trên không đổi theo ô tìm kiếm — chúng là
                  của cả {departmentId ? "đơn vị đang lọc" : "phạm vi đang xem"},
                  còn ô tìm kiếm chỉ lọc bảng.
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
