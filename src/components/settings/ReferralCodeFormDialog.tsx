"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QrCode } from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import {
  createReferralCode,
  fetchBanks,
  ReferralCodeForm,
} from "@/lib/api/bankCatalog";
import styles from "./ReferralCodeFormDialog.module.scss";
import { readQrImage } from "@/lib/readQrImage";
import { errorMessage, toast } from "@/lib/toast";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** P-61 · Thêm một mã giới thiệu lẻ. Nhập hàng loạt từ Excel là việc của P-62. */
export function ReferralCodeFormDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const activeBanks = banks.filter((b) => b.active);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ReferralCodeForm>({
    resolver: zodResolver(ReferralCodeForm),
    defaultValues: { bankId: "", code: "", total: 100, openUrl: "" },
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
    mutationFn: createReferralCode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
      // Ô lọc mã ở màn ngân hàng / xuất Excel đi khoá riêng, tiền tố trên
      // không với tới — không nạp thì mã vừa thêm chưa hiện ở đó.
      queryClient.invalidateQueries({ queryKey: ["referral-code-options"] });
      onClose();
      toast.ok("Đã lưu mã giới thiệu");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được mã này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Thêm mã giới thiệu"
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
            Tạo mã
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
          label="Ngân hàng"
          value={watch("bankId")}
          onChange={(v) => setValue("bankId", v, { shouldDirty: true })}
          options={[
            { value: "", label: "— Chọn ngân hàng —" },
            ...activeBanks.map((b) => ({ value: b.id, label: b.code })),
          ]}
          error={errors.bankId?.message}
        />

        <TextField
          label="Mã giới thiệu"
          placeholder="VPA-2026-01"
          error={errors.code?.message}
          {...register("code")}
        />

        <TextField
          label="Tổng số lượt dùng"
          type="number"
          inputMode="numeric"
          hint="Số lượt tài khoản có thể mở bằng mã này"
          error={errors.total?.message}
          {...register("total", { valueAsNumber: true })}
        />

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
