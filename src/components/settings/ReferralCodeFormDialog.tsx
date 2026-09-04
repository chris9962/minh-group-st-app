"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
  ReferralCodeForm,
  updateReferralCode,
  type CodeScope,
  type ReferralCode,
} from "@/lib/api/bankCatalog";
import { AccountType } from "@/lib/api/bankAccounts";
import { fetchDepartments } from "@/lib/api/departments";
import { digitsOnly, numberValue, numericField } from "@/lib/numberField";
import { banksInScope } from "@/lib/permissions";
import { useSession } from "@/store/session";
import styles from "./ReferralCodeFormDialog.module.scss";
import { errorMessage, toast } from "@/lib/toast";
import { reportInvalid } from "@/lib/formErrors";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là sửa, không có thì là thêm mã mới. */
  referral?: ReferralCode | null;
};

/**
 * P-61 · Thêm / sửa một mã giới thiệu lẻ. Nhập hàng loạt từ Excel là việc của P-62.
 *
 * Sửa được tên hiển thị, mã text, ảnh QR và tổng số lượt; ngân hàng thì không —
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
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ReferralCodeForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(ReferralCodeForm),
    defaultValues: {
      bankId: referral?.bankId ?? "",
      // Cache từ phiên trước migration chưa có trường này; dùng mã text làm
      // phương án dự phòng để mở hộp thoại sửa không bị trống tên.
      displayName: referral?.displayName ?? referral?.code ?? "",
      code: referral?.code ?? "",
      total: referral?.total ?? 100,
      openUrl: referral?.openUrl ?? "",
      priority: referral?.priority ?? 0,
      accountType: referral?.accountType ?? "none",
      scope: referral?.scope ?? "all",
      departmentIds: referral?.departmentIds ?? [],
      qrImageUrl: referral?.qrImageUrl ?? "",
      province: referral?.province ?? "",
      supportBranch: referral?.supportBranch ?? "",
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
  /** Danh sách phòng đang mở. Mã đã chọn xong phòng thì mở hộp thoại ra là đóng. */
  const [departmentsOpen, setDepartmentsOpen] = useState(
    (referral?.departmentIds?.length ?? 0) === 0,
  );
  const departmentsRef = useRef<HTMLDetailsElement>(null);
  const scope = watch("scope");
  const previousScope = useRef(scope);

  // Danh sách phòng vừa được thêm ngay SAU ô phạm vi. Nếu giữ nguyên vị trí
  // cuộn, nó nằm khuất dưới chân hộp thoại và trông như chọn xong mà không có
  // gì xảy ra. Chỉ cuộn khi người dùng VỪA đổi sang "Phòng chỉ định"; mở lại
  // một mã cũ không bị nhảy vị trí.
  useEffect(() => {
    const changedToDepartments =
      previousScope.current !== scope && scope === "departments";
    previousScope.current = scope;
    if (!changedToDepartments) return;

    const frame = requestAnimationFrame(() => {
      departmentsRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [scope]);

  // QR chỉ được đưa ra cho khách quét; không giải ảnh thành link hay mở app từ đây.
  const takeQrPhotos = (next: PhotoItem[]) => setQrPhotos(next);

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
      // Mỗi dòng tài khoản mang sẵn tên mã và ảnh QR của mã đó. Sửa mã thì nạp
      // lại để bước 2 hiện đúng mã mới ngay.
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
        onSubmit={handleSubmit((form) => {
          if (!form.code && qrPhotos.length === 0) {
            setError("code", { message: "Nhập mã text hoặc chọn ảnh QR" });
            return;
          }
          save.mutate(form);
        }, reportInvalid)}
        noValidate
      >
        <div className={styles.bankTypeFields}>
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

          <Select
            block
            required
            label="Loại tài khoản"
            disabled={Boolean(referral && referral.used + referral.holding > 0)}
            value={watch("accountType")}
            onChange={(v) => setValue("accountType", v as AccountType, { shouldDirty: true })}
            options={[
              { value: "none", label: "Thường" },
              { value: "CNKD", label: "CNKD" },
              { value: "HKD", label: "HKD" },
            ]}
            error={errors.accountType?.message}
          />
        </div>
        {editing && (
          <p className={styles.lockNote}>
            Ngân hàng không đổi được. Tài khoản đã mở bằng mã này thuộc về ngân
            hàng đó — kéo mã sang nhà băng khác là bỏ chúng lại phía sau.
          </p>
        )}

        <TextField
          label="Tên hiển thị"
          placeholder="VPA CNKD QR 01"
          required
          hint="Tên dùng để nhận biết trong danh sách và lúc chọn mở tài khoản."
          error={errors.displayName?.message}
          {...register("displayName")}
        />

        <div className={styles.identifierFields}>
          <div className={styles.qrField}>
            <BankAccountPhotos
              photos={qrPhotos}
              requiredPhotos={0}
              max={1}
              title="Ảnh QR"
              onChange={takeQrPhotos}
              busy={save.isPending}
              compact
            />
          </div>

          <TextField
            label="Mã text"
            placeholder="VPA-2026-01"
            hint="Có thể để trống nếu ngân hàng chỉ cấp QR."
            error={errors.code?.message}
            {...register("code")}
          />
        </div>

        {/* Lưu TÊN tỉnh, không lưu id — xem chú thích cột `province` ở schema.
            Hai trường này hiện cạnh ô chọn mã ở bước 2 khi mở tài khoản.

            Gõ tay chứ không chọn từ danh mục tham chiếu: ngân hàng đặt tên chi
            nhánh theo địa giới của riêng họ, có mã phủ vùng không trùng tên
            tỉnh nào trong danh mục. */}
        <TextField
          label="Tỉnh"
          placeholder="Tiền Giang"
          error={errors.province?.message}
          {...register("province")}
        />

        <TextField
          label="Chi nhánh hỗ trợ"
          placeholder="PGD Cái Bè"
          error={errors.supportBranch?.message}
          {...register("supportBranch")}
        />

        <TextField
          label="Tổng số lượt dùng"
          type="text"
          inputMode="numeric"
          required
          hint={
            editing
              ? `Đã dùng ${referral!.used}, đang giữ ${referral!.holding} — tổng số không được nhỏ hơn ${referral!.used + referral!.holding}.`
              : "Số lượt tài khoản có thể mở bằng mã này"
          }
          error={errors.total?.message}
          {...numericField(register("total", { setValueAs: numberValue }), digitsOnly)}
        />

        <TextField
          label="Độ ưu tiên"
          type="text"
          inputMode="numeric"
          hint="Số lớn lên đầu ô chọn mã lúc mở tài khoản, trong cùng ngân hàng."
          error={errors.priority?.message}
          {...numericField(register("priority", { setValueAs: numberValue }), digitsOnly)}
        />

        {/* Cụm phạm vi đứng CUỐI biểu mẫu: nó là mục dài nhất, và phần lớn mã
            để "Mọi phòng" nên người dùng đi qua nó chứ không dừng lại. */}
        <Select
          block
          required
          label="Phạm vi sử dụng"
          value={scope}
          onChange={(v) => {
            setValue("scope", v as CodeScope, { shouldDirty: true });
            // Về "Mọi phòng" thì dọn luôn danh sách: giữ lại là lần sau mở ra
            // thấy phòng còn tick mà ô chọn nói "Mọi phòng".
            if (v === "all") setValue("departmentIds", [], { shouldDirty: true });
          }}
          options={Object.entries(CODE_SCOPE_LABEL).map(([value, label]) => ({ value, label }))}
        />

        {scope === "departments" && (
          /*
            `<details>` gốc, không dựng khối đóng mở bằng tay: trình duyệt lo sẵn
            phím Enter/Space, tiêu điểm và cách trình đọc màn hình đọc trạng thái
            đóng/mở. Dựng bằng div + `aria-expanded` là làm lại đúng những thứ đó
            và làm sai một trong số chúng.

            Danh sách 15 phòng chiếm gần hết hộp thoại, mà mã đặt phạm vi phòng
            là số ít — đóng sẵn khi mã đã chọn xong phòng.
          */
          <details
            ref={departmentsRef}
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
