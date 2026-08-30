"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { useMemo, useState } from "react";
import { FeedbackDetailDialog } from "@/components/feedback/FeedbackDetailDialog";
import { TopBar } from "@/components/layout/TopBar";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  FEEDBACK_STATUS_LABEL,
  fetchFeedbacks,
  type Feedback,
  type FeedbackStatus,
} from "@/lib/api/feedback";
import { EMPTY_PAGE, PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { formatDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

/**
 * P-96 · Hộp góp ý — mọi góp ý nhân viên gửi, kèm trạng thái đã xử lý hay chưa.
 *
 * Gác bằng `system:handle-feedback`, cùng điều kiện hiện mục ở `lib/nav.ts`.
 * Nút GỬI góp ý thì nằm ở chân sidebar và không gác quyền nào.
 *
 * Bảng có bốn cột, nội dung cắt ở hai dòng. Bấm một dòng thì mở
 * `FeedbackDetailDialog` đọc trọn câu, và nút đổi trạng thái nằm trong đó.
 */
export default function FeedbackPage() {
  const user = useSession((s) => s.user);
  // `RequirePermission` che phần hiện ra, nhưng hook vẫn chạy — không chặn ở
  // đây thì người không có quyền vẫn bắn một lượt gọi để nhận đúng 403.
  const canView = can(user, "system", "handle-feedback");

  const [status, setStatus] = useState<FeedbackStatus | "">("");
  const [page, setPage] = useState(0);
  // Chỉ sắp theo thời điểm gửi, và chỉ đổi được chiều — `FEEDBACK_SORT` có đúng
  // một khoá vì bảng này chỉ có chỉ mục theo `created_at`.
  const [dir, setDir] = useState<SortDir>("desc");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data = EMPTY_PAGE, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["feedback", status, page, dir],
    queryFn: () => fetchFeedbacks({ status, page, sort: "createdAt", dir }),
    enabled: canView,
    placeholderData: keepPreviousData,
  });

  /**
   * Giữ ID chứ không giữ cả dòng: sau khi đổi trạng thái danh sách tải lại, mà
   * một bản sao cũ nằm trong state thì hộp thoại vẫn hiện trạng thái trước đó.
   */
  const open = data.rows.find((r) => r.id === openId) ?? null;

  const columns = useMemo<RankColumn<Feedback>[]>(
    () => [
      {
        key: "createdAt",
        label: "Ngày",
        sortable: true,
        render: (r) => <span className="tabular-nums">{formatDate(r.createdAt)}</span>,
      },
      { key: "senderName", label: "Người gửi", render: (r) => r.senderName },
      {
        key: "content",
        label: "Nội dung",
        /**
         * `<button>` thật, không phải `<span>`: dòng bấm được chỉ là lối tắt
         * cho chuột, còn đây là đường đi bằng bàn phím. Không có nó thì người
         * dùng Tab không mở nổi chi tiết.
         *
         * Cố ý KHÔNG gắn `onClick` ở đây — lượt bấm nổi lên `onRowClick` của
         * dòng và mở đúng một lần. Gắn cả hai là gọi hai lần cho một cú bấm.
         */
        render: (r) => (
          <button type="button" className={styles.contentButton}>
            {r.content}
          </button>
        ),
      },
      {
        key: "status",
        label: "Trạng thái",
        render: (r) => (
          <StatusTag tone={r.status === "done" ? "ok" : "waiting"}>
            {FEEDBACK_STATUS_LABEL[r.status]}
          </StatusTag>
        ),
      },
    ],
    [],
  );

  /** Đổi bộ lọc thì về trang đầu — giữ trang 5 của kết quả cũ là hiện khúc rỗng. */
  const refine = (next: FeedbackStatus | "") => {
    setStatus(next);
    setPage(0);
  };

  return (
    <RequirePermission module="system" action="handle-feedback">
      <TopBar title="Hộp góp ý" keepTitleOnMobile>
        <FilterButton activeCount={status ? 1 : 0} onClear={() => refine("")}>
          <Select
            label="Trạng thái"
            value={status}
            onChange={(v) => refine(v as FeedbackStatus | "")}
            options={[
              { value: "", label: "Tất cả" },
              { value: "pending", label: FEEDBACK_STATUS_LABEL.pending },
              { value: "done", label: FEEDBACK_STATUS_LABEL.done },
            ]}
          />
        </FilterButton>
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={
            status
              ? [
                  {
                    label: `Trạng thái: ${FEEDBACK_STATUS_LABEL[status]}`,
                    onRemove: () => refine(""),
                  },
                ]
              : []
          }
        />

        {isPending && <SkeletonTable rows={10} columns={4} />}
        {isError && <ErrorState what="hộp góp ý" onRetry={refetch} retrying={isFetching} />}

        {!isPending && !isError && (
          <SectionCard
            title="Góp ý"
            icon={<MessageSquare size={17} />}
            meta={`${data.total} góp ý`}
          >
            <RankTable
              rows={data.rows}
              columns={columns}
              rowKey={(r) => r.id}
              defaultSort="createdAt"
              caption="Danh sách góp ý"
              emptyText={
                status ? "Không có góp ý nào khớp bộ lọc." : "Chưa có ai gửi góp ý."
              }
              onRowClick={(r) => setOpenId(r.id)}
              server={{
                sort: "createdAt",
                dir,
                page,
                total: data.total,
                pageSize: PAGE_SIZE,
                onSortChange: (_sort, nextDir) => {
                  setDir(nextDir);
                  setPage(0);
                },
                onPageChange: setPage,
              }}
            />
          </SectionCard>
        )}
      </main>

      <FeedbackDetailDialog feedback={open} onClose={() => setOpenId(null)} />
    </RequirePermission>
  );
}
