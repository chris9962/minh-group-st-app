"use client";

import { useRouter } from "next/navigation";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonCard } from "@/components/ui/Skeleton";
import {
  fetchNotifications,
  markNotificationsRead,
  type NotificationRow,
} from "@/lib/api/notifications";
import { formatDateTime } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./page.module.css";

/**
 * C-09 · Danh sách thông báo đầy đủ.
 *
 * Máy chủ vẫn cắt trang theo §5.1, mỗi lượt 15 dòng. Khác bảng dữ liệu ở chỗ
 * TRÌNH DUYỆT nối các trang lại thay vì thay hẳn: người đọc thông báo vuốt
 * xuống chứ không bấm sang trang, và bấm sang trang thì mất luôn chỗ đang đọc.
 *
 * Nút "Xem thêm" chứ không tự tải khi cuộn tới cuối: tự tải thì danh sách dài
 * mãi mà người dùng không có cách nào dừng, và không quay lại đầu được.
 *
 * Khối danh sách KHÔNG có tiêu đề riêng: thanh trên đã ghi "Thông báo".
 */
export default function NotificationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    data,
    isPending,
    isError,
    refetch,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["notifications", "list"],
    queryFn: ({ pageParam }) => fetchNotifications({ page: pageParam, sort: "at", dir: "desc" }),
    initialPageParam: 0,
    /**
     * Còn trang sau khi số dòng ĐÃ TẢI còn ít hơn tổng.
     *
     * Đếm dòng đã tải chứ không nhân `PAGE_SIZE` với số trang: trang cuối
     * thường không đủ 15 dòng, và phép nhân đó sinh ra một trang rỗng thứ ba.
     */
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.rows.length, 0);
      return loaded < last.total ? all.length : undefined;
    },
  });

  const read = useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đánh dấu đã đọc được")),
  });

  function go(row: NotificationRow) {
    if (!row.read) read.mutate(row.id);
    if (row.url) router.push(row.url);
  }

  const rows = data?.pages.flatMap((p) => p.rows) ?? [];
  const unread = data?.pages[0]?.unread ?? 0;

  /**
   * Hai bản của cùng một nút, mỗi bản một mốc màn hình.
   *
   * Cùng cách `PeriodPicker` làm ở màn chi tiết phòng ban: không có cách nào
   * chuyển một nút giữa hai cây DOM khác nhau bằng CSS, nên vẽ hai lần rồi ẩn
   * bớt một.
   */
  const markAllRead = (
    <Button
      variant="secondary"
      aria-label="Đánh dấu đã đọc hết"
      onClick={() => read.mutate(undefined)}
      disabled={unread === 0 || read.isPending}
    >
      {/* Nhãn ẩn dưới 900px (`Button.module.css`), nên nút BẮT BUỘC có icon.
          Thiếu icon là trên điện thoại nó thành ô vuông rỗng. */}
      <CheckCheck size={16} aria-hidden />
      <span className={buttonStyles.label}>Đánh dấu đã đọc hết</span>
    </Button>
  );

  return (
    <>
      <TopBar title="Thông báo" keepTitleOnMobile>
        <span className={styles.onMobile}>{markAllRead}</span>
      </TopBar>

      <main className={styles.body}>
        <section className={styles.card}>
          {/* Chỉ còn nút, và chỉ trên máy tính — trên điện thoại nút đã nằm ở
              thanh trên, nên hàng này rỗng và bị ẩn hẳn. */}
          <header className={styles.head}>{markAllRead}</header>

          {isError ? (
            <ErrorState what="danh sách thông báo" onRetry={refetch} retrying={isFetching} />
          ) : isPending ? (
            <SkeletonCard lines={6} />
          ) : rows.length === 0 ? (
            <p className={styles.empty}>Chưa có thông báo nào.</p>
          ) : (
            <ul className={styles.list}>
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={row.read ? styles.item : `${styles.item} ${styles.unread}`}
                    onClick={() => go(row)}
                  >
                    <span className={styles.itemTitle}>{row.title}</span>
                    <span className={styles.itemBody}>{row.body}</span>
                    <span className={styles.itemAt}>{formatDateTime(row.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {hasNextPage && (
            <div className={styles.more}>
              <Button
                variant="secondary"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                <span>{isFetchingNextPage ? "Đang tải…" : "Xem thêm"}</span>
              </Button>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
