"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { MessageSquarePlus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import { FEEDBACK_MAX, FeedbackForm, submitFeedback } from "@/lib/api/feedback";
import { reportInvalid } from "@/lib/formErrors";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./FeedbackButton.module.scss";

/**
 * Nút Góp ý ở chân sidebar — mọi người đăng nhập đều thấy, không gác quyền nào.
 *
 * Ô nhập nhận cả góp ý lẫn câu hỏi; placeholder nói rõ điều đó thay vì thêm một
 * ô chọn "loại góp ý" mà người gửi phải đoán mình thuộc loại nào.
 */
export function FeedbackButton({ onSent }: { onSent?: () => void }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FeedbackForm>({
    shouldFocusError: false,
    resolver: zodResolver(FeedbackForm),
    defaultValues: { content: "" },
  });

  const close = () => setOpen(false);

  const send = useMutation({
    // `path` lấy lúc GỬI chứ không lúc mở: hộp thoại nằm trên sidebar nên nó
    // không đóng khi người dùng chuyển trang, và trang lúc gửi mới là trang họ
    // đang nói tới.
    mutationFn: (form: FeedbackForm) => submitFeedback({ ...form, path: pathname }),
    onSuccess: () => {
      close();
      reset();
      toast.ok("Đã gửi góp ý");
      onSent?.();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không gửi được góp ý.")),
  });

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)}>
        <MessageSquarePlus size={18} strokeWidth={1.8} aria-hidden />
        Góp ý
      </button>

      <Dialog
        open={open}
        onClose={close}
        title="Góp ý"
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Huỷ
            </Button>
            <Button type="submit" form="feedback-form" disabled={isSubmitting || send.isPending}>
              Gửi
            </Button>
          </>
        }
      >
        <form
          id="feedback-form"
          className={styles.form}
          onSubmit={handleSubmit((form) => send.mutate(form), reportInvalid)}
          noValidate
        >
          <TextArea
            label="Nội dung"
            required
            rows={7}
            maxLength={FEEDBACK_MAX}
            placeholder="Bạn góp ý gì, hoặc muốn hỏi gì?"
            error={errors.content?.message}
            {...register("content")}
          />
        </form>
      </Dialog>
    </>
  );
}
