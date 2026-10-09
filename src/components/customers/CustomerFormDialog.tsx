"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CharCount } from "@/components/ui/CharCount";
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
  type CustomerEditForm as CustomerEditFormValues,
  DuplicateIdError,
  fetchIdCardScanEnabled,
  pickerStartForDob,
  updateCustomer,
  type Customer,
  type DuplicateField,
  type DuplicateIdInfo,
} from "@/lib/api/customers";
import { formatDate } from "@/lib/format";
import { fetchHospitals } from "@/lib/api/hospitalCatalog";
import { useAddressSuggestions } from "@/lib/useAddressSuggestions";
import { errorMessage, toast } from "@/lib/toast";
import { useSession } from "@/store/session";
import { IdCardScanner } from "./IdCardScanner";
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

/**
 * Giá trị biểu mẫu: dạng SỬA rộng hơn dạng tạo đúng một ô `createdDay` (ngày
 * hồ sơ), nên dùng chung kiểu rộng cho cả hai luồng; lúc tạo ô đó bỏ trống.
 */
type FormValues = CustomerEditFormValues;

const emptyForm: FormValues = {
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
 * nhìn ra một số CCCD 4 chữ số và tưởng hồ sơ đang lưu sai. Ô trống thì máy chủ
 * giữ nguyên số cũ.
 */
const toForm = (c: Customer): FormValues => ({
  fullName: c.fullName,
  dob: c.dob ?? "",
  idNumber: c.idNumberMasked ? "" : (c.idNumber ?? ""),
  address: c.address,
  phones: c.phones.map((p) => ({ number: p.number, primary: p.primary })),
  channelId: c.channelId,
  channelDetail: c.channelDetail,
  createdDay: c.createdAt,
});

/** P-41 · Tạo / sửa khách hàng — tên phải có chữ, CCCD chặn trùng. */
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
  const actorRole = useSession((s) => s.user?.role);
  /**
   * Ô "Ngày hồ sơ" (chốt 2026-09-16): mốc của điểm KPI, rổ quà và kỳ luật.
   * Ẩn với vai Nhân viên — chủ dự án chốt "trừ nhân viên ra", không mở quyền
   * mới, máy chủ từ chối cùng điều kiện. Hồ sơ đã chốt quà thì ô khoá.
   */
  const showCreatedDay = editing && Boolean(customer) && actorRole !== "staff";

  /**
   * Tạo hồ sơ đi HAI BƯỚC (chốt 2026-10-06): bước 1 chụp mặt trước thẻ CCCD
   * bằng camera trong hộp thoại, bước 2 điền thông tin. Mọi vai đều phải chụp
   * khi công tắc ở màn Vận hành bật. Máy chủ đọc lại QR từ chính ảnh gửi lên và ghi đè
   * ba giá trị, nên thứ điền ở bước 2 chỉ để người nhập đối chiếu với khách.
   */
  const [scan, setScan] = useState<File | null>(null);
  // Màn Vận hành tắt được bước chụp (chốt 2026-10-08): tắt thì mở thẳng form, gõ
  // tay ba ô như trước. Đọc hỏng thì coi như bật, máy chủ mới là chốt thật.
  const scanSwitch = useQuery({
    queryKey: ["customers", "id-card-scan"],
    queryFn: fetchIdCardScanEnabled,
    enabled: open && !editing,
  });
  const switchLoading = !editing && scanSwitch.isPending;
  const capturing = !editing && !scan && (scanSwitch.data ?? true);
  // Ảnh thu nhỏ của thẻ vừa chụp ở đầu bước 2. Blob URL là tài nguyên của trình
  // duyệt, phải thu hồi khi đổi ảnh hoặc gỡ component.
  const scanUrl = useMemo(() => (scan ? URL.createObjectURL(scan) : null), [scan]);
  useEffect(() => {
    if (!scanUrl) return;
    return () => URL.revokeObjectURL(scanUrl);
  }, [scanUrl]);
  // Họ tên, ngày sinh, CCCD khoá khi đang tạo mà đã chụp thẻ. Lúc sửa, khách tạo
  // bằng quét QR thì khoá với vai Nhân viên (chốt 2026-10-08); máy chủ từ chối cùng điều kiện.
  const idCardLocked = editing
    ? actorRole === "staff" && Boolean(customer?.hasIdCardImage)
    : scan !== null;

  // `values` để form nhận hồ sơ tải xong SAU khi dialog đã mở (luồng nút Sửa ở
  // P-40). Memo theo `customer` — mỗi render một object mới là form reset liên tục.
  const formValues = useMemo(() => (customer ? toForm(customer) : undefined), [customer]);

  /**
   * Địa chỉ CHỈ chọn từ danh mục, không gõ tự do (chốt 2026-09-05). Chuỗi lưu
   * phải khớp đúng một dòng `Ấp, Xã, Tỉnh` để kênh ấp và thống kê theo xã/ấp
   * đọc lại được; bản trước cho gõ nối số nhà nên cùng một ấp ra nhiều dạng.
   *
   * Hồ sơ cũ mang chuỗi ngoài danh mục thì ô hiện trống và lượt Lưu dừng ở
   * "Chọn địa chỉ từ danh sách": người sửa phải chọn lại.
   */
  const addressSuggestions = useAddressSuggestions();
  const addressOptions = useMemo(
    () => addressSuggestions.map((s) => ({ value: s, label: s })),
    [addressSuggestions],
  );
  const addressSet = useMemo(() => new Set(addressSuggestions), [addressSuggestions]);
  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: fetchChannels });
  const schema = useMemo(
    () =>
      // Hai schema khác nhau một ô tuỳ chọn; ép về kiểu chung để `.refine` gọi
      // được trên union.
      ((editing ? CustomerEditForm : CustomerForm) as z.ZodType<FormValues, FormValues>)
        .refine((f) => addressSet.has(f.address), {
          path: ["address"],
          message: "Chọn địa chỉ từ danh sách",
        })
        // Kênh Bệnh viện và Tự do đòi chi tiết (chốt 2026-09-06). Kênh ấp lấy
        // địa chỉ làm chi tiết lúc lưu nên không kiểm ở đây. Máy chủ kiểm lại
        // cùng luật ở `channelDetailMissing`.
        .superRefine((f, ctx) => {
          if (f.channelDetail.trim()) return;
          const kind = channels.find((c) => c.id === f.channelId)?.inputKind;
          if (kind === "hospital")
            ctx.addIssue({ code: "custom", path: ["channelDetail"], message: "Chưa chọn bệnh viện" });
          if (kind === "free-text")
            ctx.addIssue({ code: "custom", path: ["channelDetail"], message: "Chưa nhập chi tiết kênh" });
        }),
    [editing, addressSet, channels],
  );

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    // Luồng SỬA cho CCCD để trống: người không có quyền xem số thì ô đó nạp
    // rỗng và bị khoá, giữ luật 12 số là họ không lưu nổi hồ sơ nào.
    resolver: zodResolver(schema),
    defaultValues: customer ? toForm(customer) : emptyForm,
    values: formValues,
  });

  const { fields, append, remove } = useFieldArray({ control, name: "phones" });
  const phones = watch("phones");

  const channelId = watch("channelId");
  const selectedChannel = channels.find((c) => c.id === channelId);

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
  const channelDetailToSave = (form: FormValues) =>
    selectedChannel?.inputKind === "ward-hamlet" ? form.address : form.channelDetail;

  /**
   * CCCD đã có hồ sơ — không còn là ngõ dừng.
   *
   * Khách quay lại mở combo mới thì hồ sơ thứ hai là chuyện đúng, nên máy chủ
   * trả kèm `rootId` và lượt lưu kế tiếp gửi nó lên. `openDraftId` khác `null`
   * nghĩa là chính người này đang giữ một lần chưa chốt quà, và lúc đó không
   * tạo thêm được.
   *
   * Giữ cả biểu mẫu vừa gửi: hộp thoại đối chiếu bày hai cột "đang có" và "vừa
   * nhập", mà giá trị vừa nhập lấy từ đúng lượt gửi bị từ chối, không đọc lại
   * form đang mở phía dưới.
   */
  const [duplicate, setDuplicate] = useState<{ info: DuplicateIdInfo; form: FormValues } | null>(
    null,
  );

  type SaveArgs = { form: FormValues; linkToRootId?: string };
  const save = useMutation({
    mutationFn: ({ form, linkToRootId }: SaveArgs) =>
      customer
        ? updateCustomer(customer.id, form)
        : createCustomer(form, linkToRootId, scan ?? undefined),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      if (customer) {
        queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      } else {
        onCreated?.(saved);
      }
      setScan(null);
      setDuplicate(null);
      onClose();
      toast.ok(customer ? `Đã lưu hồ sơ ${saved.fullName}` : `Đã thêm khách hàng ${saved.fullName}`);
    },
    onError: (err, variables) => {
      if (err instanceof DuplicateIdError) {
        setDuplicate({ info: err.info, form: variables.form });
        return;
      }
      setDuplicate(null);
      toast.fail(errorMessage(err, "Không lưu được hồ sơ khách này."));
    },
  });

  const submit = (form: FormValues, linkToRootId?: string) =>
    save.mutate({
      form: { ...form, channelDetail: channelDetailToSave(form) },
      linkToRootId,
    });

  const makePrimary = (index: number) => {
    phones.forEach((_, i) => setValue(`phones.${i}.primary`, i === index, { shouldDirty: true }));
  };

  /** Về bước 1: bỏ ảnh và ba giá trị lấy từ thẻ; camera mở lại khi bước 1 gắn lại. */
  const retake = () => {
    setScan(null);
    setValue("idNumber", "");
    setValue("fullName", "");
    setValue("dob", "");
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Sửa khách hàng" : "Thêm khách hàng"}
      footer={
        // Bước 1 không có chân hộp thoại: nút Huỷ nằm ngay trên khung ngắm.
        capturing || switchLoading ? undefined : (
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
        )
      }
    >
      {loading && <SkeletonText lines={6} label="Đang tải hồ sơ khách" />}
      {switchLoading && <SkeletonText lines={6} label="Đang mở form" />}
      {/* Thiếu nhánh này thì tải hỏng ra hộp thoại RỖNG: không chữ, không nút thử lại. */}
      {!loading && loadError && (
        <ErrorState
          what="hồ sơ khách hàng này"
          onRetry={loadError.onRetry}
          retrying={loadError.retrying}
        />
      )}

      {/* Bước 1: chụp thẻ. Đổi bước là gắn/gỡ component, nên camera tự tắt
          khi sang bước 2 và mở lại khi bấm "Chụp lại". */}
      {!loading && !switchLoading && !loadError && capturing && (
        <IdCardScanner
          onCancel={onClose}
          onScanned={(card, file) => {
            // Ô chưa gắn lên màn ở bước 1, react-hook-form vẫn giữ giá trị và
            // đổ vào ô khi form hiện ở bước 2.
            setValue("idNumber", card.idNumber, { shouldDirty: true, shouldValidate: true });
            setValue("fullName", card.fullName, { shouldDirty: true, shouldValidate: true });
            setValue("dob", card.dob, { shouldDirty: true, shouldValidate: true });
            setScan(file);
          }}
        />
      )}

      {!loading && !switchLoading && !loadError && !capturing && (
      <form
        id="customer-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => submit(form), reportInvalid)}
        noValidate
      >
          {scan && (
            <div className={styles.cardDone}>
              {scanUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- ảnh là blob vừa chụp, next/image không tối ưu được
                <img src={scanUrl} alt="Ảnh mã QR vừa chụp" className={styles.cardThumb} />
              )}
              <span className={styles.cardDoneText}>
                <CheckCircle2 size={17} aria-hidden />
                Đã xác nhận
              </span>
              <Button type="button" variant="ghost" disabled={save.isPending} onClick={retake}>
                Chụp lại
              </Button>
            </div>
          )}

          <TextField
            label="Họ tên"
            required
            placeholder="Nguyễn Văn An"
            readOnly={idCardLocked}
            error={errors.fullName?.message}
            {...register("fullName")}
          />

          <div className={styles.pair}>
            <DateField
              label="Ngày sinh"
              required
              readOnly={idCardLocked}
              pickerStart={pickerStartForDob()}
              value={watch("dob")}
              onChange={(v) => setValue("dob", v, { shouldDirty: true, shouldValidate: true })}
              error={errors.dob?.message}
            />
            {maskedId && idCardLocked ? (
              <TextField label="CCCD" readOnly value={`•••• •••• ${customer?.idNumber ?? ""}`} />
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
                readOnly={idCardLocked}
                labelAppend={<CharCount value={watch("idNumber")} max={12} />}
                error={errors.idNumber?.message}
                {...register("idNumber")}
              />
            )}
          </div>

          {showCreatedDay && (
            <DateField
              label="Ngày hồ sơ"
              value={watch("createdDay") ?? ""}
              onChange={(v) => setValue("createdDay", v, { shouldDirty: true, shouldValidate: true })}
              // Đã chốt quà thì ngày hồ sơ không được sau ngày chốt (chốt 2026-09-17).
              max={customer?.giftDay ?? undefined}
              error={errors.createdDay?.message}
            />
          )}

          <Combobox
            block
            required
            label="Địa chỉ"
            placeholder="Gõ để tìm Ấp, Xã, Tỉnh"
            options={addressOptions}
            value={watch("address")}
            onChange={(v) => setValue("address", v, { shouldDirty: true, shouldValidate: true })}
            error={errors.address?.message}
          />

          {/* Bắt buộc từ 2026-09-06. Dòng đầu vẫn là giá trị rỗng để hồ sơ mới
              không tự nhận kênh đầu danh sách; zod chặn lúc Lưu. */}
          <Select
            block
            required
            label="Kênh"
            value={channelId}
            onChange={(v) => {
              setValue("channelId", v, { shouldDirty: true, shouldValidate: true });
              // Chi tiết cũ hết nghĩa khi đổi kênh. Kênh kiểu ấp không đọc ô
              // này — nó kế thừa Địa chỉ lúc lưu (spec §U9).
              setValue("channelDetail", "", { shouldDirty: true });
            }}
            options={[
              { value: "", label: "— Chọn kênh —" },
              ...channels.map((c) => ({ value: c.id, label: c.name })),
            ]}
            error={errors.channelId?.message}
          />

          {selectedChannel?.inputKind === "ward-hamlet" && (
            <p className="text-muted">
              {watch("address").trim() || "(chưa nhập địa chỉ ở trên)"}
            </p>
          )}

          {selectedChannel?.inputKind === "hospital" && (
            <Combobox
              block
              required
              label="Bệnh viện"
              placeholder="Gõ để tìm bệnh viện…"
              value={watch("channelDetail")}
              onChange={(v) => setValue("channelDetail", v, { shouldDirty: true, shouldValidate: true })}
              options={hospitals.map((h) => ({ value: h.name, label: h.name }))}
              error={errors.channelDetail?.message}
            />
          )}

          {selectedChannel?.inputKind === "free-text" && (
            <TextField
              label="Chi tiết kênh"
              required
              error={errors.channelDetail?.message}
              {...register("channelDetail")}
            />
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

      {/* Hộp thoại hỏi lại, KHÔNG phải khối cảnh báo trong biểu mẫu.
          Nó chặn ô CCCD phía dưới, nên không có ca người dùng sửa số rồi bấm
          nút vẫn mang `rootId` của số cũ và nối nhầm vào hồ sơ một khách khác. */}
      {duplicate && !duplicate.info.openDraftId && (
        <DuplicateDialog
          info={duplicate.info}
          typed={duplicate.form}
          pending={save.isPending}
          onClose={() => setDuplicate(null)}
          onCreate={handleSubmit((form) => submit(form, duplicate.info.rootId), reportInvalid)}
        />
      )}

      {/* Người này đang giữ một hồ sơ dở dang của chính khách đó: chỉ báo, không
          hỏi, vì không có lựa chọn nào để chọn. */}
      <ConfirmDialog
        open={Boolean(duplicate?.info.openDraftId)}
        title="Chưa chốt quà hồ sơ trước"
        confirmLabel="Đã hiểu"
        onConfirm={() => setDuplicate(null)}
        onClose={() => setDuplicate(null)}
      >
        Bạn đang có một hồ sơ chưa chốt quà cho khách này. Chốt quà hồ sơ đó rồi mới tạo hồ sơ
        mới.
      </ConfirmDialog>
    </Dialog>
  );
}

type DuplicateDialogProps = {
  info: DuplicateIdInfo;
  /** Biểu mẫu của đúng lượt gửi bị từ chối, để bày cột "vừa nhập". */
  typed: CustomerForm;
  pending: boolean;
  onClose: () => void;
  onCreate: () => void;
};

const ROW_LABEL: Record<DuplicateField, string> = {
  fullName: "Tên",
  dob: "Ngày sinh",
};

/**
 * Hộp thoại hỏi lại khi CCCD trùng.
 *
 * Trùng CCCD chưa chắc là cùng một người: gõ nhầm một số là đụng hồ sơ của
 * người khác. Nên bày hai cột "đang có" và "vừa nhập" cho nhân viên hỏi khách
 * ngay tại chỗ. Khớp hết thì cho tạo; lệch thì KHÔNG có nút tạo (chốt
 * 2026-09-13, thay chốt 2026-09-06 cho chọn "dùng bên nào"): nhân viên đóng
 * hộp, sửa thông tin cho khớp rồi lưu lại. Máy chủ kiểm lại cùng luật ở
 * `createCustomer`.
 *
 * Dòng CCCD hiện cả hai cột dù hai số bằng nhau: người dùng thấy ngay số nào
 * đang đụng, không phải lật lại ô nhập phía dưới.
 *
 * Hộp thoại chặn ô CCCD phía dưới, nên không có ca người dùng sửa số rồi bấm
 * nút vẫn mang `rootId` của số cũ và nối nhầm vào hồ sơ một khách khác.
 */
function DuplicateDialog({ info, typed, pending, onClose, onCreate }: DuplicateDialogProps) {
  const lech = info.mismatch;
  const rootCreator = [info.existing.createdByName, info.existing.createdByDepartmentName]
    .filter(Boolean)
    .join(" - ");
  const dobText = (d: string | null | undefined) => (d ? formatDate(d) : "(trống)");
  const rows: [DuplicateField, string, string][] = [
    ["fullName", info.existing.fullName, typed.fullName],
    ["dob", dobText(info.existing.dob), dobText(typed.dob)],
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title="CCCD này đã có hồ sơ"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {lech.length > 0 ? "Đóng, sửa lại thông tin" : "Huỷ"}
          </Button>
          {lech.length === 0 && (
            <Button disabled={pending} onClick={onCreate}>
              Tạo hồ sơ lần {info.nextSeq}
            </Button>
          )}
        </>
      }
    >
      {lech.length === 0 ? (
        <p>
          CCCD {typed.idNumber} đã có hồ sơ {info.existing.fullName}. Tên, ngày sinh khớp với hồ
          sơ đang có. Tạo hồ sơ lần {info.nextSeq} để mở combo mới?
        </p>
      ) : (
        <div className={styles.compare}>
          <p>Thông tin không khớp để tạo hồ sơ lần {info.nextSeq}.</p>
          <details>
            <summary className={styles.compareToggle}>Xem chi tiết</summary>
            <div className={styles.compareBody}>
              {rootCreator && <p>Người tạo hồ sơ gốc: {rootCreator}</p>}
              <table>
                <thead>
                  <tr>
                    <th scope="col"></th>
                    <th scope="col">Hồ sơ gốc</th>
                    <th scope="col">Vừa nhập</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">CCCD</th>
                    <td>{typed.idNumber}</td>
                    <td>{typed.idNumber}</td>
                  </tr>
                  {rows.map(([f, cu, moi]) => (
                    <tr key={f} className={lech.includes(f) ? styles.compareDiff : undefined}>
                      <th scope="row">{ROW_LABEL[f]}</th>
                      <td>{cu}</td>
                      <td>{moi}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p>
            Nếu khách không phải người này,{" "}
            <strong className={styles.compareWarn}>có thể bạn gõ nhầm CCCD.</strong> Kiểm lại số.
          </p>
        </div>
      )}
    </Dialog>
  );
}
