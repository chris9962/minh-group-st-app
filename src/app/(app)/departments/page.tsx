"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Building2, Pencil, Plus } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { DepartmentFormDialog } from "@/components/departments/DepartmentFormDialog";
import { Button } from "@/components/ui/Button";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  fetchDepartmentRows,
  setDepartmentActive,
  type DepartmentRow,
} from "@/lib/api/org";
import { useDebouncedValue } from "@/lib/hooks";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import styles from "./page.module.css";

/** P-91 · Phòng ban. Danh sách phẳng — không có cây, không có đơn vị cha. */
export default function DepartmentsPage() {
  const user = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [creating, setCreating] = useState(false);

  const canManage = can(user, "system", "manage-org");

  const { data, isPending, isError } = useQuery({
    queryKey: ["org-departments", searchQuery],
    queryFn: () => fetchDepartmentRows(searchQuery),
    // Giữ bảng cũ trong lúc gõ tiếp — không thì mỗi lần đổi từ khoá bảng lại
    // biến mất rồi hiện lại, nhìn giật.
    placeholderData: (previous) => previous,
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      setDepartmentActive(id, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-departments"] });
      queryClient.invalidateQueries({ queryKey: ["departments"] });
    },
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
      {
        key: "headcount",
        label: "Số người",
        align: "right",
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
      {
        key: "actions",
        label: "Thao tác",
        align: "right",
        render: (d) => (
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
              onClick={() => toggleActive.mutate({ id: d.id, next: !d.active })}
            >
              {d.active ? "Ngừng hoạt động" : "Mở lại"}
            </Button>
          </span>
        ),
      },
    ],
    [toggleActive],
  );

  const blocked = (data?.departments ?? []).filter(
    (d) => d.active && d.headcount > 0,
  );

  return (
    <>
      <TopBar title="Phòng ban">
        <SearchField
          label="Tìm phòng ban"
          placeholder="Tìm tên phòng…"
          value={search}
          onChange={setSearch}
        />
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            Thêm phòng ban
          </Button>
        )}
      </TopBar>

      <main className={styles.body}>
        {isPending && <p className="text-muted">Đang tải danh sách…</p>}
        {isError && (
          <p className="text-muted">Không tải được danh sách phòng ban.</p>
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
              meta={
                searchQuery
                  ? `khớp ${data.departments.length}/${data.summary.total}`
                  : undefined
              }
            >
              {data.departments.length === 0 && (
                <p className="text-muted">
                  {searchQuery
                    ? `Không tìm thấy phòng nào khớp “${searchQuery}”.`
                    : "Chưa có phòng ban nào."}
                </p>
              )}

              <RankTable
                rows={data.departments}
                columns={columns}
                rowKey={(d) => d.id}
                defaultSort="headcount"
                pageSize={10}
                caption="Phòng ban, số người và trạng thái"
              />

              {toggleActive.isError && (
                <p className={styles.footnote}>
                  Không đổi được trạng thái phòng này.
                </p>
              )}

              {/* Nút mờ mà không nói vì sao chính là chỗ người dùng mắc kẹt. */}
              {blocked.length > 0 && (
                <p className={styles.footnote}>
                  <strong>Không ngừng hoạt động được</strong>{" "}
                  {blocked.map((d) => `${d.name} (${d.headcount} người)`).join(", ")}
                  {" "}— chuyển hết người sang phòng khác trước.
                </p>
              )}

              <p className={styles.footnote}>
                Phòng ban là <strong>danh sách phẳng</strong>, không có cấp trên
                cấp dưới. Ai quản phòng nào thì sửa trong hồ sơ người đó ở màn
                Nhân sự &amp; KPI.
              </p>
              <p className={styles.footnote}>
                Giải thể phòng thì cho <strong>ngừng hoạt động</strong>, không
                xoá — bản ghi cũ lưu mã phòng, xoá là để lại mã chết trong dữ
                liệu các tháng trước. Phòng đã ngừng không còn trong ô chọn đơn
                vị nhưng số liệu cũ của nó vẫn nguyên.
              </p>
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
      </main>
    </>
  );
}
