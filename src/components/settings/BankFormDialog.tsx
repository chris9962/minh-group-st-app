"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import {
  BankAccountPhotos,
  savedPhotos,
  uploadPendingPhotos,
  type PhotoItem,
} from "@/components/banking/BankAccountPhotos";
import { Combobox } from "@/components/ui/Combobox";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import {
  ACCOUNT_NUMBER_METHOD_LABEL,
  AccountNumberMethod,
  BankForm,
  createBank,
  updateBank,
  type Bank,
} from "@/lib/api/bankCatalog";
import { fetchStaffOptions } from "@/lib/api/staff";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import styles from "./BankFormDialog.module.scss";
import { errorMessage, toast } from "@/lib/toast";
import { digitsOnly, numberValue, numericField } from "@/lib/numberField";
import { reportInvalid } from "@/lib/formErrors";

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

  /**
   * TOÀN BỘ nhân viên đang làm việc, không lọc theo quyền.
   *
   * Người giao ngân hàng thường chọn một nhân viên chưa có quyền gì — máy chủ
   * cấp `manage-bank` cho họ ngay lúc lưu (`writeBankManagers`). Lọc sẵn theo
   * quyền thì danh sách gần như trống, và người giao không hiểu vì sao không
   * tìm thấy ai.
   */
  /**
   * Tên người quản ĐANG CÓ, lấy từ chính bản ghi ngân hàng.
   *
   * `staffOptions` chỉ có người đang làm việc, nên người quản đã nghỉ việc tra
   * không ra và dòng đó in UUID trần. Bản ghi ngân hàng mang sẵn `fullName` —
   * đó là lý do trường này đổi từ `managerIds` sang `managers`.
   */
  const savedNames = new Map((bank?.managers ?? []).map((m) => [m.id, m.fullName]));

  /**
   * Ảnh mẫu — dùng lại khối ảnh của P-20/P-22.
   *
   * `max` để rộng: quy trình dài bao nhiêu là việc của từng ngân hàng, thường
   * 2–3 tấm nhưng có ca sáu tấm. Trần thật vẫn là `PHOTO_MAX` của khối đó.
   */
  const [guidePhotos, setGuidePhotos] = useState<PhotoItem[]>(() =>
    savedPhotos(bank?.guidePhotoUrls ?? []),
  );

  const { data: staffOptions = [] } = useQuery({
    // Khoá GIỐNG bốn màn khác đang gọi cùng hàm này (`banking`, `insurance`,
    // `services`, `customers`). Khoá riêng thì tải trùng ~300 nhân viên, và mọi
    // lệnh nạp lại `["staff"]` trong repo không chạm tới nó.
    queryKey: ["staff", "options", "active"],
    queryFn: () => fetchStaffOptions({ status: "active" }),
    // `/api/staff/options` đòi `staff:view-detail`, KHÁC quyền cấp phát. Thiếu
    // nó thì gọi vào nhận 403 và ô tìm im lặng không nói vì sao.
    enabled: canAssign && can(actor, "staff", "view-detail"),
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BankForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(BankForm),
    defaultValues: {
      code: bank?.code ?? "",
      requiredPhotos: bank?.requiredPhotos ?? 3,
      accountNumberMethod: bank?.accountNumberMethod ?? "phone-match",
      countsAsApp: bank?.countsAsApp ?? true,
      priority: bank?.priority ?? 0,
      minAge: bank?.minAge ?? null,
      maxAge: bank?.maxAge ?? null,
      managerIds: bank?.managers.map((m) => m.id) ?? [],
      guide: bank?.guide ?? "",
      guidePhotoUrls: bank?.guidePhotoUrls ?? [],
    },
  });

  const save = useMutation({
    mutationFn: async (form: BankForm) => {
      // Ảnh đi lên TRƯỚC, rồi mới ghi bản ghi — gửi thẳng `blob:` thì tải lại
      // trang là ảnh vỡ vĩnh viễn, xem `BankAccountPhotos`.
      const body = {
        ...form,
        guidePhotoUrls: await uploadPendingPhotos(guidePhotos, "bank-guides"),
      };
      return bank ? updateBank(bank.id, body) : createBank(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["banks"] });
      // Mã ngân hàng được nhúng sẵn vào từng dòng của các màn này, đổi mã
      // mà không nạp lại thì chúng hiện mã cũ cho tới khi cache hết hạn.
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
      queryClient.invalidateQueries({ queryKey: ["referral-code-options"] });
      /**
       * Nạp lại cả NHÂN SỰ: lượt lưu này cấp và thu hồi quyền của người khác
       * (`writeBankManagers`).
       *
       * Không nạp lại thì hồ sơ người vừa được giao còn bộ quyền cũ trong cache.
       * Ai đó mở hồ sơ đó, sửa một trường bất kỳ rồi Lưu là gửi lên bộ quyền cũ
       * — thu hồi đúng quyền vừa cấp, mà không ai thấy mình đã làm gì.
       */
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["staff-one"] });
      onClose();
      toast.ok("Đã lưu ngân hàng");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được ngân hàng này.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      /* Mã lên tiêu đề khi sửa: nó không đổi được nên một ô nhập đã khoá chỉ
         chiếm chỗ, mà hộp thoại này còn khối chọn người quản ở dưới. */
      title={editing ? `Sửa ngân hàng ${bank!.code}` : "Thêm ngân hàng"}
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
        onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
        noValidate
      >
        {/* Ô mã CHỈ hiện lúc tạo. Khi sửa thì mã nằm ở tiêu đề hộp thoại —
            nó là danh tính, không đổi được, nên một ô đã khoá chỉ chiếm chỗ.
            Giá trị vẫn nằm trong biểu mẫu (`defaultValues`) để zod không báo
            thiếu; máy chủ cũng bỏ qua `code` khi cập nhật — xem `updateBank`. */}
        {!editing && (
          <TextField
            label="Mã ngân hàng"
            placeholder="VPa"
            hint="Mã không đổi được sau khi tạo — luật tính điểm và quà khớp theo mã này."
            error={errors.code?.message}
            {...register("code")}
          />
        )}

        <div className={styles.pair}>
          <TextField
            label="Số ảnh bắt buộc"
            type="text"
            inputMode="numeric"
            error={errors.requiredPhotos?.message}
            {...numericField(register("requiredPhotos", { setValueAs: numberValue }), digitsOnly)}
          />

          <TextField
            label="Độ ưu tiên"
            type="text"
            inputMode="numeric"
            hint="Số lớn lên đầu ô chọn lúc mở tài khoản."
            error={errors.priority?.message}
            {...numericField(register("priority", { setValueAs: numberValue }), digitsOnly)}
          />
        </div>

        <div className={styles.pair}>
          <TextField
            label="Tuổi tối thiểu"
            type="text"
            inputMode="numeric"
            placeholder="Không giới hạn"
            hint="Để trống nếu không giới hạn phía dưới."
            error={errors.minAge?.message}
            {...numericField(
              register("minAge", { setValueAs: (value) => (value === "" ? null : numberValue(value)) }),
              digitsOnly,
            )}
          />

          <TextField
            label="Tuổi tối đa"
            type="text"
            inputMode="numeric"
            placeholder="Không giới hạn"
            hint="Để trống nếu không giới hạn phía trên."
            error={errors.maxAge?.message}
            {...numericField(
              register("maxAge", { setValueAs: (value) => (value === "" ? null : numberValue(value)) }),
              digitsOnly,
            )}
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

        <TextArea
          label="Hướng dẫn mở tài khoản"
          rows={8}
          placeholder={"Bước 1: …\nBước 2: …\n\nẢnh 1: …\nẢnh 2: …"}
          hint="Quy trình riêng của ngân hàng này. Nhân viên đọc ở bước 2 của màn mở tài khoản."
          error={errors.guide?.message}
          {...register("guide")}
        />

        {/* Ảnh mẫu đi theo THỨ TỰ: người nhập viết "Ảnh 1: …" trong ô trên, nên
            đảo thứ tự ở đây là đổi nghĩa của cả đoạn hướng dẫn. */}
        <BankAccountPhotos
          photos={guidePhotos}
          requiredPhotos={0}
          max={10}
          title="Ảnh mẫu"
          onChange={setGuidePhotos}
          busy={save.isPending}
        />

        {canAssign && (
          <div className={styles.managers}>
            <Combobox
              block
              label="Thêm người quản ngân hàng này"
              placeholder="Gõ tên hoặc tên đăng nhập…"
              value=""
              onChange={(id) => {
                if (!id) return;
                const picked = watch("managerIds");
                if (picked.includes(id)) return;
                setValue("managerIds", [...picked, id], { shouldDirty: true });
              }}
              options={staffOptions
                // Người đã chọn biến khỏi danh sách gợi ý: để lại là chọn lần
                // hai không có tác dụng gì mà người dùng vẫn bấm.
                .filter((s) => !watch("managerIds").includes(s.id))
                .map((s) => ({
                  value: s.id,
                  label: `${s.fullName} · ${s.title || s.username}`,
                }))}
            />

            <p className={styles.managersEmpty}>
              Người được giao sửa được cấu hình và kho mã của riêng ngân hàng
              này. Ai chưa có quyền thì hệ thống cấp lúc bạn bấm Lưu; ai bị bỏ
              khỏi ngân hàng cuối cùng họ quản thì bị thu hồi.
            </p>

            {watch("managerIds").length > 0 && (
              <ul className={styles.managersList}>
                {watch("managerIds").map((id) => {
                  const person = staffOptions.find((s) => s.id === id);
                  const name = person
                    ? `${person.fullName} · ${person.title || person.username}`
                    : (savedNames.get(id) ?? "Tài khoản đã ngừng hoạt động");
                  return (
                    <li key={id} className={styles.managerRow}>
                      <span>{name}</span>
                      <button
                        type="button"
                        className={styles.managerRemove}
                        aria-label={`Bỏ ${person?.fullName ?? savedNames.get(id) ?? "người này"} khỏi danh sách quản ngân hàng`}
                        onClick={() =>
                          setValue(
                            "managerIds",
                            watch("managerIds").filter((x) => x !== id),
                            { shouldDirty: true },
                          )
                        }
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}
