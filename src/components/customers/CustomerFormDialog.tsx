"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { CharCount } from "@/components/ui/CharCount";
import { AddressField } from "@/components/ui/AddressField";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Select } from "@/components/ui/Select";
import { SkeletonText } from "@/components/ui/Skeleton";
import { DateField } from "@/components/ui/DateField";
import { TextField } from "@/components/ui/TextField";
import { fetchChannels } from "@/lib/api/channelCatalog";
import {
  createCustomer,
  CustomerEditForm,
  CustomerForm,
  pickerStartForDob,
  updateCustomer,
  type Customer,
} from "@/lib/api/customers";
import { fetchHospitals } from "@/lib/api/hospitalCatalog";
import { fetchProvinces } from "@/lib/api/wardCatalog";
import { errorMessage, toast } from "@/lib/toast";
import { useSession } from "@/store/session";
import styles from "./CustomerFormDialog.module.scss";
import { reportInvalid } from "@/lib/formErrors";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là sửa, không có thì là tạo khách mới. */
  customer?: Customer | null;
  /** Chỉ gọi khi TẠO MỚI thành công — không gọi khi sửa. */
  onCreated?: (customer: Customer) => void;
  /**
   * Đang tải hồ sơ để sửa (P-40 chỉ có dòng tóm tắt): dialog mở NGAY với
   * skeleton, form nhận dữ liệu qua `values` khi tải xong — một vỏ Dialog
   * duy nhất, không mở dialog thứ hai.
   */
  loading?: boolean;
  /** Tải hồ sơ hỏng — hiện ErrorState kèm nút thử lại NGAY TRONG dialog. */
  loadError?: { onRetry: () => void; retrying: boolean } | null;
};

const emptyForm: CustomerForm = {
  fullName: "",
  dob: "",
  idNumber: "",
  address: "",
  phones: [{ number: "", primary: true }],
  channelId: "",
  channelDetail: "",
};

/**
 * Hồ sơ đang sửa → giá trị ban đầu của biểu mẫu.
 *
 * CCCD bị che thì để TRỐNG chứ không đổ 4 số cuối vào ô: đổ vào là người sửa
 * nhìn ra một số CCCD 4 chữ số và tưởng hồ sơ đang lưu sai. Máy chủ cũng bỏ qua
 * ô này với người không có quyền nên trống hay không đều không ghi đè gì.
 */
const toForm = (c: Customer): CustomerForm => ({
  fullName: c.fullName,
  dob: c.dob ?? "",
  idNumber: c.idNumberMasked ? "" : (c.idNumber ?? ""),
  address: c.address,
  phones: c.phones.map((p) => ({ number: p.number, primary: p.primary })),
  channelId: c.channelId,
  channelDetail: c.channelDetail,
});

/** P-41 · Tạo / sửa khách hàng — tên không ràng buộc định dạng, CCCD chặn trùng. */
export function CustomerFormDialog({
  open,
  onClose,
  customer,
  onCreated,
  loading = false,
  loadError = null,
}: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(customer) || loading || Boolean(loadError);
  const maskedId = Boolean(customer?.idNumberMasked);
  /**
   * Người TẠO hồ sơ ghi đè được CCCD dù chỉ thấy 4 số cuối (chốt 2026-08-21).
   *
   * Chính họ gõ 12 số lúc lập hồ sơ nên cũng chính họ gõ sai. Đây chỉ là phép
   * ẩn/hiện; chốt thật nằm ở `updateCustomer` — xem `server/customers.ts`.
   */
  const actorId = useSession((s) => s.user?.id);
  const canWriteMaskedId = Boolean(customer && actorId && customer.createdById === actorId);

  // `values` để form nhận hồ sơ tải xong SAU khi dialog đã mở (luồng nút Sửa ở
  // P-40). Memo theo `customer` — mỗi render một object mới là form reset liên tục.
  const formValues = useMemo(() => (customer ? toForm(customer) : undefined), [customer]);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CustomerForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    // Luồng SỬA cho CCCD để trống: người không có quyền xem số thì ô đó nạp
    // rỗng và bị khoá, giữ luật 12 số là họ không lưu nổi hồ sơ nào.
    resolver: zodResolver(editing ? CustomerEditForm : CustomerForm),
    defaultValues: customer ? toForm(customer) : emptyForm,
    values: formValues,
  });

  const { fields, append, remove } = useFieldArray({ control, name: "phones" });
  const phones = watch("phones");

  const channelId = watch("channelId");
  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: fetchChannels });
  const selectedChannel = channels.find((c) => c.id === channelId);

  const { data: provinces = [] } = useQuery({
    queryKey: ["provinces"],
    queryFn: fetchProvinces,
  });

  /**
   * Gợi ý địa chỉ `Tỉnh, Xã, Ấp` ghép từ danh mục (spec §U9) — dấu PHẨY, đúng
   * cách người ta viết địa chỉ, không phải `·` của channelDetail cũ.
   *
   * Ghép ở trình duyệt là đủ: mỗi ấp thuộc đúng một xã nên số dòng = số ấp
   * cộng số xã, không phải tích chéo — cả nước mọi ấp cũng chỉ ~20.000 chuỗi,
   * một lượt flatMap ~10ms. Xã chưa có ấp vẫn có gợi ý mức xã.
   */
  const addressSuggestions = useMemo(
    () =>
      provinces.flatMap((p) =>
        p.wards.flatMap((w) => [
          `${p.name}, ${w.name}`,
          ...w.hamlets.map((h) => `${p.name}, ${w.name}, ${h.name}`),
        ]),
      ),
    [provinces],
  );

  const { data: hospitals = [] } = useQuery({
    queryKey: ["hospitals"],
    queryFn: fetchHospitals,
    enabled: selectedChannel?.inputKind === "hospital",
  });

  /**
   * Kênh kiểu `ward-hamlet` (Ấp, Định danh) KẾ THỪA ô Địa chỉ — chốt
   * 2026-08-22, spec §U9. Không còn ô nhập riêng, nên cũng không còn lượt tra
   * ngược chuỗi `Tỉnh · Xã · Ấp` về ba ô chọn như bản trước.
   *
   * Hệ quả với hồ sơ cũ: `channelDetail` dạng `·` bị thay bằng chuỗi địa chỉ
   * dấu phẩy ở lần Lưu kế tiếp — chấp nhận, cột này chỉ để hiển thị.
   */
  const channelDetailToSave = (form: CustomerForm) =>
    selectedChannel?.inputKind === "ward-hamlet" ? form.address : form.channelDetail;

  const save = useMutation({
    mutationFn: (form: CustomerForm) =>
      customer ? updateCustomer(customer.id, form) : createCustomer(form),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      if (customer) {
        queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      } else {
        onCreated?.(saved);
      }
      onClose();
      toast.ok(customer ? `Đã lưu hồ sơ ${saved.fullName}` : `Đã thêm khách hàng ${saved.fullName}`);
    },
    onError: (err) => toast.fail(errorMessage(err, "Không lưu được hồ sơ khách này.")),
  });

  const makePrimary = (index: number) => {
    phones.forEach((_, i) => setValue(`phones.${i}.primary`, i === index, { shouldDirty: true }));
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Sửa khách hàng" : "Thêm khách hàng"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="customer-form"
            disabled={loading || Boolean(loadError) || isSubmitting || save.isPending}
          >
            {editing ? "Lưu" : "Tạo khách hàng"}
          </Button>
        </>
      }
    >
      {loading && <SkeletonText lines={6} label="Đang tải hồ sơ khách" />}
      {/* Thiếu nhánh này thì tải hỏng ra hộp thoại RỖNG: không chữ, không nút thử lại. */}
      {!loading && loadError && (
        <ErrorState
          what="hồ sơ khách hàng này"
          onRetry={loadError.onRetry}
          retrying={loadError.retrying}
        />
      )}

      {!loading && !loadError && (
      <form
        id="customer-form"
        className={styles.form}
        onSubmit={handleSubmit(
          (form) => save.mutate({ ...form, channelDetail: channelDetailToSave(form) }),
          reportInvalid,
        )}
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
            <DateField
              label="Ngày sinh"
              required
              pickerStart={pickerStartForDob()}
              value={watch("dob")}
              onChange={(v) => setValue("dob", v, { shouldDirty: true, shouldValidate: true })}
              error={errors.dob?.message}
            />
            {/* CCCD là trường bảo mật, ba nhánh theo đúng ba nhóm ở
                `updateCustomer`. Người không ghi đè được thì ô phải KHOÁ: để mở
                mà máy chủ lặng lẽ bỏ qua thì người sửa gõ xong bấm Lưu, thấy
                "đã lưu", rồi mở lại thấy số cũ. */}
            {maskedId && !canWriteMaskedId ? (
              <TextField
                label="CCCD"
                readOnly
                value={`•••• •••• ${customer?.idNumber ?? ""}`}
                hint="Bạn chỉ được xem 4 số cuối — cần sửa thì nhờ người có quyền xem CCCD."
              />
            ) : maskedId ? (
              /* Ô để TRỐNG, không đổ 4 số cuối vào: đổ vào thì người sửa bấm Lưu
                 mà không gõ gì là gửi lên một chuỗi 4 ký tự. Không đánh dấu
                 `required` vì trống là hợp lệ — nó nghĩa là giữ nguyên số cũ. */
              <TextField
                label="CCCD"
                placeholder="Gõ 12 số mới để thay số cũ"
                inputMode="numeric"
                maxLength={12}
                labelAppend={<CharCount value={watch("idNumber")} max={12} />}
                hint={`Số đang lưu: •••• •••• ${customer?.idNumber ?? ""}. Để trống thì giữ nguyên, gõ đủ 12 số thì ghi đè.`}
                error={errors.idNumber?.message}
                {...register("idNumber")}
              />
            ) : (
              <TextField
                label="CCCD"
                required
                placeholder="092301004871"
                inputMode="numeric"
                maxLength={12}
                labelAppend={<CharCount value={watch("idNumber")} max={12} />}
                error={errors.idNumber?.message}
                {...register("idNumber")}
              />
            )}
          </div>

          <AddressField
            label="Địa chỉ"
            required
            placeholder="Gõ để tìm Tỉnh, Xã, Ấp — chọn xong gõ thêm số nhà"
            suggestions={addressSuggestions}
            value={watch("address")}
            onChange={(v) => setValue("address", v, { shouldDirty: true, shouldValidate: true })}
            error={errors.address?.message}
          />

          <Select
            block
            label="Kênh (tuỳ chọn)"
            value={channelId}
            onChange={(v) => {
              setValue("channelId", v, { shouldDirty: true });
              // Chi tiết cũ hết nghĩa khi đổi kênh. Kênh kiểu ấp không đọc ô
              // này — nó kế thừa Địa chỉ lúc lưu (spec §U9).
              setValue("channelDetail", "", { shouldDirty: true });
            }}
            options={[
              { value: "", label: "Không có" },
              ...channels.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />

          {selectedChannel?.inputKind === "ward-hamlet" && (
            <p className="text-muted">
              {watch("address").trim() || "(chưa nhập địa chỉ ở trên)"}
            </p>
          )}

          {selectedChannel?.inputKind === "hospital" && (
            <Combobox
              block
              label="Bệnh viện"
              placeholder="Gõ để tìm bệnh viện…"
              value={watch("channelDetail")}
              onChange={(v) => setValue("channelDetail", v, { shouldDirty: true })}
              options={hospitals.map((h) => ({ value: h.name, label: h.name }))}
            />
          )}

          {selectedChannel?.inputKind === "free-text" && (
            <TextField label="Chi tiết kênh" {...register("channelDetail")} />
          )}

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Số điện thoại</legend>
            <div className={styles.phones}>
              {fields.map((field, i) => (
                <div key={field.id} className={styles.phoneRow}>
                  <TextField
                    label={`Số điện thoại ${i + 1}`}
                    required
                    placeholder="0901234567"
                    inputMode="numeric"
                    maxLength={10}
                    labelAppend={<CharCount value={phones[i]?.number} max={10} />}
                    error={errors.phones?.[i]?.number?.message}
                    {...register(`phones.${i}.number`)}
                  />
                  <label className={styles.primaryCheck}>
                    <input
                      type="radio"
                      name="primary-phone"
                      checked={phones[i]?.primary ?? false}
                      onChange={() => makePrimary(i)}
                    />
                    Số chính
                  </label>
                  <Button
                    variant="secondary"
                    icon
                    tooltip="Xoá số này"
                    type="button"
                    aria-label={`Xoá số điện thoại ${i + 1}`}
                    disabled={fields.length <= 1}
                    onClick={() => remove(i)}
                  >
                    <Trash2 size={16} aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
            {errors.phones?.message && <p className={styles.error}>{errors.phones.message}</p>}
            <Button
              variant="secondary"
              type="button"
              onClick={() => append({ number: "", primary: false })}
            >
              + Thêm số điện thoại
            </Button>
          </fieldset>
      </form>
      )}
    </Dialog>
  );
}
