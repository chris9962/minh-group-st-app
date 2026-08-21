"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QrCode } from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import {
  CODE_SCOPE_LABEL,
  createReferralCode,
  fetchBanks,
  ReferralCodeForm,
  updateReferralCode,
  type CodeScope,
  type ReferralCode,
} from "@/lib/api/bankCatalog";
import { fetchDepartments } from "@/lib/api/departments";
import styles from "./ReferralCodeFormDialog.module.scss";
import { readQrImage } from "@/lib/readQrImage";
import { errorMessage, toast } from "@/lib/toast";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là sửa, không có thì là thêm mã mới. */
  referral?: ReferralCode | null;
};

/**
 * P-61 · Thêm / sửa một mã giới thiệu lẻ. Nhập hàng loạt từ Excel là việc của P-62.
 *
 * Sửa được `mã`, `tổng số lượt` và `link mở tài khoản`; ngân hàng thì không —
 * lý do đầy đủ ở `updateReferralCode` (`server/catalog.ts`).
 */
export function ReferralCodeFormDialog({ open, onClose, referral }: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(referral);
  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
  });

  // Lúc thêm mới chỉ hiện ngân hàng đang triển khai. Lúc sửa thì lấy cả ngân
  // hàng đã tắt: mã cũ vẫn thuộc về nó, lọc đi là ô chọn hiện trống trơn.
  const bankOptions = editing ? banks : banks.filter((b) => b.active);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ReferralCodeForm>({
    resolver: zodResolver(ReferralCodeForm),
    defaultValues: {
      bankId: referral?.bankId ?? "",
      code: referral?.code ?? "",
      total: referral?.total ?? 100,
      openUrl: referral?.openUrl ?? "",
      priority: referral?.priority ?? 0,
      scope: referral?.scope ?? "all",
      departmentIds: referral?.departmentIds ?? [],
    },
  });

  const qrInputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  /**
   * Ảnh QR giải NGAY tại trình duyệt, không gửi lên máy chủ (spec §4.4b).
   *
   * Kết quả điền vào ô link — ô đó vẫn sửa được, nên ảnh mờ không đọc ra thì
   * người dùng dán link bằng tay là xong, không mắc lại.
   */
  const readQr = async (file: File) => {
    setReading(true);
    const result = await readQrImage(file);
    setReading(false);

    if (!result.ok) {
      toast.fail(result.message);
      return;
    }
    setValue("openUrl", result.text, { shouldDirty: true, shouldValidate: true });
    toast.ok("Đã đọc link từ ảnh QR");
  };

  const save = useMutation({
    mutationFn: (form: ReferralCodeForm) =>
      referral ? updateReferralCode(referral.id, form) : createReferralCode(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
      // Ô lọc mã ở màn ngân hàng / xuất Excel đi khoá riêng, tiền tố trên
      // không với tới — không nạp thì mã vừa thêm chưa hiện ở đó.
      queryClient.invalidateQueries({ queryKey: ["referral-code-options"] });
      // Mỗi dòng tài khoản mang sẵn tên mã và link mở app của mã đó. Sửa mã mà
      // không nạp lại thì bước 2 của P-20 còn mở link cũ cho tới khi cache hết hạn.
      queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
      queryClient.invalidateQueries({ queryKey: ["bank-account-detail"] });
      onClose();
      toast.ok("Đã lưu mã giới thiệu");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được mã này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Sửa mã giới thiệu" : "Thêm mã giới thiệu"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="referral-code-form"
            disabled={isSubmitting || save.isPending}
          >
            {editing ? "Lưu" : "Tạo mã"}
          </Button>
        </>
      }
    >
      <form
        id="referral-code-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        <Select
          block
          required
          label="Ngân hàng"
          disabled={editing}
          value={watch("bankId")}
          onChange={(v) => setValue("bankId", v, { shouldDirty: true })}
          options={[
            { value: "", label: "— Chọn ngân hàng —" },
            ...bankOptions.map((b) => ({ value: b.id, label: b.code })),
          ]}
          error={errors.bankId?.message}
        />
        {editing && (
          <p className={styles.lockNote}>
            Ngân hàng không đổi được. Tài khoản đã mở bằng mã này thuộc về ngân
            hàng đó — kéo mã sang nhà băng khác là bỏ chúng lại phía sau.
          </p>
        )}

        <TextField
          label="Mã giới thiệu"
          placeholder="VPA-2026-01"
          required
          error={errors.code?.message}
          {...register("code")}
        />

        <TextField
          label="Tổng số lượt dùng"
          type="number"
          inputMode="numeric"
          required
          hint={
            editing
              ? `Đã dùng ${referral!.used}, đang giữ ${referral!.holding} — tổng số không được nhỏ hơn ${referral!.used + referral!.holding}.`
              : "Số lượt tài khoản có thể mở bằng mã này"
          }
          error={errors.total?.message}
          {...register("total", { valueAsNumber: true })}
        />

        <TextField
          label="Độ ưu tiên"
          type="number"
          inputMode="numeric"
          min={0}
          hint="Số lớn lên đầu ô chọn mã lúc mở tài khoản, trong cùng ngân hàng. 0 là mức thường."
          error={errors.priority?.message}
          {...register("priority", { valueAsNumber: true })}
        />

        <Select
          block
          required
          label="Phạm vi sử dụng"
          value={watch("scope")}
          onChange={(v) => {
            setValue("scope", v as CodeScope, { shouldDirty: true });
            // Về "Mọi phòng" thì dọn luôn danh sách: giữ lại là lần sau mở ra
            // thấy phòng còn tick mà ô chọn nói "Mọi phòng".
            if (v === "all") setValue("departmentIds", [], { shouldDirty: true });
          }}
          options={Object.entries(CODE_SCOPE_LABEL).map(([value, label]) => ({ value, label }))}
        />

        {watch("scope") === "departments" && (
          <fieldset className={styles.departments}>
            <legend className={styles.legend}>Phòng dùng được mã này</legend>
            {departments.map((department) => {
              const picked = watch("departmentIds");
              return (
                <Checkbox
                  key={department.id}
                  label={department.name}
                  checked={picked.includes(department.id)}
                  onCheckedChange={(on) =>
                    setValue(
                      "departmentIds",
                      on
                        ? [...picked, department.id]
                        : picked.filter((id) => id !== department.id),
                      { shouldDirty: true, shouldValidate: true },
                    )
                  }
                />
              );
            })}
            {errors.departmentIds && (
              <p className={styles.error}>{errors.departmentIds.message}</p>
            )}
          </fieldset>
        )}

        <TextField
          label="Link mở tài khoản"
          placeholder="https://..."
          hint="Không bắt buộc. Có link thì bước 2 của màn mở tài khoản hiện nút mở app ngân hàng."
          error={errors.openUrl?.message}
          {...register("openUrl")}
        />

        {/* Nút nằm NGOÀI ô nhập: nó chỉ điền hộ, còn ô mới là nguồn sự thật —
            người dùng sửa lại hoặc dán tay lúc nào cũng được. */}
        <Button
          variant="secondary"
          type="button"
          disabled={reading}
          onClick={() => qrInputRef.current?.click()}
        >
          <QrCode size={16} aria-hidden />
          {reading ? "Đang đọc ảnh…" : "Đọc link từ ảnh QR"}
        </Button>

        <input
          ref={qrInputRef}
          type="file"
          accept="image/*"
          className={styles.hiddenInput}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Dọn ô chọn NGAY: giữ nguyên thì chọn lại đúng file đó lần nữa sẽ
            // không bắn sự kiện `change`.
            e.target.value = "";
            if (file) void readQr(file);
          }}
        />
      </form>
    </Dialog>
  );
}
