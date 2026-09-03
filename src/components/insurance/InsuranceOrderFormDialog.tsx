"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { UserCheck } from "lucide-react";
import { DepartmentPicker } from "@/components/layout/DepartmentPicker";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { DateField } from "@/components/ui/DateField";
import { TextField } from "@/components/ui/TextField";
import { AddressField } from "@/components/ui/AddressField";
import { useAddressSuggestions } from "@/lib/useAddressSuggestions";
import type { Customer } from "@/lib/api/customers";
import { createInsuranceOrders } from "@/lib/api/insurance";
import {
  yearsLater,
  InsuranceOrderForm,
  type InsuranceOrderLegForm,
  type InsuranceOrderSource,
} from "@/lib/api/insuranceOrders";
import { isRealIsoDate } from "@/lib/types";
import { PRODUCT_LABEL } from "@/lib/types";
import { fetchInsurancePackages, type InsurancePackage } from "@/lib/api/settings";
import { businessDay, formatVnd } from "@/lib/format";
import { invalidateKpi } from "@/lib/invalidateKpi";
import {
  SUM_INSURED_OPTIONS,
  VEHICLE_TYPE_DEFAULT,
  VEHICLE_TYPES,
  sumInsuredForFee,
} from "@/lib/pvi";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./InsuranceOrderFormDialog.module.scss";
import { digitsOnly, numberValue, numericField } from "@/lib/numberField";
import { reportInvalid } from "@/lib/formErrors";

type Props = {
  open: boolean;
  onClose: () => void;
  customer: Customer;
  source: InsuranceOrderSource;
  /** Cố định gói — dùng khi mở từ luồng Tặng quà (P-43). */
  prefill?: { packageName: string };
  onCreated?: (orders: Awaited<ReturnType<typeof createInsuranceOrders>>) => void;
  /**
   * Có khi hộp thoại này là bước 2 của `CustomerPickerDialog`. Không có khi mở
   * thẳng từ hồ sơ khách (P-42) hoặc luồng Tặng quà — ở đó khách đã cố định,
   * không có bước nào để quay về.
   */
  onBack?: () => void;
};

/**
 * Dựng form theo đúng danh sách leg đã khai ở gói (chốt 04/08) — MỘT LEG = MỘT
 * ĐƠN. Không suy gì từ tên gói.
 *
 * Người thụ hưởng để trống: có thể là người khác hẳn khách hàng (spec §5.4),
 * mặc định sẵn tên khách thì hay gặp ca gõ nhầm rồi phải xoá lại.
 *
 * Ngày mặc định theo `chainsToPrevious` (chốt 2026-09-03): combo nhiều năm CÙNG
 * một loại BH thì đơn sau nối tiếp ngày kết thúc đơn trước, vì khách mua liền
 * mạch chứ không mua hai đơn chạy song song. Gói ghép hai sản phẩm khác nhau
 * vẫn cùng bắt đầu hôm nay.
 */
function defaultLegsFor(pkg: InsurancePackage | null): InsuranceOrderLegForm[] {
  if (!pkg) return [];
  // `toISOString()` cắt theo UTC, mà máy chủ chạy UTC: đơn lập lúc 0-7h sáng
  // giờ Việt Nam mặc định lùi về HÔM QUA (xem lib/format.ts).
  const today = businessDay();
  const legs: InsuranceOrderLegForm[] = [];
  pkg.legs.forEach((leg, i) => {
    const startDate = chainsToPrevious(pkg, i) ? legs[i - 1].endDate : today;
    const values: InsuranceOrderLegForm = {
      product: leg.product,
      packageName: pkg.name,
      // Ngày TẠO đơn, mặc định hôm nay. Khác `startDate` (ngày hiệu lực).
      orderDate: today,
      /** Phí khai riêng cho leg này — trọn thời hạn, không phải chia đều giá gói. */
      fee: leg.fee,
      startDate,
      endDate: yearsLater(startDate, leg.years),
      beneficiaryName: "",
      beneficiaryDob: "",
      beneficiaryAddress: "",
      householdSize: 0,
      // Đơn xe máy không có ô này nên để 0; tai nạn điện chọn sẵn mức đi kèm phí.
      sumInsured: leg.product === "electric-accident" ? sumInsuredForFee(leg.fee) : 0,
      licensePlate: "",
      vehicleType: VEHICLE_TYPE_DEFAULT,
      chassisNumber: "",
      engineNumber: "",
    };
    legs.push(values);
  });
  return legs;
}

/** Đơn thứ `i` nối tiếp đơn liền trước khi hai đơn cùng một loại sản phẩm. */
const chainsToPrevious = (pkg: InsurancePackage | null, i: number): boolean =>
  i > 0 && !!pkg && pkg.legs[i - 1]?.product === pkg.legs[i]?.product;

/** Nhãn từng form. Nhiều đơn thì đánh số để KD biết đang điền đơn nào. */
const legLabel = (pkg: InsurancePackage | null, i: number): string => {
  const leg = pkg?.legs[i];
  if (!leg) return "";
  const label = `${PRODUCT_LABEL[leg.product]} · ${leg.years} năm`;
  return pkg.legs.length > 1 ? `Đơn ${i + 1}/${pkg.legs.length} · ${label}` : label;
};

/**
 * Tạo đơn bảo hiểm — người thụ hưởng có thể khác khách hàng (spec §5.4).
 * Dùng chung cho luồng Tặng quà (`source='gift'`, gói cố định) và mua tự
 * nguyện (`source='self'`, tự chọn gói).
 *
 * Lối vào của `source='self'` từng bị gỡ 2026-08-25 và mở lại 2026-08-28 —
 * nay là nút "Tạo đơn bảo hiểm" ở header màn P-13, qua `CreateInsuranceOrderDialog`.
 *
 * Số form = số leg khai ở gói (chốt 04/08). Mỗi form một bộ ô đầy đủ vì người
 * thụ hưởng của từng đơn có thể khác nhau. Nút "Lấy thông tin khách" ở từng
 * form là đủ — không cần cờ dùng chung người thụ hưởng.
 */
export function InsuranceOrderFormDialog({
  open,
  onClose,
  customer,
  source,
  prefill,
  onCreated,
  onBack,
}: Props) {
  const queryClient = useQueryClient();
  const [packageName, setPackageName] = useState(prefill?.packageName ?? "");
  // Luôn nạp danh mục gói (kể cả luồng Tặng quà gói cố định) — cần phí gói
  // để prefill ô Mức phí của từng đơn.
  const { data: packages = [] } = useQuery({
    queryKey: ["insurance-packages"],
    queryFn: fetchInsurancePackages,
  });

  const selectedPackage = packages.find((p) => p.name === packageName) ?? null;
  const {
    register,
    control,
    setValue,
    getValues,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InsuranceOrderForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(InsuranceOrderForm),
    defaultValues: {
      customerId: customer.id,
      source,
      legs: defaultLegsFor(selectedPackage),
      // Hồ sơ khách đã thuộc về một phòng, nên đơn mở cho khách đó mặc định
      // ghi vào chính phòng ấy (chốt 2026-09-03). Người không thuộc phòng nào
      // vẫn đổi được; máy chủ chốt lại cùng một luật.
      departmentId: customer.createdByDepartmentId ?? "",
    },
  });
  const legsField = useFieldArray({ control, name: "legs" });

  /**
   * Luồng Tặng quà mở hộp thoại với gói CỐ ĐỊNH, nhưng danh mục gói về sau qua
   * query — lúc dựng form chưa biết gói có mấy leg nên `legs` rỗng. Dựng lại
   * một lần khi danh mục về, và chỉ khi người dùng chưa gõ gì.
   *
   * Đây là đồng bộ dữ liệu ngoài vào form, không phải giá trị suy ra được.
   */
  useEffect(() => {
    if (!prefill || !selectedPackage) return;
    if (getValues("legs").length > 0) return;
    legsField.replace(defaultLegsFor(selectedPackage));
  }, [prefill, selectedPackage, getValues, legsField]);

  const selectPackage = (value: string) => {
    setPackageName(value);
    legsField.replace(defaultLegsFor(packages.find((p) => p.name === value) ?? null));
  };

  /**
   * Sửa ngày bắt đầu thì tính lại ngày kết thúc theo số năm của LEG ĐÓ (chốt
   * 2026-09-02) — KD đổi ngày hiệu lực rồi hay quên kéo ngày kết thúc theo.
   * Các đơn nối tiếp phía sau (`chainsToPrevious`) dời theo luôn, nếu không thì
   * KD sửa đơn 1 xong đơn 2 vẫn nằm ở khoảng thời gian cũ và chồng lên đơn 1.
   * Ngày kết thúc vẫn sửa tay được sau đó.
   */
  const changeStartDate = (i: number, v: string) => {
    setValue(`legs.${i}.startDate`, v, { shouldDirty: true, shouldValidate: true });
    if (!isRealIsoDate(v)) return;
    let start = v;
    for (let j = i; j < (selectedPackage?.legs.length ?? 0); j++) {
      const years = selectedPackage?.legs[j]?.years;
      if (!years) break;
      const end = yearsLater(start, years);
      setValue(`legs.${j}.startDate`, start, { shouldDirty: true, shouldValidate: true });
      setValue(`legs.${j}.endDate`, end, { shouldDirty: true, shouldValidate: true });
      if (!chainsToPrevious(selectedPackage, j + 1)) break;
      start = end;
    }
  };

  const applyCustomerInfo = (i: number) => {
    setValue(`legs.${i}.beneficiaryName`, customer.fullName, { shouldDirty: true });
    setValue(`legs.${i}.beneficiaryAddress`, customer.address, { shouldDirty: true });
    // Đơn xe máy không hỏi ngày sinh (ô đã ẩn) — điền vào là gửi lên dữ liệu
    // người dùng không hề thấy để đối chiếu.
    if ((selectedPackage?.legs ?? [])[i]?.product !== "motorbike")
      setValue(`legs.${i}.beneficiaryDob`, customer.dob ?? "", { shouldDirty: true });
  };

  const save = useMutation({
    mutationFn: (form: InsuranceOrderForm) => createInsuranceOrders(form),
    onSuccess: (orders) => {
      queryClient.invalidateQueries({ queryKey: ["insurance-list"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      // Bảng nhân sự P-51 có cột "Đơn BH" đếm từ chính bảng này.
      invalidateKpi(queryClient);
      onCreated?.(orders);
      onClose();
      // Một gói khai mấy leg thì tạo bấy nhiêu đơn — nói ra đủ mã, vì người dùng
      // điền một form và dễ tưởng mình vừa tạo đúng một đơn.
      toast.ok(
        orders.length === 1
          ? `Đã tạo đơn ${orders[0].orderCode}`
          : `Đã tạo ${orders.length} đơn: ${orders.map((o) => o.orderCode).join(", ")}`,
      );
    },
    onError: (e) => toast.fail(errorMessage(e, "Không tạo được đơn bảo hiểm này.")),
  });

  const onSubmit = handleSubmit((values) => save.mutate(values), reportInvalid);

  const addressSuggestions = useAddressSuggestions();

  const renderVehicleInfo = (i: number) => (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Thông tin xe</legend>

      <div className={styles.pair}>
        <TextField
          label="Biển số xe"
          required
          placeholder="67A1-123.45"
          error={errors.legs?.[i]?.licensePlate?.message}
          {...register(`legs.${i}.licensePlate`)}
        />
        <Select
          label="Loại xe"
          value={watch(`legs.${i}.vehicleType`)}
          block
          required
          error={errors.legs?.[i]?.vehicleType?.message}
          // `shouldValidate`: ô này không `register` nên không có onChange của
          // RHF để tự kiểm lại. Thiếu nó thì sau một lần submit hỏng, chọn
          // đúng loại xe rồi dòng chữ đỏ vẫn nằm đó tới lần submit sau.
          onChange={(v) =>
            setValue(`legs.${i}.vehicleType`, v, { shouldDirty: true, shouldValidate: true })
          }
          options={VEHICLE_TYPES.filter((v) => v.code === VEHICLE_TYPE_DEFAULT).map((v) => ({
            value: v.code,
            label: `${v.code} – ${v.label}`,
          }))}
        />
      </div>
      <div className={styles.pair}>
        <TextField
          label="Số khung"
          placeholder="Không bắt buộc"
          error={errors.legs?.[i]?.chassisNumber?.message}
          {...register(`legs.${i}.chassisNumber`)}
        />
        <TextField
          label="Số máy"
          placeholder="Không bắt buộc"
          error={errors.legs?.[i]?.engineNumber?.message}
          {...register(`legs.${i}.engineNumber`)}
        />
      </div>
    </fieldset>
  );

  /**
   * Hai ô form PVI hỏi ở đơn tai nạn điện. Đứng thành khối riêng chứ không lẫn
   * vào "Khách hàng": chúng tả cái HỘ, không tả người đứng tên.
   */
  const renderHouseholdInfo = (i: number) => (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Thông tin hộ</legend>

      <div className={styles.pair}>
        <TextField
          label="Số thành viên"
          type="text"
          inputMode="numeric"
          required
          error={errors.legs?.[i]?.householdSize?.message}
          {...numericField(register(`legs.${i}.householdSize`, { setValueAs: numberValue }), digitsOnly)}
        />
        <Select
          label="Số tiền bảo hiểm"
          block
          required
          value={String(watch(`legs.${i}.sumInsured`))}
          error={errors.legs?.[i]?.sumInsured?.message}
          // `shouldValidate`: ô này không `register` nên không có onChange của
          // RHF để tự kiểm lại sau một lần submit hỏng.
          onChange={(v) =>
            setValue(`legs.${i}.sumInsured`, Number(v), {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
          options={SUM_INSURED_OPTIONS.map((amount) => ({
            value: String(amount),
            label: formatVnd(amount),
          }))}
        />
      </div>
    </fieldset>
  );

  const renderBeneficiary = (i: number) => (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Khách hàng</legend>

      <Button variant="secondary" onClick={() => applyCustomerInfo(i)}>
        <UserCheck size={14} aria-hidden />
        Điền theo hồ sơ khách
      </Button>

      <TextField
        label="Họ tên"
        required
        placeholder="Nguyễn Văn A"
        error={errors.legs?.[i]?.beneficiaryName?.message}
        {...register(`legs.${i}.beneficiaryName`)}
      />
      {/* Đơn BH xe máy không hỏi ngày sinh; đơn tai nạn điện vẫn cần. */}
      {(selectedPackage?.legs ?? [])[i]?.product !== "motorbike" && (
        <DateField
          label="Ngày sinh"
          required
          value={watch(`legs.${i}.beneficiaryDob`)}
          onChange={(v) =>
            setValue(`legs.${i}.beneficiaryDob`, v, { shouldDirty: true, shouldValidate: true })
          }
          error={errors.legs?.[i]?.beneficiaryDob?.message}
        />
      )}
      <AddressField
        label="Địa chỉ"
        required
        placeholder="Gõ để tìm Ấp, Xã, Tỉnh"
        suggestions={addressSuggestions}
        value={watch(`legs.${i}.beneficiaryAddress`)}
        onChange={(v) =>
          setValue(`legs.${i}.beneficiaryAddress`, v, { shouldDirty: true, shouldValidate: true })
        }
        error={errors.legs?.[i]?.beneficiaryAddress?.message}
      />
    </fieldset>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Tạo đơn bảo hiểm"
      footerStart={onBack && <BackButton onClick={onBack}>Chọn khách khác</BackButton>}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="insurance-order-form"
            disabled={isSubmitting || save.isPending || (selectedPackage?.legs ?? []).length === 0}
          >
            Tạo đơn
          </Button>
        </>
      }
    >
      <form id="insurance-order-form" className={styles.form} onSubmit={onSubmit} noValidate>
        <DepartmentPicker
          module="insurance"
          value={watch("departmentId")}
          onChange={(v) => setValue("departmentId", v, { shouldDirty: true })}
        />

        {!prefill && (
          <Select
            block
            label="Gói bảo hiểm"
            required
            value={packageName}
            onChange={selectPackage}
            options={[
              { value: "", label: "— Chọn gói —" },
              // Gói đã ngừng không tặng cho khách mới được nữa. Chỉ lọc ở đây,
              // không lọc `packages`: luồng Tặng quà vẫn cần tra phí gói cũ để
              // prefill đơn đang mở dở.
              ...packages.filter((p) => p.active).map((p) => ({ value: p.name, label: p.name })),
            ]}
          />
        )}


        {legsField.fields.length > 1 &&
          legsField.fields.map((field, i) => (
            <fieldset key={field.id} className={styles.legCard}>
              <legend className={styles.legTitle}>{legLabel(selectedPackage, i)}</legend>

              <DateField
                label="Ngày tạo đơn"
                required
                max={businessDay()}
                hint="Nhập bù cho hôm trước thì sửa lại ngày này"
                error={errors.legs?.[i]?.orderDate?.message}
                value={watch(`legs.${i}.orderDate`)}
                onChange={(v) =>
                  setValue(`legs.${i}.orderDate`, v, { shouldDirty: true, shouldValidate: true })
                }
              />

              <div className={styles.pair}>
                <DateField
                  label="Ngày bắt đầu"
                  required
                  error={errors.legs?.[i]?.startDate?.message}
                  value={watch(`legs.${i}.startDate`)}
                  onChange={(v) => changeStartDate(i, v)}
                />
                <DateField
                  label="Ngày kết thúc"
                  required
                  error={errors.legs?.[i]?.endDate?.message}
                  value={watch(`legs.${i}.endDate`)}
                  onChange={(v) =>
                    setValue(`legs.${i}.endDate`, v, { shouldDirty: true, shouldValidate: true })
                  }
                />
              </div>

              <TextField
                label="Mức phí (đ)"
                type="text"
                inputMode="numeric"
                required
                error={errors.legs?.[i]?.fee?.message}
                {...numericField(register(`legs.${i}.fee`, { setValueAs: numberValue }), digitsOnly)}
              />

              {(selectedPackage?.legs ?? [])[i].product === "motorbike"
                ? renderVehicleInfo(i)
                : renderHouseholdInfo(i)}
              {renderBeneficiary(i)}
            </fieldset>
          ))}

        {legsField.fields.length === 1 && (
          <>
            <DateField
              label="Ngày tạo đơn"
              required
              max={businessDay()}
              hint="Nhập bù cho hôm trước thì sửa lại ngày này"
              error={errors.legs?.[0]?.orderDate?.message}
              value={watch("legs.0.orderDate")}
              onChange={(v) =>
                setValue("legs.0.orderDate", v, { shouldDirty: true, shouldValidate: true })
              }
            />

            <div className={styles.pair}>
              <DateField
                label="Ngày bắt đầu"
                required
                error={errors.legs?.[0]?.startDate?.message}
                value={watch("legs.0.startDate")}
                onChange={(v) => changeStartDate(0, v)}
              />
              <DateField
                label="Ngày kết thúc"
                required
                error={errors.legs?.[0]?.endDate?.message}
                value={watch("legs.0.endDate")}
                onChange={(v) =>
                  setValue("legs.0.endDate", v, { shouldDirty: true, shouldValidate: true })
                }
              />
            </div>
            <TextField
              label="Mức phí (đ)"
              type="text"
              inputMode="numeric"
              required
              error={errors.legs?.[0]?.fee?.message}
              {...numericField(register("legs.0.fee", { setValueAs: numberValue }), digitsOnly)}
            />
            {(selectedPackage?.legs ?? [])[0].product === "motorbike"
              ? renderVehicleInfo(0)
              : renderHouseholdInfo(0)}
            {renderBeneficiary(0)}
          </>
        )}
      </form>
    </Dialog>
  );
}
