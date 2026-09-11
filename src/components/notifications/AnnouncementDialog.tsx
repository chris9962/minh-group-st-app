"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { AnnouncementBody, sendAnnouncement } from "@/lib/api/notifications";
import { reportInvalid } from "@/lib/formErrors";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./AnnouncementDialog.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * C-09 · Gửi thông báo chung cho toàn công ty.
 *
 * ⚠️ KHÔNG thu hồi được. Bấm gửi là mọi nhân viên đang hoạt động nhận một dòng
 * trong app cộng một gói tin đẩy về điện thoại. Vì vậy nút gửi ghi thẳng "Gửi
 * cho toàn công ty" chứ không ghi "Gửi": người bấm phải đọc ra phạm vi ngay
 * trên nút, không phải đoán từ tiêu đề hộp thoại.
 *
 * Ô "Mở tới trang" gõ tự do, chỉ đòi bắt đầu bằng `/`. Ràng buộc đó là kỹ thuật
 * chứ không phải nghi ngờ người gửi: cả hai đường bấm đều mở trong app, địa chỉ
 * ngoài không mở đúng ở đó.
 */
export function AnnouncementDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AnnouncementBody>({
    shouldFocusError: false,
    resolver: zodResolver(AnnouncementBody),
    defaultValues: { title: "", body: "", url: "" },
  });

  const close = () => {
    reset({ title: "", body: "", url: "" });
    onClose();
  };

  const send = useMutation({
    mutationFn: sendAnnouncement,
    onSuccess: (result) => {
      // Người gửi cũng nhận tin của chính mình, nên danh sách và ô đếm phải đổi
      // ngay chứ không đợi lượt hỏi định kỳ.
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
      close();
      toast.ok(`Đã gửi cho ${result.sent} người`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không gửi được thông báo chung.")),
  });

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Thông báo chung"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={send.isPending}>
            Đóng
          </Button>
          <Button type="submit" form="announcement-form" disabled={isSubmitting || send.isPending}>
            {send.isPending ? "Đang gửi…" : "Gửi cho toàn công ty"}
          </Button>
        </>
      }
    >
      <form
        id="announcement-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => send.mutate(form), reportInvalid)}
        noValidate
      >
        <TextField
          label="Tiêu đề"
          required
          maxLength={80}
          placeholder="Nghỉ lễ 02/09"
          error={errors.title?.message}
          {...register("title")}
        />
        <TextArea
          label="Nội dung"
          required
          rows={4}
          maxLength={300}
          placeholder="Công ty nghỉ từ thứ Hai tới hết thứ Tư. Đội trực vẫn nhận đơn như thường."
          error={errors.body?.message}
          {...register("body")}
        />
        <TextField
          label="Mở tới trang (không bắt buộc)"
          maxLength={200}
          placeholder="/insurance"
          error={errors.url?.message}
          {...register("url")}
        />
      </form>
    </Dialog>
  );
}
