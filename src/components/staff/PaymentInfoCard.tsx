"use client";

import { useQuery } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { fetchStaffPayment } from "@/lib/api/staffPayment";
import { useSession } from "@/store/session";
import { PaymentInfoDialog } from "./PaymentInfoDialog";
import styles from "./PaymentInfoCard.module.scss";

/**
 * Tab Thông tin thanh toán ở hồ sơ nhân viên (P-52). Nơi dùng chỉ dựng thẻ cho
 * người có quyền chốt lương. Người đó mở hồ sơ của chính mình thì chỉ xem, máy
 * chủ cũng chặn tự sửa.
 */
export function PaymentInfoCard({ staffId }: { staffId: string }) {
  const actor = useSession((s) => s.user);
  const [editing, setEditing] = useState(false);
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["staff-payment", staffId],
    queryFn: () => fetchStaffPayment(staffId),
  });

  const icon = <Landmark size={17} />;
  if (isPending)
    return (
      <SectionCard title="Thông tin thanh toán" icon={icon}>
        <SkeletonCard lines={3} />
      </SectionCard>
    );
  if (isError)
    return (
      <SectionCard title="Thông tin thanh toán" icon={icon}>
        <ErrorState what="thông tin thanh toán" onRetry={refetch} retrying={isFetching} />
      </SectionCard>
    );

  return (
    <SectionCard title="Thông tin thanh toán" icon={icon}>
      <dl className={styles.rows}>
        <div>
          <dt>Số tài khoản</dt>
          <dd className="tabular-nums">{data.bankAccountNumber || "—"}</dd>
        </div>
        <div>
          <dt>Ngân hàng nhận</dt>
          <dd>{data.bankName || "—"}</dd>
        </div>
        <div>
          <dt>Mã ngân hàng</dt>
          <dd className="tabular-nums">{data.bankCode || "—"}</dd>
        </div>
      </dl>

      {actor?.id !== staffId && (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Sửa
          </Button>
        </div>
      )}

      {editing && <PaymentInfoDialog staffId={staffId} payment={data} onClose={() => setEditing(false)} />}
    </SectionCard>
  );
}
