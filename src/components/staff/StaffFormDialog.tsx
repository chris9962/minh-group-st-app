"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import {
  createStaff,
  normalizeStaffForm,
  ROLE_SHAPE,
  StaffForm,
  updateStaff,
  type StaffAccount,
} from "@/lib/api/staff";
import { assignableRoles } from "@/lib/permissions";
import { ROLE_LABEL, ROLE_TITLE, type Department } from "@/lib/types";
import { ROLE_PERMISSIONS } from "@/lib/roles";
import { useSession } from "@/store/session";
import { PermissionsEditor } from "./PermissionsEditor";
import styles from "./StaffFormDialog.module.scss";
import { errorMessage, toast } from "@/lib/toast";

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
  staffCode: "",
  phone: "",
  departmentId: "",
  role: "staff",
  title: ROLE_TITLE.staff,
  manageScope: "none",
  managedDepartmentIds: [],
  wardId: "",
  permissions: ROLE_PERMISSIONS.staff,
};

/** Chức vụ nào nhìn được tới đâu — nói thẳng, vì người tạo không còn ô nào để chọn. */
const SCOPE_NOTE: Record<StaffForm["role"], string> = {
  director: "Giám đốc xem được bản ghi của toàn công ty.",
  "deputy-director": "",
  head: "Trưởng phòng xem được bản ghi của đúng đơn vị mình thuộc về.",
  "deputy-head": "Phó phòng xem được bản ghi của đúng đơn vị mình thuộc về.",
  staff: "Nhân viên xem được bản ghi do chính mình tạo.",
};

const toForm = (s: StaffAccount): StaffForm => ({
  fullName: s.fullName,
  username: s.username,
  staffCode: s.staffCode ?? "",
  phone: s.phone,
  departmentId: s.departmentId ?? "",
  role: s.role,
  title: s.title,
  manageScope: s.manageScope,
  managedDepartmentIds: s.managedDepartmentIds,
  wardId: s.wardId ?? "",
  permissions: s.permissions,
});

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
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<StaffForm>({
    // Chuẩn hoá NGAY LÚC MỞ, không chỉ lúc gửi: hồ sơ cũ có thể mang trạng thái
    // mà luật mới cấm, và ô sửa nó lại đang ẩn theo chức vụ — người dùng nhận
    // câu lỗi không có đường chữa.
    resolver: zodResolver(StaffForm),
    defaultValues: staff ? normalizeStaffForm(toForm(staff)) : emptyForm,
  });

  const roles = assignableRoles(actor);
  const managed = watch("managedDepartmentIds");
  const shape = ROLE_SHAPE[watch("role")];

  const save = useMutation({
    mutationFn: (form: StaffForm) => {
      const body = normalizeStaffForm(form);
      return staff
        ? updateStaff(staff.id, body, actor?.id ?? "")
        : createStaff(body, actor?.id ?? "");
    },
    onSuccess: () => {
      // Ba khoá riêng biệt, bỏ sót cái nào thì sửa xong chức vụ mà chỗ đó vẫn
      // hiện giá trị cũ suốt 30 giây, người dùng tưởng lưu hỏng và lưu lại.
      // `["staff"]` là bảng P-51, `["staff-one", id]` là `AccountCard`,
      // `["person"]` là hồ sơ điểm P-52.
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      if (staff) queryClient.invalidateQueries({ queryKey: ["staff-one", staff.id] });
      queryClient.invalidateQueries({ queryKey: ["person"] });
      toast.ok(staff ? "Đã lưu hồ sơ nhân viên" : "Đã thêm nhân viên");
      onClose();
    },
    onError: (e) =>
      toast.fail(errorMessage(e, "Không lưu được hồ sơ. Kiểm tra kết nối rồi thử lại.")),
  });

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
        <TextField
          label="Họ tên"
          placeholder="Nguyễn Văn An"
          error={errors.fullName?.message}
          {...register("fullName")}
        />

        <div className={styles.pair}>
          <TextField
            label="Tên đăng nhập"
            placeholder="nv13"
            hint="Chữ thường không dấu"
            error={errors.username?.message}
            autoComplete="off"
            {...register("username")}
          />
          <TextField
            label="Số điện thoại"
            placeholder="0912345678"
            inputMode="numeric"
            error={errors.phone?.message}
            {...register("phone")}
          />
        </div>

        <TextField
          label="Mã nhân viên"
          placeholder="MG-0123"
          hint="Định danh nhân viên ở hệ thống khác của công ty — không được trùng"
          error={errors.staffCode?.message}
          autoComplete="off"
          {...register("staffCode")}
        />

        <div className={styles.pair}>
          <Select
            label="Đơn vị"
            value={watch("departmentId")}
            disabled={!shape.department}
            error={errors.departmentId?.message}
            onChange={(v) => {
              setValue("departmentId", v, { shouldDirty: true });
              // Trưởng phòng và Phó phòng nhìn đúng đơn vị mình thuộc về, nên
              // đổi đơn vị là đổi luôn phạm vi nhìn.
              if (shape.manages === "own-department")
                setValue("managedDepartmentIds", v ? [v] : [], { shouldDirty: true });
            }}
            options={[
              { value: "", label: "Không thuộc phòng nào" },
              ...departments.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
          <Select
            label="Chức vụ"
            value={watch("role")}
            onChange={(v) => {
              const previous = getValues("role");
              const role = v as StaffForm["role"];
              setValue("role", role, { shouldDirty: true });

              // Chức danh đi theo chức vụ, nhưng CHỈ khi người dùng chưa tự gõ
              // gì — còn nguyên gợi ý của vai trước thì thay, đã sửa thành
              // "Cố vấn cao cấp" rồi thì để yên. Không có nhánh này thì mọi
              // người tạo mới đều mang chức danh của vai mặc định: trong DB
              // đang có một Trưởng phòng ghi "Nhân viên kinh doanh".
              const currentTitle = getValues("title").trim();
              if (!editing && (currentTitle === "" || currentTitle === ROLE_TITLE[previous])) {
                setValue("title", ROLE_TITLE[role], { shouldDirty: true });
              }
              // Chỉ tự điền lại quyền khi TẠO MỚI — sửa người đã có thì giữ
              // nguyên quyền hiện tại, đổi chức vụ không được xoá mất phần
              // admin đã cấp thêm riêng cho người đó.
              if (!editing) {
                setValue("permissions", ROLE_PERMISSIONS[role], { shouldDirty: true });
              }
              // Đơn vị và phòng phụ trách suy ra từ chức vụ, người dùng không
              // tích tay. Bỏ bước này thì Trưởng phòng mới lập giữ nguyên
              // `manageScope: none` và thấy 0 bản ghi.
              const next = normalizeStaffForm({ ...getValues(), role });
              setValue("departmentId", next.departmentId, { shouldDirty: true });
              setValue("manageScope", next.manageScope, { shouldDirty: true });
              setValue("managedDepartmentIds", next.managedDepartmentIds, { shouldDirty: true });
            }}
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
          placeholder={ROLE_TITLE[watch("role")]}
          error={errors.title?.message}
          {...register("title")}
        />

        {/* Chỉ Phó giám đốc mới cần người tạo tích phòng. Ba chức vụ kia suy ra
            được từ chức vụ cộng ô Đơn vị, nên khối này ẩn đi — bày ra một ô có
            đúng một đáp án là mời người dùng chọn sai.
            `managed.length > 0` giữ khối lại cho hồ sơ cũ đang phụ trách phòng
            mà chức vụ không đòi: ẩn đi thì không ai gỡ được nữa. */}
        {shape.manages === "listed" || managed.length > 0 ? (
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
            {errors.managedDepartmentIds?.message && (
              <p className={styles.error} role="alert">
                {errors.managedDepartmentIds.message}
              </p>
            )}
          </fieldset>
        ) : (
          <p className={styles.note}>{SCOPE_NOTE[watch("role")]}</p>
        )}

        {/* Sửa hồ sơ CHÍNH MÌNH thì không có thẻ Quyền. Cắt quyền một người mà
            họ tự bấm lại là xong thì việc cắt vô nghĩa. Máy chủ cũng chặn
            (`updateStaff`) — ẩn ở đây chỉ để khỏi bày ra thứ bấm không ăn. */}
        {staff?.id !== actor?.id && (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Quyền</legend>
            <p className={styles.note}>
              Đã điền sẵn theo chức vụ — sửa riêng từng ô nếu người này cần thêm
              hoặc bớt quyền so với chức vụ chung. Chỉ chọn được tới đúng phạm vi
              bạn đang có, không cấp vượt quá quyền của chính bạn.
            </p>
            <PermissionsEditor
              value={watch("permissions")}
              onChange={(permissions) => setValue("permissions", permissions, { shouldDirty: true })}
              actor={actor}
            />
            <Button
              variant="secondary"
              type="button"
              className={styles.resetPermissions}
              onClick={() =>
                setValue("permissions", ROLE_PERMISSIONS[watch("role")], { shouldDirty: true })
              }
            >
              Đặt lại theo chức vụ
            </Button>
          </fieldset>
        )}
      </form>
    </Dialog>
  );
}
