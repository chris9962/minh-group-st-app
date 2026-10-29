"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SkeletonText } from "@/components/ui/Skeleton";
import { pendingSkipReasonMessage, type PendingSkipReason } from "@/lib/api/bankAccounts";
import { toast } from "@/lib/toast";
import { BankSkipReasonDialog } from "./BankSkipReasonDialog";
import styles from "./PendingSkipReasonDialog.module.scss";

type Props = {
  pending: PendingSkipReason[];
  /** Việc nhân viên đang muốn làm, ví dụ "mở tài khoản cho khách mới". */
  next: string;
  /** Hiện tên khách trong form lý do: cần khi hồ sơ thiếu lý do không phải hồ sơ đang mở. */
  showName?: boolean;
  onClose: () => void;
};

/**
 * Hồ sơ thiếu lý do không mở bank ưu tiên (chốt 2026-10-29). Hồ sơ có bank ưu
 * tiên đang tạo thì nhân viên hoàn thành bank đó hoặc điền lý do. Chỉ có một hồ
 * sơ và hồ sơ đó không có bank ưu tiên nào thì mở thẳng form lý do.
 *
 * Nơi gọi đọc lại danh sách sau mỗi lần lưu và thôi hiện form này khi danh sách
 * rỗng. Trong lúc chờ, hồ sơ vừa lưu ẩn khỏi danh sách. Lưu xong luôn về danh
 * sách, để lượt đọc lại lỗi mạng thì nhân viên vẫn đóng được form.
 */
export function PendingSkipReasonDialog({ pending, next, showName = false, onClose }: Props) {
  const directForm = pending.length === 1 && pending[0].creating.length === 0;
  const [editingId, setEditingId] = useState<string | null>(directForm ? pending[0].customerId : null);
  const [savedIds, setSavedIds] = useState<string[]>([]);

  const remaining = pending.filter((p) => !savedIds.includes(p.customerId));
  const editing = pending.find((p) => p.customerId === editingId);

  if (editing) {
    return (
      <BankSkipReasonDialog
        customerId={editing.customerId}
        customerName={showName ? editing.fullName : undefined}
        bankCodes={editing.bankCodes}
        submitLabel="Lưu"
        onBack={directForm ? undefined : () => setEditingId(null)}
        onClose={onClose}
        onSaved={() => {
          toast.ok(`Đã lưu lý do không mở bank ưu tiên của ${editing.fullName}`);
          setSavedIds((ids) => [...ids, editing.customerId]);
          setEditingId(null);
        }}
      />
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Khách chưa có bank ưu tiên"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      {remaining.length === 0 && <SkeletonText lines={2} label="Đang tải lại" />}
      <ul className={styles.list}>
        {remaining.map((p) => (
          <li key={p.customerId} className={styles.item}>
            <p className={styles.message}>{pendingSkipReasonMessage(p, next)}</p>
            <div className={styles.actions}>
              {p.creating.map((account) => (
                <Link key={account.id} href={`/banking/${account.id}`} className="btn btn-secondary" onClick={onClose}>
                  Hoàn thành {account.bankCode}
                </Link>
              ))}
              <Button onClick={() => setEditingId(p.customerId)}>Điền lý do</Button>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
