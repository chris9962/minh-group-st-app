"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { monthLabel } from "@/components/ui/MonthPicker";
import { SkeletonText } from "@/components/ui/Skeleton";
import { TextField } from "@/components/ui/TextField";
import {
  createSalaryAdjustment,
  deleteSalaryAdjustment,
  fetchSalaryAdjustments,
  SALARY_ADJUSTMENT_ADD_LABEL,
  SALARY_ADJUSTMENT_LABEL,
  type SalaryAdjustment,
  type SalaryAdjustmentKind,
} from "@/lib/api/salaryAdjustments";
import { formatCount, formatDate, formatVnd } from "@/lib/format";
import { digitsOnly } from "@/lib/numberField";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./SalaryAdjustments.module.scss";

const EMPTY_TEXT: Record<SalaryAdjustmentKind, string> = {
  advance: "Chưa ứng lương lần nào.",
  bonus: "Chưa có khoản thưởng nào.",
  deduction: "Chưa có khoản trừ nào.",
};

type Props = {
  staff: { id: string; fullName: string };
  month: string;
  kind: SalaryAdjustmentKind;
  /** `add` mở thẳng form ghi thêm từ nút "+" ở ô bảng; `list` liệt kê các lần đã ghi. */
  mode: "list" | "add";
  /** Có quyền chốt lương và tháng chưa chốt: hiện nút xoá. */
  editable: boolean;
  onClose: () => void;
};

/** Các lần ứng lương, thưởng hoặc trừ lương của một người trong tháng, hoặc form ghi thêm một lần. */
export function SalaryAdjustmentsDialog({ staff, month, kind, mode, editable, onClose }: Props) {
  const queryClient = useQueryClient();
  const adding = mode === "add";
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [removing, setRemoving] = useState<SalaryAdjustment | null>(null);

  const queryKey = ["salary-adjustments", staff.id, month];
  const query = useQuery({
    queryKey,
    queryFn: () => fetchSalaryAdjustments(staff.id, month),
    enabled: !adding,
  });
  const rows = (query.data ?? []).filter((r) => r.kind === kind);
  const total = rows.reduce((t, r) => t + r.amount, 0);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ["staff"] });
  };

  const create = useMutation({
    mutationFn: () =>
      createSalaryAdjustment(staff.id, { month, kind, amount: Number(amount), note: note.trim() }),
    onSuccess: () => {
      refresh();
      toast.ok(`Đã ghi ${SALARY_ADJUSTMENT_ADD_LABEL[kind].toLowerCase()} ${formatVnd(Number(amount))}`);
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được.")),
  });

  const remove = useMutation({
    mutationFn: (row: SalaryAdjustment) => deleteSalaryAdjustment(staff.id, row.id),
    onSuccess: () => {
      refresh();
      toast.ok("Đã xoá");
      setRemoving(null);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không xoá được.")),
  });

  const title = `${SALARY_ADJUSTMENT_LABEL[kind]} ${monthLabel(month).toLowerCase()} - ${staff.fullName}`;
  const addLabel = SALARY_ADJUSTMENT_ADD_LABEL[kind];

  return createPortal(
    <>
      <Dialog
        open
        wide
        onClose={onClose}
        title={adding ? `${addLabel} - ${staff.fullName}` : title}
        footer={
          adding ? (
            <>
              <Button variant="secondary" onClick={onClose}>
                Huỷ
              </Button>
              <Button type="submit" form="salary-adjustment-form" disabled={!Number(amount) || create.isPending}>
                Lưu
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Đóng
            </Button>
          )
        }
      >
        {adding ? (
          <form
            id="salary-adjustment-form"
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <TextField
              label="Số tiền"
              required
              inputMode="numeric"
              autoFocus
              trailing={<span className={styles.unit}>đ</span>}
              value={amount ? formatCount(Number(amount)) : ""}
              onChange={(e) => setAmount(digitsOnly(e.target.value).replace(/^0+/, "").slice(0, 10))}
            />
            <TextField label="Ghi chú" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </form>
        ) : query.isPending ? (
          <SkeletonText lines={3} label="Đang tải" />
        ) : query.isError ? (
          <ErrorState what={SALARY_ADJUSTMENT_LABEL[kind].toLowerCase()} onRetry={query.refetch} retrying={query.isFetching} />
        ) : rows.length === 0 ? (
          <p className={styles.empty}>{EMPTY_TEXT[kind]}</p>
        ) : (
          <table className={styles.table}>
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">Ngày ghi</th>
                <th scope="col">Số tiền</th>
                <th scope="col">Ghi chú</th>
                <th scope="col">Người ghi</th>
                {editable && <th scope="col"><span className="sr-only">Xoá</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.date)}</td>
                  <td className={`${styles.amount} tabular-nums`}>{formatVnd(r.amount)}</td>
                  <td>{r.note || "—"}</td>
                  <td>{r.createdByName}</td>
                  {editable && (
                    <td>
                      {!r.linked && (
                        <Button
                          variant="secondary"
                          icon
                          aria-label={`Xoá ${formatVnd(r.amount)} ngày ${formatDate(r.date)}`}
                          onClick={() => setRemoving(r)}
                        >
                          <Trash2 size={16} aria-hidden />
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Tổng</th>
                <td className={`${styles.amount} tabular-nums`}>{formatVnd(total)}</td>
                <td colSpan={editable ? 3 : 2} />
              </tr>
            </tfoot>
          </table>
        )}
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        title="Xoá khoản lương"
        confirmLabel="Xoá"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
        onClose={() => setRemoving(null)}
      >
        Bạn muốn xoá khoản {removing ? formatVnd(removing.amount) : ""} ghi ngày{" "}
        {removing ? formatDate(removing.date) : ""}?
      </ConfirmDialog>
    </>,
    document.body,
  );
}
