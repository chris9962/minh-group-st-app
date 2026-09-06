"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
  DUPLICATE_FIELD_LABEL,
  DuplicateIdError,
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
      (editing ? CustomerEditForm : CustomerForm)
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
  } = useForm<CustomerForm>({
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
  const channelDetailToSave = (form: CustomerForm) =>
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
  const [duplicate, setDuplicate] = useState<{ info: DuplicateIdInfo; form: CustomerForm } | null>(
    null,
  );

  type SaveArgs = { form: CustomerForm; linkToRootId?: string; keepExisting?: boolean };
  const save = useMutation({
    mutationFn: ({ form, linkToRootId, keepExisting }: SaveArgs) =>
      customer
        ? updateCustomer(customer.id, form)
        : createCustomer(form, linkToRootId, keepExisting),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      if (customer) {
        queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      } else {
        onCreated?.(saved);
      }
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

  const submit = (form: CustomerForm, linkToRootId?: string, keepExisting?: boolean) =>
    save.mutate({
      form: { ...form, channelDetail: channelDetailToSave(form) },
      linkToRootId,
      keepExisting,
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
        onSubmit={handleSubmit((form) => submit(form), reportInvalid)}
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
          onUseTyped={handleSubmit((form) => submit(form, duplicate.info.rootId, false), reportInvalid)}
          onUseExisting={handleSubmit((form) => submit(form, duplicate.info.rootId, true), reportInvalid)}
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
  onUseTyped: () => void;
  onUseExisting: () => void;
};

const ROW_LABEL: Record<DuplicateField, string> = {
  fullName: "Tên",
  dob: "Ngày sinh",
  address: "Địa chỉ",
};

/**
 * Hộp thoại hỏi lại khi CCCD trùng (chủ dự án chốt 2026-09-06).
 *
 * Trùng CCCD chưa chắc là cùng một người: gõ nhầm một số là đụng hồ sơ của
 * người khác. Nên bày hai cột "đang có" và "vừa nhập" cho nhân viên hỏi khách
 * ngay tại chỗ. Khớp hết thì một nút; lệch thì hai nút, và nói rõ nút nào đổi
 * cả hồ sơ đang có.
 *
 * Hộp thoại chặn ô CCCD phía dưới, nên không có ca người dùng sửa số rồi bấm
 * nút vẫn mang `rootId` của số cũ và nối nhầm vào hồ sơ một khách khác.
 */
function DuplicateDialog({
  info,
  typed,
  pending,
  onClose,
  onUseTyped,
  onUseExisting,
}: DuplicateDialogProps) {
  const lech = info.mismatch;
  const dobText = (d: string | null | undefined) => (d ? formatDate(d) : "(trống)");
  const rows: [DuplicateField, string, string][] = [
    ["fullName", info.existing.fullName, typed.fullName],
    ["dob", dobText(info.existing.dob), dobText(typed.dob)],
    ["address", info.existing.address, typed.address],
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title="CCCD này đã có hồ sơ"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          {lech.length > 0 && (
            <Button variant="secondary" disabled={pending} onClick={onUseExisting}>
              Dùng thông tin đang có
            </Button>
          )}
          <Button disabled={pending} onClick={onUseTyped}>
            {lech.length > 0 ? "Dùng thông tin vừa nhập" : "Tạo hồ sơ mới"}
          </Button>
        </>
      }
    >
      {lech.length === 0 ? (
        <p>
          Tên, ngày sinh, địa chỉ khớp với hồ sơ đang có. Tạo thêm một hồ sơ để mở combo mới?
        </p>
      ) : (
        <div className={styles.compare}>
          <p>
            Hồ sơ đang có cùng CCCD nhưng {lech.map((f) => DUPLICATE_FIELD_LABEL[f]).join(", ")}{" "}
            không khớp. Đối chiếu với khách:
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col"></th>
                <th scope="col">Đang có</th>
                <th scope="col">Vừa nhập</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([f, cu, moi]) => (
                <tr key={f} className={lech.includes(f) ? styles.compareDiff : undefined}>
                  <th scope="row">{ROW_LABEL[f]}</th>
                  <td>{cu}</td>
                  <td>{moi}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Nếu khách không phải người này, có thể bạn gõ nhầm CCCD. Bấm Huỷ và kiểm lại số.</p>
          <p>
            <strong>Dùng thông tin vừa nhập</strong>: hồ sơ mới lấy thông tin vừa nhập, và hồ sơ
            đang có cũng đổi theo, có ghi lịch sử.
            <br />
            <strong>Dùng thông tin đang có</strong>: hồ sơ mới chép theo hồ sơ đang có, không đổi
            gì ở hồ sơ cũ.
          </p>
        </div>
      )}
    </Dialog>
  );
}
