"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  BankAccountPhotos,
  savedPhotos,
  uploadPendingPhotos,
  type PhotoItem,
} from "@/components/banking/BankAccountPhotos";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import {
  CODE_SCOPE_LABEL,
  createReferralCode,
  fetchBanks,
  OpenUrl,
  ReferralCodeForm,
  updateReferralCode,
  type CodeScope,
  type ReferralCode,
} from "@/lib/api/bankCatalog";
import { fetchDepartments } from "@/lib/api/departments";
import { banksInScope } from "@/lib/permissions";
import { useSession } from "@/store/session";
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
  const actor = useSession((s) => s.user);
  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
  });

  // Lúc thêm mới chỉ hiện ngân hàng đang triển khai. Lúc sửa thì lấy cả ngân
  // hàng đã tắt: mã cũ vẫn thuộc về nó, lọc đi là ô chọn hiện trống trơn.
  //
  // Phạm vi ngân hàng lọc TRƯỚC cả hai: người quản VPa không lập được mã cho
  // MSBa, nên bày ngân hàng đó ra là chọn xong nhận 403.
  const inScope = banksInScope(actor, banks);
  const bankOptions = editing ? inScope : inScope.filter((b) => b.active);

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
      qrImageUrl: referral?.qrImageUrl ?? "",
    },
  });

  /**
   * Ô ảnh QR — dùng lại đúng khối ảnh của P-20/P-22, chỉ khác `max` là 1.
   *
   * Không dựng nút chọn ảnh riêng: khối kia đã có sẵn ô thêm ảnh, nút thay, nút
   * bỏ và lượt xem cỡ lớn, và người dùng đã quen đúng bộ nút đó ở ba màn khác.
   */
  const [qrPhotos, setQrPhotos] = useState<PhotoItem[]>(() =>
    savedPhotos(referral?.qrImageUrl ? [referral.qrImageUrl] : []),
  );
  const [reading, setReading] = useState(false);
  /** File đã giải rồi — chặn giải lại khi danh sách ảnh đổi vì lý do khác. */
  const readFile = useRef<File | null>(null);
  /** Danh sách phòng đang mở. Mã đã chọn xong phòng thì mở hộp thoại ra là đóng. */
  const [departmentsOpen, setDepartmentsOpen] = useState(
    (referral?.departmentIds?.length ?? 0) === 0,
  );

  /**
   * Giải chuỗi trong ảnh vừa chọn để điền hộ ô link.
   *
   * Giải không ra thì ảnh vẫn giữ — bước 2 của P-20 cần chính tấm ảnh để khách
   * quét, còn ô link thì người dùng dán tay được. Hai thứ rời nhau.
   */
  const readQr = async (file: File) => {
    setReading(true);
    const result = await readQrImage(file);
    setReading(false);

    if (!result.ok) {
      toast.warn(`${result.message} Ảnh vẫn được lưu.`);
      return;
    }

    /**
     * Chuỗi giải ra phải là `http`/`https` mới nhận.
     *
     * Ô link không còn hiện ra, nên chuỗi hỏng đặt vào biểu mẫu là người dùng
     * bấm Lưu và không có gì xảy ra — lỗi nằm ở một ô họ không nhìn thấy. QR
     * chứa số tài khoản hay chữ thường là ca có thật, không phải nặn tay.
     */
    if (!OpenUrl.safeParse(result.text).success) {
      toast.warn("Mã QR trong ảnh không chứa link http/https. Ảnh vẫn được lưu, nhưng mã này chưa có link mở tài khoản.");
      return;
    }

    setValue("openUrl", result.text, { shouldDirty: true, shouldValidate: true });
    toast.ok("Đã đọc link từ ảnh QR");
  };

  const takeQrPhotos = (next: PhotoItem[]) => {
    setQrPhotos(next);

    const first = next[0];
    if (first?.kind !== "pending") {
      readFile.current = null;
      return;
    }
    if (first.file === readFile.current) return;
    readFile.current = first.file;
    void readQr(first.file);
  };

  const save = useMutation({
    mutationFn: async (form: ReferralCodeForm) => {
      // Ảnh đi lên TRƯỚC, rồi mới ghi bản ghi. Gửi thẳng `blob:` thì nó chạy
      // được ở tab đang mở nhưng tải lại trang là ảnh vỡ vĩnh viễn — đúng lỗi
      // đã xảy ra với ảnh chứng minh, xem `BankAccountPhotos`.
      const [uploaded] = await uploadPendingPhotos(qrPhotos, "referral-codes");
      const body = { ...form, qrImageUrl: uploaded ?? "" };
      return referral ? updateReferralCode(referral.id, body) : createReferralCode(body);
    },
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

        {/*
          Ô link KHÔNG hiện ra nữa (chốt 2026-08-24). Người dùng chỉ chọn ảnh; link
          giải ra từ chính ảnh đó và đi lên máy chủ cùng biểu mẫu, bước 2 của P-20
          đọc nó để dựng nút mở app ngân hàng.

          ⚠️ Đổi lại là mất đường nhập link bằng tay — ảnh mờ không giải ra thì mã
          đó không có link. Dòng trạng thái dưới khối ảnh nói rõ đang ở ca nào.

          Khối ảnh của P-20/P-22 dùng lại nguyên: `max` là 1 nên có ảnh rồi thì ô
          thêm ảnh biến mất, chỉ còn nút thay và nút bỏ ngay trên tấm ảnh.
        */}
        <BankAccountPhotos
          photos={qrPhotos}
          requiredPhotos={0}
          max={1}
          title="Ảnh QR"
          onChange={takeQrPhotos}
          busy={reading || save.isPending}
        />

        <p className={styles.qrHint}>
          {reading
            ? "Đang đọc mã trong ảnh…"
            : watch("openUrl")
              ? "Mã này đã có link mở tài khoản, giải từ ảnh QR. Bước 2 của màn mở tài khoản hiện nút mở app ngân hàng."
              : "Mã này chưa có link mở tài khoản. Chọn ảnh QR để hệ thống giải link ra — chưa có link thì bước 2 không hiện nút mở app ngân hàng."}
        </p>

        {/* Cụm phạm vi đứng CUỐI biểu mẫu: nó là mục dài nhất, và phần lớn mã
            để "Mọi phòng" nên người dùng đi qua nó chứ không dừng lại. */}
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
          /*
            `<details>` gốc, không dựng khối đóng mở bằng tay: trình duyệt lo sẵn
            phím Enter/Space, tiêu điểm và cách trình đọc màn hình đọc trạng thái
            đóng/mở. Dựng bằng div + `aria-expanded` là làm lại đúng những thứ đó
            và làm sai một trong số chúng.

            Danh sách 15 phòng chiếm gần hết hộp thoại, mà mã đặt phạm vi phòng
            là số ít — đóng sẵn khi mã đã chọn xong phòng.
          */
          <details
            className={styles.departments}
            // Có lỗi thì mở bằng được: câu báo lỗi nằm trong khối, đóng lại là
            // người dùng bấm Lưu mà không thấy vì sao không lưu được.
            open={departmentsOpen || Boolean(errors.departmentIds)}
            onToggle={(e) => setDepartmentsOpen(e.currentTarget.open)}
          >
            <summary className={styles.departmentsSummary}>
              <span>Phòng dùng được mã này</span>
              <span className={styles.departmentsCount}>
                {watch("departmentIds").length}/{departments.length} phòng
              </span>
            </summary>

            <div className={styles.departmentsList} role="group" aria-label="Phòng dùng được mã này">
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
            </div>

            {errors.departmentIds && (
              <p className={styles.error}>{errors.departmentIds.message}</p>
            )}
          </details>
        )}
      </form>
    </Dialog>
  );
}
