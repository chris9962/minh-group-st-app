"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  FEEDBACK_STATUS_LABEL,
  setFeedbackStatus,
  type Feedback,
} from "@/lib/api/feedback";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./FeedbackDetailDialog.module.scss";

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

type Props = {
  /** `null` là đóng — bảng truyền dòng đang mở vào đây. */
  feedback: Feedback | null;
  onClose: () => void;
};

/**
 * P-96 · Một góp ý, đầy đủ.
 *
 * Bảng chỉ hiện hai dòng đầu của nội dung, nên đây là chỗ duy nhất đọc trọn
 * câu người gửi viết. Nút đổi trạng thái cũng nằm ở đây chứ không ở bảng: một
 * cột nút trong bảng bấm được mà lại nằm trong dòng cũng bấm được, hai vùng bấm
 * lồng nhau thì người dùng không biết mình vừa chạm vào cái nào.
 */
export function FeedbackDetailDialog({ feedback, onClose }: Props) {
  const queryClient = useQueryClient();

  const mark = useMutation({
    mutationFn: (row: Feedback) =>
      setFeedbackStatus(row.id, row.status === "done" ? "pending" : "done"),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["feedback"] });
      onClose();
      toast.ok(row.status === "done" ? "Đã đánh dấu đã xử lý" : "Đã trả về chưa xử lý");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đổi được trạng thái góp ý.")),
  });

  const done = feedback?.status === "done";

  return (
    <Dialog
      open={Boolean(feedback)}
      onClose={onClose}
      title="Góp ý"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          <Button
            disabled={mark.isPending}
            onClick={() => feedback && mark.mutate(feedback)}
          >
            {done ? "Trả về chưa xử lý" : "Đánh dấu đã xử lý"}
          </Button>
        </>
      }
    >
      {feedback && (
        <div className={styles.body}>
          <dl className={styles.meta}>
            <div>
              <dt>Người gửi</dt>
              <dd>
                {feedback.senderName}
                {feedback.senderDepartmentName && ` · ${feedback.senderDepartmentName}`}
              </dd>
            </div>
            <div>
              <dt>Lúc gửi</dt>
              <dd>{formatDateTime(feedback.createdAt)}</dd>
            </div>
            <div>
              <dt>Trang đang mở</dt>
              <dd>{feedback.path || "—"}</dd>
            </div>
            <div>
              <dt>Trạng thái</dt>
              <dd>
                <StatusTag tone={done ? "ok" : "waiting"}>
                  {FEEDBACK_STATUS_LABEL[feedback.status]}
                </StatusTag>
                {feedback.handledByName &&
                  ` ${feedback.handledByName} · ${formatDateTime(feedback.handledAt)}`}
              </dd>
            </div>
          </dl>

          <p className={styles.content}>{feedback.content}</p>
        </div>
      )}
    </Dialog>
  );
}
