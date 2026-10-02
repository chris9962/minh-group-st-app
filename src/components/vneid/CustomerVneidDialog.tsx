"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { VneidFormDialog } from "@/components/vneid/VneidFormDialog";
import { fetchVneidRecords } from "@/lib/api/vneid";
import { can, recordInScope, recordVisibility } from "@/lib/permissions";
import { useSession } from "@/store/session";

type Props = {
  customerId: string;
  customerName: string;
  customerDepartmentId?: string | null;
  onClose: () => void;
  onBack?: () => void;
};

/** Mỗi hồ sơ khách đúng một dòng VNeID: đã có thì mở form sửa dòng đó, chưa có thì mở form thêm. */
export function CustomerVneidDialog({
  customerId,
  customerName,
  customerDepartmentId,
  onClose,
  onBack,
}: Props) {
  const user = useSession((s) => s.user);
  const canRead = can(user, "vneid", "view-detail");
  const { data, isPending } = useQuery({
    queryKey: ["vneid", "customer", customerId, "current"],
    queryFn: () =>
      fetchVneidRecords({
        search: "",
        from: "",
        to: "",
        departmentId: "",
        staffId: "",
        customerId,
        task: "",
        page: 0,
        sort: "createdAt",
        dir: "desc",
      }),
    enabled: canRead,
  });

  if (canRead && isPending) return null;

  const existing = data?.rows[0];
  if (existing && !recordInScope(recordVisibility(user, "vneid", "update"), existing))
    return (
      <Dialog
        open
        onClose={onClose}
        title={`Tích hợp VNeID - ${customerName}`}
        footer={<Button onClick={onClose}>Đóng</Button>}
      >
        <p>Khách này đã có dòng VNeID do {existing.createdByName} ghi.</p>
      </Dialog>
    );

  return (
    <VneidFormDialog
      open
      customerId={customerId}
      customerName={customerName}
      customerDepartmentId={customerDepartmentId}
      record={existing}
      onClose={onClose}
      onBack={onBack}
    />
  );
}
