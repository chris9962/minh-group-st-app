"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { fetchChannels } from "@/lib/api/channelCatalog";
import { createCustomer, CustomerForm, updateCustomer, type Customer } from "@/lib/api/customers";
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
export function CustomerFormDialog({ open, onClose, customer, onCreated }: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(customer);
  const maskedId = Boolean(customer?.idNumberMasked);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CustomerForm>({
    resolver: zodResolver(CustomerForm),
    defaultValues: customer ? toForm(customer) : emptyForm,
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
  const selectedProvince = provinces.find((p) => p.id === provinceId);
  const selectedWard = selectedProvince?.wards.find((w) => w.id === wardId);

  const { data: hospitals = [] } = useQuery({
    queryKey: ["hospitals"],
    queryFn: fetchHospitals,
    enabled: selectedChannel?.inputKind === "hospital",
  });

  // channelDetail của kênh ấp lưu chuỗi TÊN "Tỉnh · Xã · Ấp" (xem onChange của ô
  // Ấp bên dưới), không lưu ID — nên khi mở form sửa phải tra ngược catalog theo
  // tên để dựng lại ba ô chọn đã chọn trước đó.
  useEffect(() => {
    if (!editing || provinceId || !customer?.channelDetail) return;
    const channel = channels.find((c) => c.id === customer.channelId);
    if (channel?.inputKind !== "ward-hamlet" || provinces.length === 0) return;

    const [provinceName, wardName, hamletName] = customer.channelDetail.split(" · ");
    const province = provinces.find((p) => p.name === provinceName);
    if (!province) return;
    const ward = province.wards.find((w) => w.name === wardName);
    const hamlet = ward?.hamlets.find((h) => h.name === hamletName);

    setProvinceId(province.id);
    if (ward) setWardId(ward.id);
    if (hamlet) setHamletId(hamlet.id);
  }, [editing, provinceId, customer?.channelId, customer?.channelDetail, channels, provinces]);

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
          <Button type="submit" form="customer-form" disabled={isSubmitting || save.isPending}>
            {editing ? "Lưu" : "Tạo khách hàng"}
          </Button>
        </>
      }
    >
      <form
        id="customer-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
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
                  setProvinceId(v);
                  setWardId("");
                  setHamletId("");
                  setValue("channelDetail", "", { shouldDirty: true });
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
                    setWardId(v);
                    setHamletId("");
                    setValue("channelDetail", "", { shouldDirty: true });
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
                    setHamletId(v);
                    const hamlet = selectedWard.hamlets.find((h) => h.id === v);
                    setValue(
                      "channelDetail",
                      hamlet
                        ? `${selectedProvince?.name} · ${selectedWard.name} · ${hamlet.name}`
                        : "",
                      { shouldDirty: true },
                    );
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
    </Dialog>
  );
}
