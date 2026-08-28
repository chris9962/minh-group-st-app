"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { CharCount } from "@/components/ui/CharCount";
import { CopyButton } from "@/components/ui/CopyValue";
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
import { removeDiacritics } from "@/lib/format";
import { assignableRoles, isFullAccess } from "@/lib/permissions";
import { ROLE_LABEL, ROLE_TITLE, type Department } from "@/lib/types";
import { ROLE_PERMISSIONS } from "@/lib/roles";
import { useSession } from "@/store/session";
import { PermissionsEditor } from "./PermissionsEditor";
import styles from "./StaffFormDialog.module.scss";
import { errorMessage, toast } from "@/lib/toast";
import { reportInvalid } from "@/lib/formErrors";

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
  permissions: ROLE_PERMISSIONS.staff,
};

/** Chức vụ nào nhìn được tới đâu — nói thẳng, vì người tạo không còn ô nào để chọn. */
/**
 * Tên đăng nhập gợi ý LÀ mã nhân viên viết thường: `001THAODV` ra `001thaodv`.
 *
 * Mã nhân viên đã duy nhất trong công ty nên gợi ý không bao giờ đụng nhau —
 * khác hẳn cách cũ (chữ đầu mỗi từ của họ tên), vốn cho ba người tên Nguyễn Thị
 * Tường Vy chung một `mg-nttv`. Người dùng cũng chỉ phải nhớ một chuỗi.
 *
 * Bỏ ký tự `StaffForm` không nhận, giữ lại `. _ -` vì mã có thể mang dấu nối.
 */
function usernameFrom(staffCode: string): string {
  return removeDiacritics(staffCode).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

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
  permissions: s.permissions,
});

/** P-53 · Tạo / sửa nhân viên. */
export function StaffFormDialog({ open, onClose, staff, departments }: Props) {
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const editing = Boolean(staff);
  /**
   * Thông tin đăng nhập vừa cấp. Khác `null` thì hộp thoại đổi hẳn nội dung.
   *
   * Không đóng ngay sau khi tạo: mật khẩu khởi tạo hiện đúng MỘT lần, đóng luôn
   * là người tạo phải vào hồ sơ bấm "Đặt lại mật khẩu" để có mật khẩu khác.
   */
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  /** Tên đăng nhập tự sinh gần nhất — mốc để biết người tạo đã tự gõ hay chưa. */
  const suggestedUsername = useRef("");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<StaffForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    // Chuẩn hoá NGAY LÚC MỞ, không chỉ lúc gửi: hồ sơ cũ có thể mang trạng thái
    // mà luật mới cấm, và ô sửa nó lại đang ẩn theo chức vụ — người dùng nhận
    // câu lỗi không có đường chữa.
    resolver: zodResolver(StaffForm),
    // Người mới mặc định vào ĐÚNG phòng của người đang tạo. Trưởng phòng và Phó
    // phòng chỉ tạo được người trong phòng mình, nên bỏ trống ô đó là bắt họ
    // chọn lại đúng một đáp án mỗi lần. Ban giám đốc không thuộc phòng nào thì
    // ô vẫn trống như cũ.
    defaultValues: staff
      ? normalizeStaffForm(toForm(staff))
      : { ...emptyForm, departmentId: actor?.departmentId ?? "" },
  });

  const roles = assignableRoles(actor);
  const managed = watch("managedDepartmentIds");
  const shape = ROLE_SHAPE[watch("role")];

  /**
   * Chỉ Phó giám đốc mới tích tay. Trưởng phòng và Phó phòng suy ra từ ô Đơn vị
   * nên bày ô tích ra là hỏi một câu đã có đáp án — người tạo tưởng phải tự tích.
   *
   * Vế sau giữ khối lại cho vai Nhân viên: `normalizeStaffForm` không đụng tới
   * vai đó (`manages: 'free'`), nên hồ sơ cũ còn phòng phụ trách mà ẩn khối đi
   * thì không ai gỡ được nữa. Ba vai kia được ghi đè lúc lưu, ẩn vẫn đúng.
   */
  const picksManaged = shape.manages === "listed" || (shape.manages === "free" && managed.length > 0);

  const permissions = watch("permissions");
  /**
   * Bộ quyền Giám đốc là 15 dòng module `*`, mỗi dòng phủ MỌI module. Đếm dòng
   * thì ra số nhỏ hơn Trưởng phòng (32 dòng lẻ) trong khi quyền rộng hơn hẳn.
   */
  const fullAccess = isFullAccess(permissions);

  const save = useMutation({
    /**
     * Trả thông tin đăng nhập ở lượt tạo, `null` ở lượt sửa.
     *
     * Nắn về đây chứ không trả thẳng hai kiểu bản ghi: `StaffCreated` nới rộng
     * `StaffAccount` nên TypeScript gộp union lại làm một, và `"password" in r`
     * chỉ ra `unknown`.
     */
    mutationFn: async (form: StaffForm) => {
      const body = normalizeStaffForm(form);
      if (staff) {
        await updateStaff(staff.id, body, actor?.id ?? "");
        return null;
      }
      const account = await createStaff(body, actor?.id ?? "");
      return { username: account.username, password: account.password };
    },
    onSuccess: (credentials) => {
      // Ba khoá riêng biệt, bỏ sót cái nào thì sửa xong chức vụ mà chỗ đó vẫn
      // hiện giá trị cũ suốt 30 giây, người dùng tưởng lưu hỏng và lưu lại.
      // `["staff"]` là bảng P-51, `["staff-one", id]` là `AccountCard`,
      // `["person"]` là hồ sơ điểm P-52.
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      if (staff) queryClient.invalidateQueries({ queryKey: ["staff-one", staff.id] });
      queryClient.invalidateQueries({ queryKey: ["person"] });
      if (!credentials) {
        toast.ok("Đã lưu hồ sơ nhân viên");
        onClose();
        return;
      }
      // KHÔNG toast rồi đóng: mật khẩu phải ở lại cho người tạo chép. Toast tự
      // tắt sau 5 giây, cùng lối nghĩ với nút Đặt lại mật khẩu ở `AccountCard`.
      setCreated(credentials);
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
      title={created ? "Đã tạo tài khoản" : editing ? "Sửa nhân viên" : "Thêm nhân viên"}
      footer={
        created ? (
          <Button onClick={onClose}>Đóng</Button>
        ) : (
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
        )
      }
    >
      {created ? (
        <div className={styles.created}>
          <Alert tone="warning">
            <strong>Mật khẩu chỉ hiện một lần.</strong> Chép và gửi cho nhân viên
            trước khi đóng. Lỡ đóng thì vào hồ sơ của họ, bấm “Đặt lại mật khẩu”.
          </Alert>
          <dl className={styles.credentials}>
            <dt>Tên đăng nhập</dt>
            <dd className={styles.credentialValue}>{created.username}</dd>
            <dt>Mật khẩu</dt>
            <dd className={styles.credentialValue}>{created.password}</dd>
          </dl>
          {/* Một nút chép cả hai dòng: người tạo dán thẳng vào tin nhắn gửi
              nhân viên, không phải chép hai lượt rồi tự gõ lại nhãn. */}
          <CopyButton
            value={`Tên đăng nhập: ${created.username}\nMật khẩu: ${created.password}`}
            label="tên đăng nhập và mật khẩu"
          >
            Chép cả hai
          </CopyButton>
          <p className={styles.createdNote}>
            Nhân viên đăng nhập rồi tự đổi mật khẩu ở màn Thông tin cá nhân.
          </p>
        </div>
      ) : (
      <form
        id="staff-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
        noValidate
      >
        <TextField
          label="Họ tên"
          required
          placeholder="Nguyễn Văn An"
          error={errors.fullName?.message}
          {...register("fullName")}
        />

        <div className={styles.pair}>
          <TextField
            label="Mã nhân viên"
            required
            placeholder="001THAODV"
            error={errors.staffCode?.message}
            autoComplete="off"
            {...register("staffCode", {
              // Tên đăng nhập đi theo mã nhân viên, nhưng CHỈ khi người tạo chưa
              // tự gõ: còn nguyên gợi ý của lần gõ trước thì thay, đã sửa thành
              // "nv13" rồi thì để yên. Sửa hồ sơ cũ thì không đụng — đổi tên
              // đăng nhập của người đang dùng là họ không đăng nhập được nữa.
              onChange: (e) => {
                if (editing) return;
                const current = getValues("username").trim();
                if (current !== "" && current !== suggestedUsername.current) return;
                const next = usernameFrom(e.target.value);
                suggestedUsername.current = next;
                setValue("username", next, { shouldDirty: true });
              },
            })}
          />
          <TextField
            label="Số điện thoại"
            required
            placeholder="0912345678"
            inputMode="numeric"
            maxLength={10}
            labelAppend={<CharCount value={watch("phone")} max={10} />}
            error={errors.phone?.message}
            {...register("phone")}
          />
        </div>

        <TextField
          label="Tên đăng nhập"
          required
          placeholder="001thaodv"
          hint="Tự sinh từ mã nhân viên, sửa lại được"
          error={errors.username?.message}
          autoComplete="off"
          {...register("username")}
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
              // `normalizeStaffForm` cố ý không đụng vai Nhân viên, nên phòng
              // phụ trách của vai vừa bỏ còn nguyên. Lúc TẠO MỚI không có hồ sơ
              // cũ nào để giữ — xoá đi, không thì ô tích hiện ra và người tạo
              // phải tự bỏ tích từng phòng.
              const dropManaged = !editing && ROLE_SHAPE[role].manages === "free";
              setValue("departmentId", next.departmentId, { shouldDirty: true });
              setValue("manageScope", dropManaged ? "none" : next.manageScope, { shouldDirty: true });
              setValue(
                "managedDepartmentIds",
                dropManaged ? [] : next.managedDepartmentIds,
                { shouldDirty: true },
              );
            }}
            options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          />
        </div>

        <TextField
          label="Chức danh hiển thị"
          required
          placeholder={ROLE_TITLE[watch("role")]}
          error={errors.title?.message}
          {...register("title")}
        />

        {picksManaged && (
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
        )}

        {/* Sửa hồ sơ CHÍNH MÌNH thì không có thẻ Quyền. Cắt quyền một người mà
            họ tự bấm lại là xong thì việc cắt vô nghĩa. Máy chủ cũng chặn
            (`updateStaff`) — ẩn ở đây chỉ để khỏi bày ra thứ bấm không ăn. */}
        {staff?.id !== actor?.id && (
          /* Đóng sẵn: lưới quyền là phần dài nhất hộp thoại, mà phần lớn lượt
             tạo giữ nguyên bộ quyền mặc định của chức vụ. Dùng `details` chứ
             không tự dựng bằng div: bàn phím và trình đọc màn hình có sẵn. */
          <details className={styles.collapsible}>
            <summary>
              <ChevronRight size={16} className={styles.chevron} aria-hidden />
              Quyền
              <span className={styles.collapsibleCount}>
                {fullAccess ? "Toàn quyền" : `${permissions.length} quyền`}
              </span>
            </summary>
            <div className={styles.collapsibleBody}>
              {/*
                Lưới cấp lẻ hiện CẢ khi đang toàn quyền, chỉ khoá lại. Bản trước
                thay nó bằng một câu thông báo, nên muốn cắt bớt quyền của tài
                khoản toàn quyền thì phải đổi chức vụ trước rồi mới tích lại —
                đường vòng không ai đoán ra. Nay công tắc ở đầu lưới bật/tắt
                thẳng, tắt là trả lại đúng bộ quyền lẻ trước đó.
              */}
              <PermissionsEditor
                value={permissions}
                onChange={(permissions) =>
                  setValue("permissions", permissions, { shouldDirty: true })
                }
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
            </div>
          </details>
        )}
      </form>
      )}
    </Dialog>
  );
}
