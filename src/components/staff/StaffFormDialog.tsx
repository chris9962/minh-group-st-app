"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import {
  createStaff,
  SAVE_ERROR,
  StaffForm,
  updateStaff,
  type SaveError,
  type StaffAccount,
} from "@/lib/api/staff";
import { assignableRoles } from "@/lib/permissions";
import { ROLE_LABEL, type Department } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./StaffFormDialog.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là sửa, không có thì là tạo mới. */
  staff?: StaffAccount | null;
  departments: Department[];
};

const emptyForm: StaffForm = {
  fullName: "",
  username: "",
  phone: "",
  departmentId: "",
  role: "staff",
  title: "Nhân viên kinh doanh",
  manageScope: "none",
  managedDepartmentIds: [],
  wardId: "",
};

const toForm = (s: StaffAccount): StaffForm => ({
  fullName: s.fullName,
  username: s.username,
  phone: s.phone,
  departmentId: s.departmentId ?? "",
  role: s.role,
  title: s.title,
  manageScope: s.manageScope,
  managedDepartmentIds: s.managedDepartmentIds,
  wardId: s.wardId ?? "",
});

const isSaveError = (e: unknown): e is SaveError =>
  typeof e === "object" && e !== null && "code" in e;

/** P-53 · Tạo / sửa nhân viên. */
export function StaffFormDialog({ open, onClose, staff, departments }: Props) {
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const editing = Boolean(staff);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<StaffForm>({
    resolver: zodResolver(StaffForm),
    defaultValues: staff ? toForm(staff) : emptyForm,
  });

  const roles = assignableRoles(actor);
  const manageScope = watch("manageScope");
  const managed = watch("managedDepartmentIds");

  const save = useMutation({
    mutationFn: (form: StaffForm) =>
      staff
        ? updateStaff(staff.id, form, actor?.id ?? "")
        : createStaff(form, actor?.id ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["person"] });
      onClose();
    },
  });

  const failure = isSaveError(save.error) ? save.error : null;

  const toggleManaged = (id: string) =>
    setValue(
      "managedDepartmentIds",
      managed.includes(id) ? managed.filter((x) => x !== id) : [...managed, id],
      { shouldDirty: true },
    );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Sửa nhân viên" : "Thêm nhân viên"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="staff-form"
            disabled={isSubmitting || save.isPending}
          >
            {editing ? "Lưu" : "Tạo nhân viên"}
          </Button>
        </>
      }
    >
      <form
        id="staff-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        {failure && <Alert tone="error">{failure.message}</Alert>}

        <TextField
          label="Họ tên"
          error={errors.fullName?.message}
          {...register("fullName")}
        />

        <div className={styles.pair}>
          <TextField
            label="Tên đăng nhập"
            hint="Chữ thường không dấu"
            error={errors.username?.message}
            autoComplete="off"
            {...register("username")}
          />
          <TextField
            label="Số điện thoại"
            inputMode="numeric"
            error={errors.phone?.message}
            {...register("phone")}
          />
        </div>

        <div className={styles.pair}>
          <Select
            label="Đơn vị"
            value={watch("departmentId")}
            onChange={(v) => setValue("departmentId", v, { shouldDirty: true })}
            options={[
              { value: "", label: "Không thuộc phòng nào" },
              ...departments.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
          <Select
            label="Chức vụ"
            value={watch("role")}
            onChange={(v) =>
              setValue("role", v as StaffForm["role"], { shouldDirty: true })
            }
            options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          />
        </div>

        {roles.length > 0 && roles.length < 5 && (
          <p className={styles.note}>
            Danh sách chức vụ chỉ có những vai <strong>không vượt quá quyền của
            bạn</strong>. Cần gán vai cao hơn thì nhờ người có quyền cấp quyền.
          </p>
        )}

        <TextField
          label="Chức danh hiển thị"
          hint='Ví dụ "Phó Giám Đốc 2" — khác với chức vụ ở trên'
          error={errors.title?.message}
          {...register("title")}
        />

        <Select
          label="Quản lý phòng"
          value={manageScope}
          onChange={(v) =>
            setValue("manageScope", v as StaffForm["manageScope"], {
              shouldDirty: true,
            })
          }
          options={[
            { value: "none", label: "Không quản phòng nào" },
            { value: "listed", label: "Quản một số phòng" },
            { value: "company", label: "Quản toàn công ty" },
          ]}
        />

        {manageScope === "listed" && (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Phòng phụ trách</legend>
            <div className={styles.checks}>
              {departments.map((d) => (
                <label key={d.id} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={managed.includes(d.id)}
                    onChange={() => toggleManaged(d.id)}
                  />
                  {d.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {editing && (
          <Alert tone="warning">
            Đổi đơn vị <strong>không viết lại lịch sử</strong>. Bản ghi cũ vẫn
            thuộc phòng lúc tạo, nên báo cáo các tháng trước không đổi theo.
          </Alert>
        )}
      </form>
    </Dialog>
  );
}
