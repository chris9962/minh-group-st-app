"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Building2, Pencil, Plus } from "lucide-react";
import { SkeletonStats, SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { DepartmentFormDialog } from "@/components/departments/DepartmentFormDialog";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Checkbox } from "@/components/ui/Checkbox";
import { FilterButton } from "@/components/ui/FilterButton";
import {
  DEFAULT_PERIOD,
  PeriodPicker,
  periodKey,
  type Period,
} from "@/components/ui/PeriodPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { RateDelta } from "@/components/ui/RateDelta";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  fetchDepartmentRows,
  fetchDepartmentStats,
  setDepartmentActive,
  type DepartmentRow,
} from "@/lib/api/org";
import { useDebouncedValue } from "@/lib/hooks";
import { can } from "@/lib/permissions";
import { usePrefs } from "@/store/prefs";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";
import { errorMessage, toast } from "@/lib/toast";

const installRate = (s: { accountsOpened: number; appsInstalled: number }) =>
  s.accountsOpened === 0 ? 0 : Math.round((s.appsInstalled / s.accountsOpened) * 100);

/** P-91 · Phòng ban. Danh sách phẳng — không có cây, không có đơn vị cha. */
export default function DepartmentsPage() {
  const user = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  // Nhớ theo máy — mở lại trang không phải tích lại.
  const showStopped = usePrefs((s) => s.showStoppedDepartments);
  const setShowStopped = usePrefs((s) => s.setShowStoppedDepartments);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [creating, setCreating] = useState(false);
  /** Phòng đang chờ xác nhận ngừng / mở lại. */
  const [confirming, setConfirming] = useState<DepartmentRow | null>(null);
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);

  const canManage = can(user, "system", "manage-org");
  // Số TK mở/App cài/Tỉ lệ cài/Khách hàng là số liệu nghiệp vụ — quyền xem nó
  // tách khỏi quyền quản tổ chức, giống hệt cách P-80 quyết định ai thấy
  // "Xếp hạng phòng".
  const canSeeStats =
    can(user, "banking", "view-summary") ||
    can(user, "insurance", "view-summary") ||
    can(user, "services", "view-summary");

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["org-departments", searchQuery],
    queryFn: () => fetchDepartmentRows(searchQuery),
    // Giữ bảng cũ trong lúc gõ tiếp — không thì mỗi lần đổi từ khoá bảng lại
    // biến mất rồi hiện lại, nhìn giật.
    placeholderData: (previous) => previous,
  });

  const statsQuery = useQuery({
    queryKey: ["org-department-stats", periodKey(period)],
    queryFn: () => fetchDepartmentStats(periodKey(period)),
    enabled: canSeeStats,
    placeholderData: (previous) => previous,
  });

  // Chỉ 9 phòng kinh doanh có phát sinh TK/đơn/dịch vụ — phòng khác (kế toán,
  // dự án…) không có dòng trong đây, cột số liệu của chúng hiện "—".
  const statsById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof statsQuery.data>["departments"][number]>();
    statsQuery.data?.departments.forEach((d) => map.set(d.id, d));
    return map;
  }, [statsQuery.data]);

  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      setDepartmentActive(id, next),
    onSuccess: (_data, { next }) => {
      queryClient.invalidateQueries({ queryKey: ["org-departments"] });
      queryClient.invalidateQueries({ queryKey: ["departments"] });
      queryClient.invalidateQueries({ queryKey: ["org-department", _data.id] });
      toast.ok(next ? "Đã mở lại phòng ban" : "Đã ngừng hoạt động phòng ban");
      setConfirming(null);
    },
    onError: (e) =>
      toast.fail(errorMessage(e, "Không đổi được trạng thái phòng này. Thử lại.")),
  });

  const columns = useMemo<RankColumn<DepartmentRow>[]>(
    () => [
      {
        key: "name",
        label: "Tên phòng",
        render: (d) => (
          <Link href={`/departments/${d.id}`} className={styles.nameLink}>
            {d.name}
          </Link>
        ),
      },
      /**
       * TODO(P-91, chờ module ngân hàng): bốn cột này CHƯA CHẠY.
       *
       * `/api/org/departments/stats` là stub trả `{ departments: [] }` viết
       * cứng — không truy vấn gì, không đọc cả tham số `period`. Nên cả bốn cột
       * hiện `—` cho mọi phòng, và ô chọn kỳ trên thanh tiêu đề là nút bấm chết.
       *
       * Phía giao diện đã xong hết: cột, sắp xếp, `RateDelta`, nhánh thiếu dữ
       * liệu. Việc còn lại nằm TRỌN trong route kia — viết aggregate theo phòng
       * và theo kỳ, dùng chung công thức với dashboard P-80. Trả đúng dạng
       * `DepartmentStats` là bốn cột tự sống, không phải sửa file này.
       *
       * ⚠️ Đừng viết aggregate đó trước khi có dữ liệu thật: `appsInstalled` và
       * `installRate` dựa trên định nghĩa "app đã cài", mà thể lệ 03/08 đang
       * viết lại đúng chỗ đó (xem ghi chú đầu `src/server/people.ts`).
       */
      ...(canSeeStats
        ? ([
            {
              key: "accountsOpened",
              label: "TK mở",
              sortBy: (d) => statsById.get(d.id)?.accountsOpened ?? -1,
              render: (d) => statsById.get(d.id)?.accountsOpened ?? "—",
            },
            {
              key: "appsInstalled",
              label: "App cài",
              sortBy: (d) => statsById.get(d.id)?.appsInstalled ?? -1,
              render: (d) => statsById.get(d.id)?.appsInstalled ?? "—",
            },
            {
              key: "installRate",
              label: "Tỉ lệ cài",
              sortBy: (d) => {
                const s = statsById.get(d.id);
                return s ? installRate(s) : -1;
              },
              render: (d) => {
                const s = statsById.get(d.id);
                if (!s) return "—";
                return (
                  <span className={styles.rateCell}>
                    <span className="tabular-nums">{installRate(s)}%</span>
                    {s.previousInstallRate !== null && (
                      <RateDelta points={installRate(s) - s.previousInstallRate} />
                    )}
                  </span>
                );
              },
            },
            {
              key: "customers",
              label: "Khách hàng",
              sortBy: (d) => statsById.get(d.id)?.customers ?? -1,
              render: (d) => statsById.get(d.id)?.customers ?? "—",
            },
          ] satisfies RankColumn<DepartmentRow>[])
        : []),
      {
        key: "headcount",
        label: "Số người",
        sortBy: (d) => d.headcount,
        render: (d) => d.headcount,
      },
      {
        key: "active",
        label: "Trạng thái",
        render: (d) => (
          <StatusTag ok={d.active}>
            {d.active ? "Đang hoạt động" : "Đã ngừng"}
          </StatusTag>
        ),
      },
      // Không có `manage-org` thì mọi nút ở đây đều 403 — trang lại vào được
      // bằng URL (không có middleware, nav chỉ ẩn link). Giấu cột đi thay vì
      // đưa ra nút bấm vào không làm gì.
      ...(canManage
        ? [{
        key: "actions",
        label: "Thao tác",
        render: (d: DepartmentRow) => (
          <span className={styles.actions}>
            {/* Nút chỉ có icon nên aria-label phải kèm tên phòng: giữa mười lăm
                dòng giống nhau, "Sửa" một mình không nói đang sửa phòng nào. */}
            <Button
              variant="secondary"
              icon
              aria-label={`Đổi tên ${d.name}`}
              onClick={() => setEditing(d)}
            >
              <Pencil size={16} aria-hidden />
            </Button>
            <Button
              variant="secondary"
              disabled={
                (d.active && d.headcount > 0) || toggleActive.isPending
              }
              onClick={() => setConfirming(d)}
            >
              {d.active ? "Ngừng hoạt động" : "Mở lại"}
            </Button>
          </span>
        ),
      }] satisfies RankColumn<DepartmentRow>[]
        : []),
    ],
    [toggleActive.isPending, canSeeStats, canManage, statsById],
  );

  const blocked = (data?.departments ?? []).filter(
    (d) => d.active && d.headcount > 0,
  );

  /**
   * Phòng đã ngừng ẩn mặc định.
   *
   * Phòng chỉ NGỪNG chứ không xoá (quyết định #32 — bản ghi cũ trỏ vào khoảng
   * không), nên chúng nằm lại trong bảng mãi mãi và càng ngày càng lấn chỗ
   * những phòng đang chạy. Số lượng vẫn đọc được ở thẻ "đã ngừng" phía trên,
   * nên ẩn danh sách đi không giấu mất thông tin nào.
   */
  const rows = showStopped
    ? (data?.departments ?? [])
    : (data?.departments ?? []).filter((d) => d.active);
  const hiddenCount = (data?.departments.length ?? 0) - rows.length;

  return (
    <>
      <TopBar title="Phòng ban">
        <SearchField
          label="Tìm phòng ban"
          placeholder="Tìm tên phòng…"
          value={search}
          onChange={setSearch}
        />
        {canSeeStats && (
          <>
            <div className={styles.periodInline}>
              <PeriodPicker value={period} onChange={setPeriod} />
            </div>
            <div className={styles.periodCollapsed}>
              <FilterButton
                activeCount={period.kind === "today" ? 0 : 1}
                onClear={() => setPeriod(DEFAULT_PERIOD)}
              >
                <PeriodPicker value={period} onChange={setPeriod} />
              </FilterButton>
            </div>
          </>
        )}
        {canManage && (
          <Button aria-label="Thêm phòng ban" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden />
            <span className={buttonStyles.label}>Thêm phòng ban</span>
          </Button>
        )}
      </TopBar>

      <main className={styles.body}>
        {isPending && (
          <>
            <SkeletonStats count={3} />
            <SkeletonTable rows={8} columns={5} />
          </>
        )}
        {isError && (
          <ErrorState what="danh sách phòng ban" onRetry={refetch} retrying={isFetching} />
        )}

        {data && (
          <>
            <div className={styles.stats}>
              <StatCard value={data.summary.total} label="phòng ban" />
              <StatCard value={data.summary.active} label="đang hoạt động" />
              <StatCard
                value={data.summary.stopped}
                label="đã ngừng"
                tone={data.summary.stopped > 0 ? "attention" : "normal"}
              />
            </div>

            <SectionCard
              title="Phòng ban"
              icon={<Building2 size={17} />}
              meta={searchQuery ? `khớp ${rows.length}/${data.summary.total}` : undefined}
              // Chỉ hiện ô tích khi thật sự có phòng đã ngừng — không thì nó là
              // một lựa chọn không làm gì, đứng chắn chỗ mỗi lần mở trang.
              action={
                data.summary.stopped > 0 ? (
                  <Checkbox
                    checked={showStopped}
                    onCheckedChange={setShowStopped}
                    label={`Hiện cả phòng đã ngừng (${data.summary.stopped})`}
                  />
                ) : undefined
              }
            >
              {rows.length === 0 && (
                <p className="text-muted">
                  {hiddenCount > 0
                    ? `Chỉ có phòng đã ngừng khớp${searchQuery ? ` “${searchQuery}”` : ""} — tích ô trên để hiện.`
                    : searchQuery
                      ? `Không tìm thấy phòng nào khớp “${searchQuery}”.`
                      : "Chưa có phòng ban nào."}
                </p>
              )}

              <RankTable
                rows={rows}
                columns={columns}
                rowKey={(d) => d.id}
                defaultSort="headcount"
                pageSize={10}
                caption="Phòng ban, số người và trạng thái"
              />

              {/* Nút mờ mà không nói vì sao chính là chỗ người dùng mắc kẹt. */}
              {blocked.length > 0 && (
                <p className={styles.footnote}>
                  <strong>Không ngừng hoạt động được</strong>{" "}
                  {blocked.map((d) => `${d.name} (${d.headcount} người)`).join(", ")}
                  {" "}— chuyển hết người sang phòng khác trước.
                </p>
              )}

            </SectionCard>
          </>
        )}

        {(creating || editing) && (
          <DepartmentFormDialog
            open
            department={editing}
            onClose={() => {
              setCreating(false);
              setEditing(null);
            }}
          />
        )}

        <ConfirmDialog
          open={confirming !== null}
          title={confirming?.active ? "Ngừng hoạt động phòng" : "Mở lại phòng"}
          confirmLabel={confirming?.active ? "Ngừng hoạt động" : "Mở lại"}
          pending={toggleActive.isPending}
          onConfirm={() =>
            confirming &&
            toggleActive.mutate({ id: confirming.id, next: !confirming.active })
          }
          onClose={() => setConfirming(null)}
          consequence={
            confirming?.active ? (
              <>
                Phòng biến mất khỏi các ô chọn đơn vị nên{" "}
                <strong>không gán người mới vào được nữa</strong>. Số liệu và bản
                ghi cũ của phòng vẫn giữ nguyên, mở lại lúc nào cũng được.
              </>
            ) : (
              <>
                Phòng hiện lại ở mọi ô chọn đơn vị và nhận người mới được ngay.
              </>
            )
          }
        >
          {confirming?.active ? "Ngừng hoạt động phòng " : "Mở lại phòng "}
          <strong>{confirming?.name}</strong>?
        </ConfirmDialog>
      </main>
    </>
  );
}
