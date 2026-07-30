"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
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

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là sửa, không có thì là thêm kênh mới. */
  channel?: Channel | null;
};

/** P-70 · Lập / sửa một dòng kênh — kiểu nhập kèm quyết định ô nào hiện ra ở P-20/P-21. */
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
      listOptions: channel?.listOptions ?? [],
    },
  });

  const inputKind = watch("inputKind");
  const listOptions = watch("listOptions");

  const updateOption = (i: number, value: string) =>
    setValue(
      "listOptions",
      listOptions.map((o, idx) => (idx === i ? value : o)),
      { shouldDirty: true },
    );
  const removeOption = (i: number) =>
    setValue(
      "listOptions",
      listOptions.filter((_, idx) => idx !== i),
      { shouldDirty: true },
    );
  const addOption = () => setValue("listOptions", [...listOptions, ""], { shouldDirty: true });

  const save = useMutation({
    mutationFn: (form: ChannelForm) =>
      channel ? updateChannel(channel.id, form) : createChannel(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      onClose();
    },
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
        {save.isError && <Alert tone="error">Không lưu được kênh này.</Alert>}

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

        {inputKind === "list" && (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Các lựa chọn trong danh sách</legend>
            <div className={styles.options}>
              {listOptions.map((option, i) => (
                <div key={i} className={styles.optionRow}>
                  <TextField
                    label={`Lựa chọn ${i + 1}`}
                    placeholder="Bệnh viện Đa khoa Tân Bình"
                    error={errors.listOptions?.[i]?.message}
                    value={option}
                    onChange={(e) => updateOption(i, e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    icon
                    type="button"
                    aria-label={`Xoá lựa chọn ${i + 1}`}
                    onClick={() => removeOption(i)}
                  >
                    <Trash2 size={16} aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
            {typeof errors.listOptions?.message === "string" && (
              <p className={styles.error}>{errors.listOptions.message}</p>
            )}
            <Button variant="secondary" type="button" onClick={addOption}>
              + Thêm lựa chọn
            </Button>
          </fieldset>
        )}
      </form>
    </Dialog>
  );
}
