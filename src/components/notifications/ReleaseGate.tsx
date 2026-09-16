"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { usePendingRelease } from "@/components/layout/useUnreadCount";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { markNotificationsRead } from "@/lib/api/notifications";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./ReleaseGate.module.css";

/**
 * Hộp thoại che màn hình khi có bản cập nhật chưa đọc.
 *
 * Không có nút X, không đóng bằng Esc hay bấm ra ngoài: bản cập nhật đổi luật
 * làm việc, người dùng phải bấm Xem một lần. Bấm Xem là đánh dấu đã đọc rồi
 * chuyển tới trang bản cập nhật; lượt mở app sau không hiện nữa.
 *
 * Dữ liệu đi cùng lượt hỏi chuông 60 giây (`usePendingRelease`), nên deploy xong
 * và chạy `db:announce-release` thì người đang mở app thấy trong vòng một phút.
 */
export function ReleaseGate() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const release = usePendingRelease();

  const view = useMutation({
    mutationFn: (id: string) => markNotificationsRead(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
      if (release?.id === id && release.url) router.push(release.url);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không mở được bản cập nhật")),
  });

  if (!release) return null;

  return (
    <Dialog
      open
      title={release.title}
      onClose={() => undefined}
      dismissible={false}
      footer={
        <Button onClick={() => view.mutate(release.id)} disabled={view.isPending}>
          {view.isPending ? "Đang mở…" : "Xem"}
        </Button>
      }
    >
      <p className={styles.body}>{release.body}</p>
    </Dialog>
  );
}
