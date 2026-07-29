"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { fetchDepartments } from "@/lib/api/departments";
import {
  fetchStaff,
  resetPassword,
  setStaffActive,
  type StaffAccount,
} from "@/lib/api/staff";
import { can } from "@/lib/permissions";
import { ROLE_LABEL } from "@/lib/types";
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

  const canManage = can(actor, "system", "manage-users");

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
    queryFn: () =>
      fetchStaff({
        scope: "company",
        departmentId: "",
        search: "",
        status: "all",
        roles: [],
      }).then(
        (r) => r.staff.find((s) => s.id === staffId) ?? null,
      ),
    enabled: canManage,
  });

  const toggleActive = useMutation({
    mutationFn: (next: boolean) => setStaffActive(staffId, next),
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

      {newPassword && (
        <Alert tone="warning">
          Mật khẩu mới: <strong className="so">{newPassword}</strong> — gửi cho
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
      <dd className={mono ? "so" : undefined}>{value}</dd>
    </div>
  );
}
