import { History } from "lucide-react";
import { SectionCard } from "@/components/ui/SectionCard";
import { BANK_ACCOUNT_STATUS_LABEL } from "@/lib/api/bankAccounts";
import type { BankAccountStatusStep } from "@/lib/api/banking";
import { formatDateTime } from "@/lib/format";
import styles from "./BankAccountHistory.module.scss";

/** Cùng dòng thời gian ở trang nhân viên và trang đối soát ngân hàng. */
export function BankAccountHistory({ history }: { history: BankAccountStatusStep[] }) {
  return (
    <SectionCard title="Dòng thời gian đối soát" icon={<History size={17} />}>
      {history.length === 0 ? (
        <p className="text-muted">Chưa có lịch sử được ghi nhận.</p>
      ) : (
        <ol className={styles.timeline}>
          {history.map((step) => (
            <li key={step.id}>
              <time dateTime={step.changedAt}>{formatDateTime(step.changedAt)}</time>
              <span>
                {BANK_ACCOUNT_STATUS_LABEL[step.fromStatus]} → {BANK_ACCOUNT_STATUS_LABEL[step.toStatus]}
              </span>
              <span className={styles.who}>{step.changedByName}</span>
              {step.note && <p>{step.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
