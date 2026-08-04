"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { UserCheck } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import type { Customer } from "@/lib/api/customers";
import {
  createInsuranceOrder,
  insuranceOrderLegsFor,
  oneYearLater,
  InsuranceOrderForm,
  type InsuranceOrderLegForm,
  type InsuranceOrderLegGroup,
  type InsuranceOrderSource,
} from "@/lib/api/insuranceOrders";
import { fetchInsurancePackages } from "@/lib/api/settings";
import { useSession } from "@/store/session";
import styles from "./InsuranceOrderFormDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  customer: Customer;
  source: InsuranceOrderSource;
  /** Cố định gói — dùng khi mở từ luồng Tặng quà (P-43). */
  prefill?: { packageName: string };
  onCreated?: () => void;
};

/**
 * Người thụ hưởng để trống — có thể là người khác hẳn khách hàng (spec §5.4),
 * mặc định sẵn tên khách thì hay gặp ca gõ nhầm rồi phải xoá lại. Năm sau nối
 * ngay sau năm trước — không có khoảng trống giữa hai hợp đồng.
 */
function defaultLegsFor(group: InsuranceOrderLegGroup): InsuranceOrderLegForm[] {
  let start = new Date().toISOString().slice(0, 10);
  return group.legs.map((leg) => {
    const end = oneYearLater(start);
    const values: InsuranceOrderLegForm = {
      product: leg.product,
      packageName: leg.packageName,
      // Phí gói chia đều các đơn nó sinh ra (combo 200k → 2 đơn 100k) — chỉ là
      // số prefill, người nhập sửa được từng đơn.
      fee: 0,
      startDate: start,
      endDate: end,
      beneficiaryName: "",
      beneficiaryDob: "",
      beneficiaryIdNumber: "",
      beneficiaryPhone: "",
      beneficiaryAddress: "",
      licensePlate: "",
      vehicleType: "",
      chassisNumber: "",
      engineNumber: "",
    };
    start = end;
    return values;
  });
}

const legLabel = (group: InsuranceOrderLegGroup, i: number): string => {
  const leg = group.legs[i];
  return group.sharedBeneficiary && group.legs.length > 1
    ? `${leg.product} · Năm thứ ${i + 1}`
    : `${leg.product} · ${leg.packageName}`;
};

/**
 * Tạo đơn bảo hiểm — người thụ hưởng có thể khác khách hàng (spec §5.4).
 * Dùng chung cho luồng Tặng quà (`source='gift'`, gói cố định) và mua tự
 * nguyện (`source='self'`, tự chọn gói).
 *
 * Một gói có thể sinh NHIỀU đơn (`insuranceOrderLegsFor`, spec §4.4/§5.4):
 * gói ghép hai sản phẩm khác nhau hiện đủ hai form riêng — mỗi sản phẩm một
 * người thụ hưởng, vì xe máy theo GPLX còn tai nạn điện theo CCCD, chưa chắc
 * cùng một người (P-10). Gói nhiều năm CÙNG một sản phẩm (2 năm tai nạn điện)
 * dùng chung một người thụ hưởng nhưng có từng cặp ngày bắt đầu/kết thúc
 * riêng cho mỗi năm, vì hãng chỉ phát hành hợp đồng 1 năm nối tiếp.
 */
export function InsuranceOrderFormDialog({
  open,
  onClose,
  customer,
  source,
  prefill,
  onCreated,
}: Props) {
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const [packageName, setPackageName] = useState(prefill?.packageName ?? "");
  const legGroup = insuranceOrderLegsFor(packageName);
  const primaryPhone = customer.phones.find((p) => p.primary)?.number ?? "";

  // Luôn nạp danh mục gói (kể cả luồng Tặng quà gói cố định) — cần phí gói
  // để prefill ô Mức phí của từng đơn.
  const { data: packages = [] } = useQuery({
    queryKey: ["insurance-packages"],
    queryFn: fetchInsurancePackages,
  });

  const packageFee = packages.find((p) => p.name === packageName)?.yearlyFee ?? null;

  /** Phí gói chia đều các đơn nó sinh ra — chỉ là prefill, sửa được từng đơn. */
  const withFees = (legs: InsuranceOrderLegForm[], fee: number | null): InsuranceOrderLegForm[] =>
    fee === null || legs.length === 0
      ? legs
      : legs.map((leg) => ({ ...leg, fee: Math.round(fee / legs.length) }));

  const {
    register,
    control,
    setValue,
    getValues,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InsuranceOrderForm>({
    resolver: zodResolver(InsuranceOrderForm),
    defaultValues: {
      customerId: customer.id,
      source,
      legs: defaultLegsFor(legGroup),
    },
  });
  const legsField = useFieldArray({ control, name: "legs" });

  // Luồng Tặng quà: legs dựng NGAY lúc mở (gói cố định) nhưng phí gói về sau
  // qua query — đồng bộ một lần khi danh mục về, chỉ khi người dùng chưa gõ gì
  // (fee còn 0). Đây là sync dữ liệu ngoài vào form, không phải derived state.
  useEffect(() => {
    if (!prefill || packageFee === null) return;
    const legs = getValues("legs");
    if (legs.length === 0 || legs.some((leg) => leg.fee !== 0)) return;
    const share = Math.round(packageFee / legs.length);
    legs.forEach((_, i) => setValue(`legs.${i}.fee`, share));
  }, [prefill, packageFee, getValues, setValue]);

  const selectPackage = (value: string) => {
    setPackageName(value);
    const fee = packages.find((p) => p.name === value)?.yearlyFee ?? null;
    legsField.replace(withFees(defaultLegsFor(insuranceOrderLegsFor(value)), fee));
  };

  const applyCustomerInfo = (i: number) => {
    setValue(`legs.${i}.beneficiaryName`, customer.fullName, { shouldDirty: true });
    setValue(`legs.${i}.beneficiaryDob`, customer.dob ?? "", { shouldDirty: true });
    setValue(`legs.${i}.beneficiaryIdNumber`, customer.idNumber ?? "", { shouldDirty: true });
    setValue(`legs.${i}.beneficiaryPhone`, primaryPhone, { shouldDirty: true });
    setValue(`legs.${i}.beneficiaryAddress`, customer.address, { shouldDirty: true });
  };

  const save = useMutation({
    mutationFn: (form: InsuranceOrderForm) => createInsuranceOrder(form, actor?.id ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      onCreated?.();
      onClose();
    },
  });

  const onSubmit = handleSubmit((values) => {
    // Nhiều năm CÙNG một sản phẩm dùng chung người thụ hưởng — chỉ hiện một bộ
    // ô nhập (năm đầu) nên phải chép sang các năm sau trước khi gửi đi.
    const legs = legGroup.sharedBeneficiary
      ? values.legs.map((leg, i) =>
          i === 0
            ? leg
            : {
                ...leg,
                beneficiaryName: values.legs[0].beneficiaryName,
                beneficiaryDob: values.legs[0].beneficiaryDob,
                beneficiaryIdNumber: values.legs[0].beneficiaryIdNumber,
                beneficiaryPhone: values.legs[0].beneficiaryPhone,
                beneficiaryAddress: values.legs[0].beneficiaryAddress,
              },
        )
      : values.legs;
    save.mutate({ ...values, legs });
  });

  const renderVehicleInfo = (i: number) => (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Thông tin xe</legend>

      <div className={styles.pair}>
        <TextField
          label="Biển số xe"
          error={errors.legs?.[i]?.licensePlate?.message}
          {...register(`legs.${i}.licensePlate`)}
        />
        <TextField
          label="Loại xe"
          placeholder="Xe số, tay ga, xe điện…"
          error={errors.legs?.[i]?.vehicleType?.message}
          {...register(`legs.${i}.vehicleType`)}
        />
      </div>
      <div className={styles.pair}>
        <TextField label="Số khung" hint="Không bắt buộc" {...register(`legs.${i}.chassisNumber`)} />
        <TextField label="Số máy" hint="Không bắt buộc" {...register(`legs.${i}.engineNumber`)} />
      </div>
    </fieldset>
  );

  const renderBeneficiary = (i: number) => (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Người thụ hưởng</legend>

      <Button variant="secondary" onClick={() => applyCustomerInfo(i)}>
        <UserCheck size={14} aria-hidden />
        Điền theo khách hàng
      </Button>

      <TextField
        label="Họ tên"
        error={errors.legs?.[i]?.beneficiaryName?.message}
        {...register(`legs.${i}.beneficiaryName`)}
      />
      <div className={styles.pair}>
        <TextField label="Ngày sinh" type="date" {...register(`legs.${i}.beneficiaryDob`)} />
        <TextField label="CCCD" {...register(`legs.${i}.beneficiaryIdNumber`)} />
      </div>
      <TextField label="Số điện thoại" {...register(`legs.${i}.beneficiaryPhone`)} />
      <TextField
        label="Địa chỉ"
        placeholder="123 Nguyễn Trãi, Phường Tân Bình"
        error={errors.legs?.[i]?.beneficiaryAddress?.message}
        {...register(`legs.${i}.beneficiaryAddress`)}
      />
    </fieldset>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Tạo đơn bảo hiểm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="insurance-order-form"
            disabled={isSubmitting || save.isPending || legGroup.legs.length === 0}
          >
            Tạo đơn
          </Button>
        </>
      }
    >
      <form id="insurance-order-form" className={styles.form} onSubmit={onSubmit} noValidate>
        {save.isError && <Alert tone="error">Không tạo được đơn bảo hiểm này.</Alert>}

        {!prefill && (
          <Select
            block
            label="Gói bảo hiểm"
            value={packageName}
            onChange={selectPackage}
            options={[
              { value: "", label: "— Chọn gói —" },
              ...packages.map((p) => ({ value: p.name, label: p.name })),
            ]}
          />
        )}


        {legsField.fields.length > 1 &&
          legsField.fields.map((field, i) => (
            <fieldset key={field.id} className={styles.legCard}>
              <legend className={styles.legTitle}>{legLabel(legGroup, i)}</legend>

              <div className={styles.pair}>
                <TextField label="Ngày bắt đầu" type="date" {...register(`legs.${i}.startDate`)} />
                <TextField label="Ngày kết thúc" type="date" {...register(`legs.${i}.endDate`)} />
              </div>

              <TextField
                label="Mức phí (đ)"
                type="number"
                inputMode="numeric"
                error={errors.legs?.[i]?.fee?.message}
                {...register(`legs.${i}.fee`, { valueAsNumber: true })}
              />

              {legGroup.legs[i].product === "BH xe máy" && renderVehicleInfo(i)}
              {(!legGroup.sharedBeneficiary || i === 0) && renderBeneficiary(i)}
            </fieldset>
          ))}

        {legsField.fields.length === 1 && (
          <>
            <div className={styles.pair}>
              <TextField label="Ngày bắt đầu" type="date" {...register("legs.0.startDate")} />
              <TextField label="Ngày kết thúc" type="date" {...register("legs.0.endDate")} />
            </div>
            <TextField
              label="Mức phí (đ)"
              type="number"
              inputMode="numeric"
              error={errors.legs?.[0]?.fee?.message}
              {...register("legs.0.fee", { valueAsNumber: true })}
            />
            {legGroup.legs[0].product === "BH xe máy" && renderVehicleInfo(0)}
            {renderBeneficiary(0)}
          </>
        )}
      </form>
    </Dialog>
  );
}
