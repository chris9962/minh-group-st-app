import { History } from "lucide-react";
import { SectionCard } from "@/components/ui/SectionCard";
import { BANK_ACCOUNT_STATUS_LABEL } from "@/lib/api/bankAccounts";
import type { BankAccountStatusStep } from "@/lib/api/banking";
import { formatDateTime } from "@/lib/format";
import styles from "./BankAccountHistory.module.scss";

/**
 * Cùng dòng thời gian ở trang nhân viên và trang đối soát ngân hàng.
 *
 * Dòng có `from = to` là SỰ KIỆN không đổi trạng thái: lượt xác thực ảnh xong,
 * người duyệt xác nhận ảnh. Tiêu đề lấy từ `note`, không in "Hoàn thành →
 * Hoàn thành".
 */
export function BankAccountHistory({ history }: { history: BankAccountStatusStep[] }) {
  return (
    <SectionCard title="Dòng thời gian" icon={<History size={17} />}>
      {history.length === 0 ? (
        <p className="text-muted">Chưa có lịch sử được ghi nhận.</p>
      ) : (
        <ol className={styles.timeline}>
          {history.map((step) => (
            <li key={step.id}>
              <time dateTime={step.changedAt}>{formatDateTime(step.changedAt)}</time>
              {step.fromStatus === step.toStatus ? (
                <span>{step.note}</span>
              ) : (
                <span>
                  {BANK_ACCOUNT_STATUS_LABEL[step.fromStatus]} → {BANK_ACCOUNT_STATUS_LABEL[step.toStatus]}
                </span>
              )}
              <span className={styles.who}>{step.changedByName}</span>
              {step.note && step.fromStatus !== step.toStatus && <p>{step.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
