"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { fetchChannels } from "@/lib/api/channelCatalog";
import {
  createCustomer,
  CustomerForm,
  isDuplicateCustomerError,
  updateCustomer,
  type Customer,
  type DuplicateCustomerError,
} from "@/lib/api/customers";
import { fetchHospitals } from "@/lib/api/hospitalCatalog";
import { fetchProvinces } from "@/lib/api/wardCatalog";
import { formatPhone } from "@/lib/format";
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const editing = Boolean(customer);
  const maskedId = Boolean(customer?.idNumberMasked);
  const [duplicate, setDuplicate] = useState<DuplicateCustomerError | null>(null);

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
    enabled: selectedChannel?.inputKind === "ward-hamlet",
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
    onError: (err) => {
      // Trùng CCCD KHÔNG báo bằng toast: hộp thoại đổi sang khối "hồ sơ đã có"
      // kèm nút dùng lại, mà toast thì trôi mất sau vài giây và không bấm được.
      if (isDuplicateCustomerError(err)) {
        setDuplicate(err);
        return;
      }
      toast.fail(errorMessage(err, "Không lưu được hồ sơ khách này."));
    },
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
        duplicate ? (
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" form="customer-form" disabled={isSubmitting || save.isPending}>
              {editing ? "Lưu" : "Tạo khách hàng"}
            </Button>
          </>
        )
      }
    >
      {duplicate ? (
        <div className={styles.duplicate}>
          <Alert tone="warning">
            CCCD <strong>{watch("idNumber")}</strong> đã có hồ sơ trong hệ thống.
          </Alert>
          <div className={styles.existingCard}>
            <strong>{duplicate.existing.fullName}</strong>
            <span>{formatPhone(duplicate.existing.primaryPhone)}</span>
            <span>
              {duplicate.existing.accountCount} tài khoản ngân hàng ·{" "}
              {duplicate.existing.insuranceCount} đơn bảo hiểm
            </span>
          </div>
          <div className={styles.duplicateActions}>
            <Button
              variant="secondary"
              onClick={() => {
                router.push(`/customers/${duplicate.existing.id}`);
                onClose();
              }}
            >
              Dùng hồ sơ này
            </Button>
            <Button onClick={() => setDuplicate(null)}>Kiểm tra lại số CCCD</Button>
          </div>
        </div>
      ) : (
        <form
          id="customer-form"
          className={styles.form}
          onSubmit={handleSubmit((form) => save.mutate(form))}
          noValidate
        >
          <TextField
            label="Họ tên"
            placeholder="Nguyễn Văn An"
            error={errors.fullName?.message}
            {...register("fullName")}
          />

          <div className={styles.pair}>
            <TextField label="Ngày sinh" type="date" {...register("dob")} />
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
                placeholder="092301004871"
                hint="Bỏ trống nếu khách chưa cung cấp"
                error={errors.idNumber?.message}
                {...register("idNumber")}
              />
            )}
          </div>

          <TextField
            label="Địa chỉ"
            placeholder="123 Nguyễn Trãi, Phường Tân Bình"
            {...register("address")}
          />

          <Select
            block
            label="Kênh"
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
              {editing && watch("channelDetail") && !selectedWard && (
                <p className="text-muted">
                  Đang lưu: {watch("channelDetail")} — chọn lại xã/ấp nếu muốn đổi.
                </p>
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
      )}
    </Dialog>
  );
}
