"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { MY_BLANKS_KEY, saveMyBlanks, type MyBlanksForm, type OwnBlank } from "@/lib/api/myBlanks";
import { formatCount } from "@/lib/format";
import { digitsOnly } from "@/lib/numberField";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./MyBlanksDialog.module.scss";

type Group = "insurance" | "bank";
type Held = { insurance: OwnBlank[]; bank: OwnBlank[] };

const GROUPS: { group: Group; title: string }[] = [
  { group: "insurance", title: "Phôi bảo hiểm" },
  { group: "bank", title: "Phiếu ngân hàng" },
];

const keyOf = (group: Group, id: string) => `${group}:${id}`;

/** Nhân viên báo số phôi, phiếu đang cầm. Mở từ dòng số ở Tổng quan và từ nút + thanh đáy. */
export function MyBlanksDialog({ data, onClose }: { data: Held; onClose: () => void }) {
  const queryClient = useQueryClient();
  // Giữ số lúc mở: số đã nhận gửi đi phải đúng số người dùng đang nhìn, máy chủ so lại số đó.
  const [shown] = useState(data);
  const [values, setValues] = useState<Record<string, string>>({});
  const valueOf = (group: Group, item: OwnBlank) => values[keyOf(group, item.id)] ?? "";

  const errorOf = (group: Group, item: OwnBlank) => {
    const value = valueOf(group, item);
    if (value !== "" && Number(value) > item.received) return `Tối đa ${formatCount(item.received)}.`;
    return undefined;
  };
  const invalid = GROUPS.some(({ group }) => shown[group].some((item) => errorOf(group, item)));
  const reportOf = (group: Group) =>
    shown[group]
      .filter((item) => valueOf(group, item) !== "")
      .map((item) => ({ id: item.id, received: item.received, remaining: Number(valueOf(group, item)) }));

  const save = useMutation({
    mutationFn: (form: MyBlanksForm) => saveMyBlanks(form),
    onSuccess: (result) => {
      queryClient.setQueryData(MY_BLANKS_KEY, result);
      void queryClient.invalidateQueries({ queryKey: ["insurance-blanks"] });
      void queryClient.invalidateQueries({ queryKey: ["bank-blanks"] });
      toast.ok("Đã báo số còn lại");
      onClose();
    },
    // Số đang hiện đã cũ thì nhập lại trên hộp thoại cũ cũng bị từ chối, nên đóng để lần mở sau đọc số mới.
    onError: (e) => {
      toast.fail(errorMessage(e, "Không lưu được."));
      void queryClient.invalidateQueries({ queryKey: MY_BLANKS_KEY });
      onClose();
    },
  });

  const requestClose = () => {
    if (!save.isPending) onClose();
  };

  const submit = () => {
    if (invalid) return;
    const form = { insurance: reportOf("insurance"), bank: reportOf("bank") };
    if (form.insurance.length === 0 && form.bank.length === 0) onClose();
    else save.mutate(form);
  };

  return createPortal(
    <Dialog
      open
      narrow
      onClose={requestClose}
      title="Báo phôi, phiếu còn lại"
      footer={
        <>
          <Button variant="secondary" onClick={requestClose} disabled={save.isPending}>
            Huỷ
          </Button>
          <Button type="submit" form="my-blanks-form" disabled={invalid || save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <form
        id="my-blanks-form"
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {GROUPS.filter(({ group }) => shown[group].length > 0).map(({ group, title }) => (
          <section key={group} className={styles.group} aria-labelledby={`my-blanks-${group}`}>
            <h3 id={`my-blanks-${group}`} className={styles.title}>
              {title}
            </h3>
            <div className={styles.fields}>
              {shown[group].map((item) => (
                <TextField
                  key={item.id}
                  label={item.name}
                  labelAppend={
                    <span className={styles.current}>Còn lại {formatCount(item.remaining)}</span>
                  }
                  inputMode="numeric"
                  value={valueOf(group, item)}
                  error={errorOf(group, item)}
                  onChange={(e) => {
                    const value = digitsOnly(e.target.value).replace(/^0+(?=\d)/, "").slice(0, 6);
                    setValues((prev) => ({ ...prev, [keyOf(group, item.id)]: value }));
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </form>
    </Dialog>,
    document.body,
  );
}
