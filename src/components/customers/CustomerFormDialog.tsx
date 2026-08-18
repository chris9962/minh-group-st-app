"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Select } from "@/components/ui/Select";
import { SkeletonText } from "@/components/ui/Skeleton";
import { TextField } from "@/components/ui/TextField";
import { fetchChannels } from "@/lib/api/channelCatalog";
import {
  createCustomer,
  CustomerEditForm,
  CustomerForm,
  updateCustomer,
  type Customer,
} from "@/lib/api/customers";
import { fetchHospitals } from "@/lib/api/hospitalCatalog";
import { fetchProvinces } from "@/lib/api/wardCatalog";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./CustomerFormDialog.module.scss";

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
  const [provinceId, setProvinceId] = useState("");
  const [wardId, setWardId] = useState("");
  const [hamletId, setHamletId] = useState("");
  /** Người dùng đã tự chọn lại Tỉnh/Xã/Ấp chưa — xem `channelDetailToSave`. */
  const [wardTouched, setWardTouched] = useState(false);
  const selectedProvince = provinces.find((p) => p.id === provinceId);
  const selectedWard = selectedProvince?.wards.find((w) => w.id === wardId);

  const { data: hospitals = [] } = useQuery({
    queryKey: ["hospitals"],
    queryFn: fetchHospitals,
    enabled: selectedChannel?.inputKind === "hospital",
  });

  /**
   * channelDetail của kênh ấp lưu chuỗi TÊN "Tỉnh · Xã · Ấp", không lưu ID —
   * mở form sửa thì phải tra ngược danh mục theo tên để dựng lại ba ô chọn.
   *
   * Ba điều kiện quyết định lúc nào được dựng lại:
   *
   * - `wardTouched`: người dùng tự bỏ chọn Tỉnh thì ĐỂ YÊN. Bản trước không có
   *   điều kiện này nên effect dựng lại ngay từ giá trị gốc, và ô Tỉnh không xoá
   *   được — bỏ chọn xong nó hiện lại y như cũ.
   * - `provinceId`: đã dựng rồi thì thôi, tránh chạy vòng lặp.
   * - `channelId === customer.channelId`: đổi ô Kênh đi rồi đổi về đúng kênh cũ
   *   thì dựng lại lựa chọn đã lưu. Sang kênh khác thì không, vì lựa chọn cũ
   *   không còn nghĩa.
   */
  useEffect(() => {
    if (!editing || !customer?.channelDetail) return;
    if (wardTouched || provinceId || provinces.length === 0) return;
    if (channelId !== customer.channelId) return;
    const channel = channels.find((c) => c.id === customer.channelId);
    if (channel?.inputKind !== "ward-hamlet") return;

    const [provinceName, wardName, hamletName] = customer.channelDetail.split(" · ");
    const province = provinces.find((p) => p.name === provinceName);
    if (!province) return;
    const ward = province.wards.find((w) => w.name === wardName);
    const hamlet = ward?.hamlets.find((h) => h.name === hamletName);

    setProvinceId(province.id);
    if (ward) setWardId(ward.id);
    if (hamlet) setHamletId(hamlet.id);
  }, [editing, customer, channelId, wardTouched, provinceId, channels, provinces]);

  /**
   * Chuỗi kênh ấp SUY RA từ ba ô chọn, tính lúc gửi form — không giữ nó như một
   * state thứ hai rồi đồng bộ bằng tay.
   *
   * Bản trước giữ hai nguồn: ba ô chọn cho phần hiển thị, `channelDetail` cho
   * phần lưu. Đổi ô Kênh hay ô Tỉnh là xoá chuỗi nhưng ba ô vẫn hiện đủ giá trị
   * cũ, nên người dùng bấm Lưu mà không biết chuỗi đã rỗng — và cột đó lưu tên
   * chứ không lưu ID nên mất là mất hẳn.
   *
   * Nhánh cuối giữ chuỗi cũ khi người dùng CHƯA chạm ba ô: chúng có thể trống vì
   * danh mục xã/ấp đổi tên nên tra ngược không ra. Suy chuỗi từ ba ô trống lúc
   * đó là xoá dữ liệu của một hồ sơ mà người dùng chỉ định sửa số điện thoại.
   *
   * Hai loại kênh còn lại giữ nguyên: ô Bệnh viện và ô Chi tiết kênh đọc ghi
   * thẳng vào `channelDetail`, không có nguồn thứ hai để lệch.
   */
  const channelDetailToSave = (form: CustomerForm) => {
    if (selectedChannel?.inputKind !== "ward-hamlet") return form.channelDetail;
    const hamlet = selectedWard?.hamlets.find((h) => h.id === hamletId);
    if (selectedProvince && selectedWard && hamlet)
      return `${selectedProvince.name} · ${selectedWard.name} · ${hamlet.name}`;
    return wardTouched ? "" : form.channelDetail;
  };

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
        onSubmit={handleSubmit((form) =>
          save.mutate({ ...form, channelDetail: channelDetailToSave(form) }),
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
            <TextField
              label="Ngày sinh"
              required
              type="date"
              error={errors.dob?.message}
              {...register("dob")}
            />
            {/* CCCD là trường bảo mật: không có `customer:access-id-number` thì
                máy chủ chỉ trả 4 số cuối và bỏ qua mọi giá trị gửi lên, nên ô
                phải khoá. Để mở mà máy chủ lặng lẽ bỏ qua thì người sửa gõ xong
                bấm Lưu, thấy "đã lưu", rồi mở lại thấy số cũ. */}
            {maskedId ? (
              <TextField
                label="CCCD"
                readOnly
                value={`•••• •••• ${customer?.idNumber ?? ""}`}
                hint="Bạn chỉ được xem 4 số cuối — cần sửa thì nhờ người có quyền xem CCCD."
              />
            ) : (
              <TextField
                label="CCCD"
                required
                placeholder="092301004871"
                error={errors.idNumber?.message}
                {...register("idNumber")}
              />
            )}
          </div>

          <TextField
            label="Địa chỉ"
            required
            placeholder="123 Nguyễn Trãi, Phường Tân Bình"
            error={errors.address?.message}
            {...register("address")}
          />

          <Select
            block
            label="Kênh (tuỳ chọn)"
            value={channelId}
            onChange={(v) => {
              setValue("channelId", v, { shouldDirty: true });
              setValue("channelDetail", "", { shouldDirty: true });
              // Đặt lại, KHÔNG bật: đổi về đúng kênh cũ thì effect dựng lại
              // lựa chọn đã lưu, người dùng không phải chọn lại ba ô.
              setWardTouched(false);
              setProvinceId("");
              setWardId("");
              setHamletId("");
            }}
            options={[
              { value: "", label: "Không có" },
              ...channels.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />

          {selectedChannel?.inputKind === "ward-hamlet" && (
            <>
              <Select
                block
                label="Tỉnh/thành phố"
                value={provinceId}
                onChange={(v) => {
                  setWardTouched(true);
                  setProvinceId(v);
                  setWardId("");
                  setHamletId("");
                }}
                options={[
                  { value: "", label: "— Chọn tỉnh/thành phố —" },
                  ...provinces.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
              {selectedProvince && (
                <Combobox
                  block
                  label="Xã/phường"
                  placeholder="Gõ để tìm xã/phường…"
                  value={wardId}
                  onChange={(v) => {
                    setWardTouched(true);
                    setWardId(v);
                    setHamletId("");
                  }}
                  options={selectedProvince.wards.map((w) => ({ value: w.id, label: w.name }))}
                />
              )}
              {selectedWard && (
                <Select
                  block
                  label="Ấp"
                  value={hamletId}
                  onChange={(v) => {
                    setWardTouched(true);
                    setHamletId(v);
                  }}
                  options={[
                    { value: "", label: "— Chọn ấp —" },
                    ...selectedWard.hamlets.map((h) => ({ value: h.id, label: h.name })),
                  ]}
                />
              )}
            </>
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
