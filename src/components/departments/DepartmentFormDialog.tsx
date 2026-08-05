"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import {
  createDepartment,
  DepartmentForm,
  updateDepartment,
  type DepartmentRow,
} from "@/lib/api/org";
import styles from "./DepartmentFormDialog.module.css";
import { errorMessage, toast } from "@/lib/toast";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là đổi tên, không có thì là lập phòng mới. */
  department?: DepartmentRow | null;
};

/** P-91 · Lập phòng mới / đổi tên phòng. */
export function DepartmentFormDialog({ open, onClose, department }: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(department);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DepartmentForm>({
    resolver: zodResolver(DepartmentForm),
    defaultValues: { name: department?.name ?? "" },
  });

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
      toast.ok(department ? "Đã đổi tên phòng ban" : "Đã tạo phòng ban");
      onClose();
    },
    onError: (e) =>
      toast.fail(errorMessage(e, "Không lưu được phòng ban. Kiểm tra kết nối rồi thử lại.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Đổi tên phòng" : "Thêm phòng ban"}
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

      </form>
    </Dialog>
  );
}
