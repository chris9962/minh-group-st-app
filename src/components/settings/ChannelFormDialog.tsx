"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import {
  ChannelForm,
  ChannelInputKind,
  INPUT_KIND_LABEL,
  createChannel,
  updateChannel,
  type Channel,
} from "@/lib/api/channelCatalog";
import styles from "./ChannelFormDialog.module.scss";
import { errorMessage, toast } from "@/lib/toast";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là sửa, không có thì là thêm kênh mới. */
  channel?: Channel | null;
};

/**
 * P-70 · Lập / sửa một dòng kênh — kiểu nhập kèm quyết định ô nào hiện ra ở
 * P-20/P-21. `hospital` tra vào danh mục bệnh viện dùng chung (card riêng
 * ngay trên trang này), không phải danh sách riêng của từng kênh.
 */
export function ChannelFormDialog({ open, onClose, channel }: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(channel);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ChannelForm>({
    resolver: zodResolver(ChannelForm),
    defaultValues: {
      name: channel?.name ?? "",
      inputKind: channel?.inputKind ?? "free-text",
    },
  });

  const inputKind = watch("inputKind");

  const save = useMutation({
    mutationFn: (form: ChannelForm) =>
      channel ? updateChannel(channel.id, form) : createChannel(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      onClose();
      toast.ok("Đã lưu kênh");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được kênh này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Sửa kênh" : "Thêm kênh"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="channel-form" disabled={isSubmitting || save.isPending}>
            {editing ? "Lưu" : "Tạo kênh"}
          </Button>
        </>
      }
    >
      <form
        id="channel-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        <TextField
          label="Tên kênh"
          placeholder="Trường học"
          error={errors.name?.message}
          {...register("name")}
        />

        <Select
          block
          label="Kiểu nhập kèm"
          value={inputKind}
          onChange={(v) => setValue("inputKind", v as ChannelInputKind, { shouldDirty: true })}
          options={ChannelInputKind.options.map((value) => ({
            value,
            label: INPUT_KIND_LABEL[value],
          }))}
        />
      </form>
    </Dialog>
  );
}
