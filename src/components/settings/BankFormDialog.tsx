"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import {
  ACCOUNT_NUMBER_METHOD_LABEL,
  AccountNumberMethod,
  BankForm,
  createBank,
  fetchBankManagerOptions,
  updateBank,
  type Bank,
} from "@/lib/api/bankCatalog";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import styles from "./BankFormDialog.module.scss";
import { errorMessage, toast } from "@/lib/toast";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là sửa, không có thì là thêm ngân hàng mới. */
  bank?: Bank | null;
};

/** P-60 · Lập / sửa một dòng ngân hàng. */
export function BankFormDialog({ open, onClose, bank }: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(bank);
  const actor = useSession((s) => s.user);

  /**
   * Chỉ người có `grant-permission` giao được ngân hàng cho ai (chốt 2026-08-24).
   *
   * Người quản một ngân hàng KHÔNG tự thêm người vào ngân hàng mình quản — đó
   * là đường tự nới quyền. Máy chủ giữ nguyên danh sách cũ nếu người khác gửi
   * lên, ô này ẩn đi cho khớp.
   */
  const canAssign = can(actor, "system", "grant-permission");

  const { data: managerOptions = [] } = useQuery({
    queryKey: ["bank-manager-options"],
    queryFn: fetchBankManagerOptions,
    enabled: canAssign,
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BankForm>({
    resolver: zodResolver(BankForm),
    defaultValues: {
      code: bank?.code ?? "",
      requiredPhotos: bank?.requiredPhotos ?? 3,
      accountNumberMethod: bank?.accountNumberMethod ?? "phone-match",
      countsAsApp: bank?.countsAsApp ?? true,
      priority: bank?.priority ?? 0,
      managerIds: bank?.managerIds ?? [],
    },
  });

  const save = useMutation({
    mutationFn: (form: BankForm) => (bank ? updateBank(bank.id, form) : createBank(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["banks"] });
      // Mã ngân hàng được nhúng sẵn vào từng dòng của các màn này, đổi mã
      // mà không nạp lại thì chúng hiện mã cũ cho tới khi cache hết hạn.
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
      queryClient.invalidateQueries({ queryKey: ["referral-code-options"] });
      onClose();
      toast.ok("Đã lưu ngân hàng");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được ngân hàng này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Sửa ngân hàng" : "Thêm ngân hàng"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="bank-form" disabled={isSubmitting || save.isPending}>
            {editing ? "Lưu" : "Tạo ngân hàng"}
          </Button>
        </>
      }
    >
      <form
        id="bank-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        {/* Khoá khi sửa: mã là danh tính, file luật theo kỳ khớp bằng chính
            chuỗi này. Đổi nó là xếp lại hạng cho mọi tài khoản đã ghi từ trước.
            Máy chủ cũng không ghi `code` khi cập nhật — xem `updateBank`. */}
        <TextField
          label="Mã ngân hàng"
          placeholder="VPa"
          disabled={editing}
          hint={editing ? "Mã không đổi được sau khi tạo — luật tính điểm và quà khớp theo mã này." : undefined}
          error={errors.code?.message}
          {...register("code")}
        />

        <div className={styles.pair}>
          <TextField
            label="Số ảnh bắt buộc"
            type="number"
            inputMode="numeric"
            error={errors.requiredPhotos?.message}
            {...register("requiredPhotos", { valueAsNumber: true })}
          />

          <TextField
            label="Độ ưu tiên"
            type="number"
            inputMode="numeric"
            min={0}
            hint="Số lớn lên đầu ô chọn lúc mở tài khoản. 0 là mức thường."
            error={errors.priority?.message}
            {...register("priority", { valueAsNumber: true })}
          />
        </div>

        <Select
          block
          label="Cách lấy số tài khoản"
          value={watch("accountNumberMethod")}
          onChange={(v) =>
            setValue("accountNumberMethod", v as AccountNumberMethod, { shouldDirty: true })
          }
          options={Object.entries(ACCOUNT_NUMBER_METHOD_LABEL).map(([value, label]) => ({
            value,
            label,
          }))}
        />

        <Checkbox
          label="Có đi kèm app (tính vào tổng app xét quà)"
          checked={watch("countsAsApp")}
          onCheckedChange={(v) => setValue("countsAsApp", v, { shouldDirty: true })}
        />

        {canAssign && (
          /*
            Danh sách chỉ gồm người ĐÃ có quyền "Quản lý ngân hàng" — bày cả
            danh bạ ra thì tick xong vẫn không có tác dụng gì, mà người cấp lại
            tưởng đã xong việc.

            Đóng mở được vì nó là mục dài nhất hộp thoại, cùng cách khối phòng
            ban ở hộp thoại mã giới thiệu.
          */
          <details className={styles.managers} open={watch("managerIds").length > 0}>
            <summary className={styles.managersSummary}>
              <span>Người quản ngân hàng này</span>
              <span className={styles.managersCount}>
                {watch("managerIds").length}/{managerOptions.length} người
              </span>
            </summary>

            {managerOptions.length === 0 ? (
              <p className={styles.managersEmpty}>
                Chưa ai có quyền Quản lý ngân hàng. Cấp quyền đó ở hồ sơ nhân viên
                trước, rồi quay lại đây giao ngân hàng.
              </p>
            ) : (
              <div
                className={styles.managersList}
                role="group"
                aria-label="Người quản ngân hàng này"
              >
                {managerOptions.map((person) => {
                  const picked = watch("managerIds");
                  return (
                    <Checkbox
                      key={person.id}
                      label={`${person.fullName} · ${person.title}`}
                      checked={picked.includes(person.id)}
                      onCheckedChange={(on) =>
                        setValue(
                          "managerIds",
                          on
                            ? [...picked, person.id]
                            : picked.filter((id) => id !== person.id),
                          { shouldDirty: true },
                        )
                      }
                    />
                  );
                })}
              </div>
            )}
          </details>
        )}
      </form>
    </Dialog>
  );
}
