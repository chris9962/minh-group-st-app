"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import {
  createDepartment,
  DepartmentForm,
  updateDepartment,
  type DepartmentRow,
} from "@/lib/api/org";
import styles from "./DepartmentFormDialog.module.css";
import { errorMessage, toast } from "@/lib/toast";
import { DEPARTMENT_TYPE_HINT, DEPARTMENT_TYPE_LABEL, DepartmentType } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là sửa phòng đang có, không có thì là lập phòng mới. */
  department?: DepartmentRow | null;
};

/** P-91 · Lập phòng mới / đổi tên phòng. */
export function DepartmentFormDialog({ open, onClose, department }: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(department);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<DepartmentForm>({
    resolver: zodResolver(DepartmentForm),
    /**
     * Phòng lập mới mặc định là `sales` ở FORM, khác với mặc định `office` của
     * cột trong database. Hai chỗ khác nhau có chủ đích: cột phải chọn giá trị
     * an toàn cho mọi đường ghi không đi qua màn này, còn ở P-91 thì người dùng
     * ĐANG NHÌN ô chọn và đọc được câu giải thích dưới nó — mà phòng lập mới
     * hầu hết là phòng kinh doanh.
     */
    defaultValues: { name: department?.name ?? "", type: department?.type ?? "sales" },
  });

  const type = watch("type");

  const save = useMutation({
    mutationFn: (form: DepartmentForm) =>
      department ? updateDepartment(department.id, form) : createDepartment(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-departments"] });
      // Ô lọc của P-51 và ô chọn đơn vị của form nhân viên đi bằng khoá riêng.
      // Không dọn nó thì lập phòng mới xong vào P-51 vẫn không thấy phòng đó.
      queryClient.invalidateQueries({ queryKey: ["departments"] });
      // Trang chi tiết giữ khoá riêng theo id. Bỏ sót thì đổi tên xong quay lại
      // trang đó vẫn thấy tên cũ suốt `staleTime` (30 giây), không refetch.
      if (department)
        queryClient.invalidateQueries({ queryKey: ["org-department", department.id] });
      toast.ok(department ? "Đã lưu phòng ban" : "Đã tạo phòng ban");
      onClose();
    },
    onError: (e) =>
      toast.fail(errorMessage(e, "Không lưu được phòng ban. Kiểm tra kết nối rồi thử lại.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Sửa phòng ban" : "Thêm phòng ban"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="department-form"
            disabled={isSubmitting || save.isPending}
          >
            {editing ? "Lưu" : "Tạo phòng ban"}
          </Button>
        </>
      }
    >
      <form
        id="department-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        <TextField
          label="Tên phòng"
          placeholder="Phòng Kinh doanh 10"
          error={errors.name?.message}
          {...register("name")}
        />

        <Select
          label="Loại phòng"
          block
          required
          value={type}
          onChange={(v) => setValue("type", v as DepartmentType, { shouldDirty: true })}
          error={errors.type?.message}
          hint={DEPARTMENT_TYPE_HINT[type]}
          options={DepartmentType.options.map((t) => ({
            value: t,
            label: DEPARTMENT_TYPE_LABEL[t],
          }))}
        />
      </form>
    </Dialog>
  );
}
