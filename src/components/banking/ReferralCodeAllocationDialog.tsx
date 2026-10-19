"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { ACCOUNT_TYPE_LABEL } from "@/lib/api/bankAccounts";
import {
  fetchReferralCodeAllocations,
  saveReferralCodeAllocations,
  type ReferralCode,
  type ReferralCodeAllocationItem,
  type ReferralCodeAllocationRow,
  type ReferralCodeAllocationSheet,
} from "@/lib/api/bankCatalog";
import { formatCount } from "@/lib/format";
import { digitsOnly } from "@/lib/numberField";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./ReferralCodeAllocationDialog.module.scss";

type Props = {
  code: ReferralCode;
  onClose: () => void;
};

const titleOf = (code: ReferralCode) =>
  `Chia mã ${code.bankCode} - ${ACCOUNT_TYPE_LABEL[code.accountType]} - ${code.displayName}`;

/**
 * Trưởng phòng chia chỗ của MỘT mã cho nhân viên trong phòng (chốt 2026-10-19).
 * Mở từ cột "Chia cho nhân viên" của modal MGT.
 *
 * Mỗi người một ô số; dòng đầu nói đã chia bao nhiêu, còn bao nhiêu, và đổi
 * ngay khi gõ. Máy chủ chốt lại: không hạ dưới số đã dùng, tổng không vượt phần
 * còn chia được, người đã rời phòng chỉ thu hồi.
 */
export function ReferralCodeAllocationDialog({ code, onClose }: Props) {
  const queryClient = useQueryClient();
  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ["referral-codes", "allocations", code.id],
    queryFn: () => fetchReferralCodeAllocations(code.id),
    // Quay lại tab là tải lại thì form reset giữa chừng, số đang gõ mất.
    refetchOnWindowFocus: false,
  });

  const save = useMutation({
    mutationFn: (items: ReferralCodeAllocationItem[]) => saveReferralCodeAllocations(code.id, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
      toast.ok(`Đã chia mã ${code.displayName}`);
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được phần chia.")),
  });

  if (isError || isPending) {
    return (
      <Dialog
        open
        title={titleOf(code)}
        onClose={onClose}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        }
      >
        {isError ? (
          <ErrorState what="phần chia của mã" onRetry={refetch} retrying={isFetching} />
        ) : (
          <p className="text-muted">Đang tải danh sách nhân viên…</p>
        )}
      </Dialog>
    );
  }

  return (
    <AllocationEditor
      // Reset theo dữ liệu máy chủ (AGENTS.md §7): tải lại là form về đúng số đã lưu.
      key={data.unallocated + ":" + data.rows.map((r) => `${r.userId}=${r.quota}`).join(",")}
      code={code}
      sheet={data}
      saving={save.isPending}
      onSave={(items) => save.mutate(items)}
      onClose={() => {
        if (!save.isPending) onClose();
      }}
    />
  );
}

type EditorProps = {
  code: ReferralCode;
  sheet: ReferralCodeAllocationSheet;
  saving: boolean;
  onSave: (items: ReferralCodeAllocationItem[]) => void;
  onClose: () => void;
};

/**
 * Phần của một dòng đã "có chủ" trong mã: số được chia, hoặc số đã dùng khi
 * chưa được chia (máy chủ đếm phần đó ở `usedByOthers`). Chia cho người đã
 * dùng 17 chỗ là chuyển 17 chỗ từ "người ngoài danh sách" sang phần của họ,
 * không phải trừ thêm 17 vào số còn lại.
 */
const committed = (quota: number, used: number) => (quota > 0 ? quota : used);

function AllocationEditor({ code, sheet, saving, onSave, onClose }: EditorProps) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(sheet.rows.map((r) => [r.userId, r.quota > 0 ? String(r.quota) : ""])),
  );

  const quotaOf = (row: ReferralCodeAllocationRow) => Number(draft[row.userId] || 0);
  const touched = (row: ReferralCodeAllocationRow) => draft[row.userId] !== "" || row.quota > 0;

  const allocated = sheet.rows.reduce((sum, r) => sum + quotaOf(r), 0);
  const remaining =
    sheet.unallocated +
    sheet.rows.reduce((sum, r) => sum + committed(r.quota, r.used) - committed(quotaOf(r), r.used), 0);

  const rowError = (row: ReferralCodeAllocationRow) => {
    if (!touched(row)) return undefined;
    const quota = quotaOf(row);
    if (quota < row.used) return `Đã dùng ${row.used}, không chia dưới ${row.used}`;
    if (!row.member && quota > row.quota) return "Đã rời phòng, chỉ thu hồi được";
    return undefined;
  };
  const hasRowError = sheet.rows.some((r) => rowError(r) !== undefined);
  const canSave = remaining >= 0 && !hasRowError && !saving;

  const submit = () => {
    if (!canSave) return;
    // Chỉ gửi dòng có sửa: người chưa được chia mà không gõ gì thì không nhắc tới.
    onSave(
      sheet.rows
        .filter((r) => quotaOf(r) !== r.quota)
        .map((r) => ({ userId: r.userId, quota: quotaOf(r) })),
    );
  };

  return (
    <Dialog
      open
      title={titleOf(code)}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Huỷ
          </Button>
          <Button form="referral-code-allocation-form" type="submit" disabled={!canSave}>
            {saving ? "Đang lưu…" : "Lưu"}
          </Button>
        </>
      }
    >
      <form
        id="referral-code-allocation-form"
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className={styles.summary} aria-live="polite">
          <span>{sheet.departmentName}</span>
          <span className="tabular-nums">
            Đã chia {formatCount(allocated)}
            {remaining < 0
              ? ` / vượt ${formatCount(-remaining)} chỗ`
              : ` / còn ${formatCount(remaining)} chỗ`}
          </span>
        </p>

        {remaining < 0 && <Alert tone="error">Tổng đã chia vượt số chỗ của mã.</Alert>}

        {sheet.rows.length === 0 ? (
          <p className="text-muted">Phòng chưa có nhân viên nào đang làm.</p>
        ) : (
          <ul className={styles.list}>
            {sheet.rows.map((row) => {
              const error = rowError(row);
              const inputId = `allocation-${row.userId}`;
              return (
                <li key={row.userId} className={styles.row}>
                  <label htmlFor={inputId} className={styles.person}>
                    <span className={styles.name}>{row.fullName}</span>
                    <span className={styles.meta}>
                      {row.staffCode ? `${row.staffCode} - ` : ""}
                      {row.member ? `đã dùng ${formatCount(row.used)}` : "đã rời phòng"}
                    </span>
                  </label>
                  <input
                    id={inputId}
                    className={`input ${styles.cell}`}
                    inputMode="numeric"
                    value={draft[row.userId] ?? ""}
                    disabled={saving}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${inputId}-error` : undefined}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [row.userId]: digitsOnly(e.target.value) }))
                    }
                  />
                  {error && (
                    <span id={`${inputId}-error`} className={styles.error}>
                      {error}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </form>
    </Dialog>
  );
}
