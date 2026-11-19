import { Clock, ClipboardList, FileClock, FileWarning, FileX2, Pencil, Send } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  notificationPeople,
  notificationTakesGroups,
  ZALO_NOTIFICATION_SCHEDULE,
  ZALO_NOTIFICATION_TITLE,
  type ZaloNotificationKind,
  type ZaloNotificationRoute,
} from "@/lib/api/zaloBot";
import { RecipientChip } from "./RecipientChip";
import styles from "./NotificationCard.module.scss";

const ICON: Record<ZaloNotificationKind, typeof Clock> = {
  "insurance-certificate-overdue": FileClock,
  "pgd-daily-report": ClipboardList,
  "pvi-cancel-report": FileX2,
  "pvi-cancel-missed": FileWarning,
};

type Props = {
  route: ZaloNotificationRoute;
  onEdit: () => void;
  onSend: () => void;
};

export function NotificationCard({ route, onEdit, onSend }: Props) {
  const titleId = useId();
  const Icon = ICON[route.kind];
  const people = notificationPeople(route.kind);
  const takesGroups = notificationTakesGroups(route.kind);
  const peopleCount = route.pgds.length + route.phones.length;
  const active = route.groups.length + peopleCount > 0;

  return (
    <article className={styles.card} aria-labelledby={titleId}>
      <header className={styles.head}>
        <span className={styles.icon}>
          <Icon size={17} aria-hidden />
        </span>
        <div className={styles.heading}>
          <h3 id={titleId} className={styles.title}>
            {ZALO_NOTIFICATION_TITLE[route.kind]}
          </h3>
          <p className={styles.schedule}>
            <Clock size={13} aria-hidden />
            {ZALO_NOTIFICATION_SCHEDULE[route.kind]}
          </p>
        </div>
        <StatusTag tone={active ? "ok" : "neutral"}>{active ? "Đang bật" : "Chưa có nơi nhận"}</StatusTag>
      </header>

      <dl className={styles.recipients}>
        {takesGroups && (
          <div className={styles.recipientRow}>
            <dt className={styles.recipientLabel}>Nhóm</dt>
            <dd className={styles.chips}>
              {route.groups.length === 0 ? (
                <span className={styles.empty}>Chưa chọn</span>
              ) : (
                route.groups.map((g) => <RecipientChip key={g.id} type="group" name={g.name} />)
              )}
            </dd>
          </div>
        )}
        {people && (
          <div className={styles.recipientRow}>
            <dt className={styles.recipientLabel}>{people === "pgd" ? "Phó giám đốc" : "Người nhận"}</dt>
            <dd className={styles.chips}>
              {peopleCount === 0 ? (
                <span className={styles.empty}>Chưa chọn</span>
              ) : (
                <>
                  {route.pgds.map((p) => (
                    <RecipientChip key={p.id} type="person" name={p.name} phone={p.phone} />
                  ))}
                  {route.phones.map((p) => (
                    <RecipientChip key={p.phone} type="phone" name={p.name} phone={p.phone} />
                  ))}
                </>
              )}
            </dd>
          </div>
        )}
      </dl>

      <footer className={styles.actions}>
        {active && (
          <Button variant="ghost" onClick={onSend}>
            <Send size={16} aria-hidden />
            Gửi ngay
          </Button>
        )}
        <Button variant="secondary" onClick={onEdit}>
          <Pencil size={16} aria-hidden />
          Sửa nơi nhận
        </Button>
      </footer>
    </article>
  );
}
