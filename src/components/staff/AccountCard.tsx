"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { fetchDepartments } from "@/lib/api/departments";
import { fetchStaffMember, resetPassword, setStaffActive } from "@/lib/api/staff";
import { can } from "@/lib/permissions";
import {
  ACTION_LABEL,
  EDITABLE_MODULES,
  MODULE_LABEL,
  ROLE_LABEL,
  SCOPE_LABEL,
  type Permission,
  type Scope,
} from "@/lib/types";
import { useSession } from "@/store/session";
import { StaffFormDialog } from "./StaffFormDialog";
import styles from "./AccountCard.module.css";

/**
 * Thẻ tài khoản trên hồ sơ nhân viên (P-52).
 *
 * Chỉ hiện với người có `quản trị người dùng`. Ẩn thẻ này KHÔNG phải là phân
 * quyền — máy chủ vẫn kiểm lại từng lời gọi.
 */
export function AccountCard({ staffId }: { staffId: string }) {
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);

  const canManage = can(actor, "staff", "create") || can(actor, "staff", "update");

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    staleTime: Infinity,
    enabled: canManage,
  });

  // Hồ sơ tài khoản đi đường riêng với số liệu KPI: hai thứ đổi theo nhịp khác
  // nhau, gộp một lời gọi thì đổi chức vụ cũng phải tải lại cả bảng điểm.
  const { data: staff } = useQuery({
    queryKey: ["staff-one", staffId],
    queryFn: () => fetchStaffMember(staffId),
    enabled: canManage,
  });

  const toggleActive = useMutation({
    mutationFn: (next: boolean) => setStaffActive(staffId, next, actor?.id ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-one", staffId] });
      queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
  });

  const reset = useMutation({
    mutationFn: () => resetPassword(staffId),
    onSuccess: (r) => setNewPassword(r.password),
  });

  if (!canManage || !staff) return null;

  return (
    <SectionCard title="Tài khoản" icon={<KeyRound size={17} />}>
      <dl className={styles.rows}>
        <Row label="Tên đăng nhập" value={staff.username} mono />
        <Row label="Chức vụ" value={ROLE_LABEL[staff.role]} />
        <Row label="Chức danh" value={staff.title || "—"} />
        <Row label="Đơn vị" value={staff.departmentName || "Không thuộc phòng nào"} />
        {staff.manageScope !== "none" && (
          <Row
            label="Quản lý"
            value={
              staff.manageScope === "company"
                ? "Toàn công ty"
                : `${staff.managedDepartmentIds.length} phòng`
            }
          />
        )}
        <Row
          label="Trạng thái"
          value={
            <StatusTag ok={staff.active}>
              {staff.active ? "Đang hoạt động" : "Đã khoá"}
            </StatusTag>
          }
        />
      </dl>

      {staff.permissions.length > 0 && (
        <div className={styles.permissions}>
          <h4 className={styles.permissionsTitle}>Quyền</h4>
          <div className={styles.permissionGroups}>
            {groupPermissionsByModule(staff.permissions).map(({ module, items }) => (
              <div key={module} className={styles.permissionGroup}>
                <span className={styles.permissionModule}>{MODULE_LABEL[module]}</span>
                <div className={styles.permissionScopes}>
                  {groupByScope(items).map(({ scope, actions }) => (
                    <div key={scope} className={styles.scopeGroup}>
                      <span className={`tag ${SCOPE_TAG_CLASS[scope]}`}>{SCOPE_LABEL[scope]}</span>
                      <span className={styles.scopeActions}>
                        {actions.map((a) => ACTION_LABEL[a]).join(", ")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {newPassword && (
        <Alert tone="warning">
          Mật khẩu mới: <strong className="tabular-nums">{newPassword}</strong> — gửi cho
          nhân viên rồi đóng trang. <strong>Chỉ hiện đúng một lần</strong>, không
          xem lại được vì mật khẩu lưu dạng băm một chiều.
        </Alert>
      )}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Sửa
        </Button>
        <Button
          variant="secondary"
          onClick={() => reset.mutate()}
          disabled={reset.isPending}
        >
          Đặt lại mật khẩu
        </Button>
        <Button
          variant="secondary"
          onClick={() => toggleActive.mutate(!staff.active)}
          disabled={toggleActive.isPending}
        >
          {staff.active ? "Khoá tài khoản" : "Mở khoá"}
        </Button>
      </div>

      {!staff.active && (
        <p className={styles.note}>
          Nghỉ việc thì <strong>khoá</strong>, không xoá. Xoá thì mọi bản ghi cũ
          trỏ vào khoảng không và báo cáo tháng trước mất người tạo.
        </p>
      )}

      {editing && (
        <StaffFormDialog
          open
          staff={staff}
          departments={departments}
          onClose={() => setEditing(false)}
        />
      )}
    </SectionCard>
  );
}

/** Đậm dần theo phạm vi rộng dần — cùng một tông cam, không thêm màu mới. */
const SCOPE_TAG_CLASS: Record<Scope, string> = {
  own: styles.scopeOwn,
  managed: styles.scopeManaged,
  company: styles.scopeCompany,
};

/** Gom theo module, module `*` (Giám đốc) lên đầu vì rộng nhất. */
function groupPermissionsByModule(
  permissions: Permission[],
): { module: Permission["module"]; items: Permission[] }[] {
  return (["*", ...EDITABLE_MODULES] as const)
    .map((module) => ({ module, items: permissions.filter((p) => p.module === module) }))
    .filter((g) => g.items.length > 0);
}

/**
 * Gom tiếp theo phạm vi trong một module — nhiều hành động cùng phạm vi thì
 * chỉ hiện "Của tôi" một lần, không lặp lại trên từng tag như trước.
 */
function groupByScope(
  items: Permission[],
): { scope: Scope; actions: Permission["action"][] }[] {
  return (["company", "managed", "own"] as const)
    .map((scope) => ({
      scope,
      actions: items.filter((p) => p.scope === scope).map((p) => p.action),
    }))
    .filter((g) => g.actions.length > 0);
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "tabular-nums" : undefined}>{value}</dd>
    </div>
  );
}
