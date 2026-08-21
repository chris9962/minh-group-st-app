"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { UserCheck } from "lucide-react";
import { DepartmentPicker } from "@/components/layout/DepartmentPicker";
import { Button } from "@/components/ui/Button";
import { CharCount } from "@/components/ui/CharCount";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { DateField } from "@/components/ui/DateField";
import { TextField } from "@/components/ui/TextField";
import type { Customer } from "@/lib/api/customers";
import { createInsuranceOrders } from "@/lib/api/insurance";
import {
  yearsLater,
  InsuranceOrderForm,
  type InsuranceOrderLegForm,
  type InsuranceOrderSource,
} from "@/lib/api/insuranceOrders";
import { PRODUCT_LABEL } from "@/lib/types";
import { fetchInsurancePackages, type InsurancePackage } from "@/lib/api/settings";
import { businessDay, formatVnd } from "@/lib/format";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { SUM_INSURED_DEFAULT, SUM_INSURED_OPTIONS, VEHICLE_TYPES } from "@/lib/pvi";
import { errorMessage, toast } from "@/lib/toast";
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
 * Dựng form theo đúng danh sách leg đã khai ở gói (chốt 04/08) — MỘT LEG = MỘT
 * ĐƠN. Không suy gì từ tên gói.
 *
 * Người thụ hưởng để trống: có thể là người khác hẳn khách hàng (spec §5.4),
 * mặc định sẵn tên khách thì hay gặp ca gõ nhầm rồi phải xoá lại.
 *
 * Mỗi đơn mặc định hôm nay → hôm nay + số năm của LEG ĐÓ. Cố ý KHÔNG tự nối
 * ngày giữa các đơn: gói hai năm tai nạn điện thì KD tự sửa ngày đơn thứ hai
 * cho khớp, còn gói ghép thì hai sản phẩm vốn cùng bắt đầu hôm nay — không có
 * cấu hình nào phân biệt hai ca đó nữa.
 */
function defaultLegsFor(pkg: InsurancePackage | null): InsuranceOrderLegForm[] {
  if (!pkg) return [];
  // `toISOString()` cắt theo UTC, mà máy chủ chạy UTC: đơn lập lúc 0-7h sáng
  // giờ Việt Nam mặc định lùi về HÔM QUA (xem lib/format.ts).
  const today = businessDay();
  return pkg.legs.map((leg) => {
    const values: InsuranceOrderLegForm = {
      product: leg.product,
      packageName: pkg.name,
      // Mặc định TẮT — người thụ hưởng có thể là người khác hẳn. Bật lên khi
      // người dùng bấm "Điền theo khách hàng".
      beneficiaryIsCustomer: false,
      // Ngày TẠO đơn, mặc định hôm nay. Khác `startDate` (ngày hiệu lực).
      orderDate: today,
      /** Phí khai riêng cho leg này — trọn thời hạn, không phải chia đều giá gói. */
      fee: leg.fee,
      startDate: today,
      endDate: yearsLater(today, leg.years),
      beneficiaryName: "",
      beneficiaryDob: "",
      beneficiaryIdNumber: "",
      beneficiaryPhone: "",
      beneficiaryAddress: "",
      householdSize: 0,
      // Đơn xe máy không có ô này nên để 0; tai nạn điện chọn sẵn bậc hay bán.
      sumInsured: leg.product === "electric-accident" ? SUM_INSURED_DEFAULT : 0,
      licensePlate: "",
      vehicleType: "",
      chassisNumber: "",
      engineNumber: "",
    };
    return values;
  });
}

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
 * Số form = số leg khai ở gói (chốt 04/08). Mỗi form một bộ ô đầy đủ, kể cả
 * khi hai đơn cùng một người: xe máy định danh bằng GPLX còn tai nạn điện bằng
 * CCCD (P-10), chưa chắc cùng một người. Nút "Lấy thông tin khách" ở từng form
 * là đủ — không cần cờ dùng chung người thụ hưởng.
 */
export function InsuranceOrderFormDialog({
  open,
  onClose,
  customer,
  source,
  prefill,
  onCreated,
}: Props) {
  const queryClient = useQueryClient();
  const [packageName, setPackageName] = useState(prefill?.packageName ?? "");
  const primaryPhone = customer.phones.find((p) => p.primary)?.number ?? "";

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
    resolver: zodResolver(InsuranceOrderForm),
    defaultValues: {
      customerId: customer.id,
      source,
      legs: defaultLegsFor(selectedPackage),
      departmentId: "",
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

  const applyCustomerInfo = (i: number) => {
    setValue(`legs.${i}.beneficiaryName`, customer.fullName, { shouldDirty: true });
    /**
     * Bật cờ để MÁY CHỦ tự lấy CCCD đầy đủ từ DB.
     *
     * Không chép `customer.idNumber` nữa: người không có `customer:access-id-number`
     * chỉ cầm 4 số cuối, chép vào là hợp đồng mang CCCD cụt và PVI từ chối.
     * Ô để trống, máy chủ điền hộ lúc tạo đơn.
     */
    setValue(`legs.${i}.beneficiaryIsCustomer`, true, { shouldDirty: true });
    setValue(`legs.${i}.beneficiaryIdNumber`, customer.idNumberMasked ? "" : (customer.idNumber ?? ""), {
      shouldDirty: true,
    });
    setValue(`legs.${i}.beneficiaryPhone`, primaryPhone, { shouldDirty: true });
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
      onCreated?.();
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

  const onSubmit = handleSubmit((values) => save.mutate(values));

  const renderVehicleInfo = (i: number) => (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Thông tin xe</legend>

      <div className={styles.pair}>
        <TextField
          label="Biển số xe"
          required
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
          options={[
            { value: "", label: "— Chọn loại xe —" },
            ...VEHICLE_TYPES.map((v) => ({ value: v.code, label: `${v.code} – ${v.label}` })),
          ]}
        />
      </div>
      <div className={styles.pair}>
        <TextField label="Số khung" hint="Không bắt buộc" {...register(`legs.${i}.chassisNumber`)} />
        <TextField label="Số máy" hint="Không bắt buộc" {...register(`legs.${i}.engineNumber`)} />
      </div>
    </fieldset>
  );

  /**
   * Hai ô form PVI hỏi ở đơn tai nạn điện. Đứng thành khối riêng chứ không lẫn
   * vào "Người thụ hưởng": chúng tả cái HỘ, không tả người đứng tên.
   */
  const renderHouseholdInfo = (i: number) => (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Thông tin hộ</legend>

      <div className={styles.pair}>
        <TextField
          label="Số thành viên"
          type="number"
          inputMode="numeric"
          min={1}
          required
          error={errors.legs?.[i]?.householdSize?.message}
          {...register(`legs.${i}.householdSize`, { valueAsNumber: true })}
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
      <legend className={styles.legend}>Người thụ hưởng</legend>

      <Button variant="secondary" onClick={() => applyCustomerInfo(i)}>
        <UserCheck size={14} aria-hidden />
        Điền theo khách hàng
      </Button>

      <TextField
        label="Họ tên"
        required
        error={errors.legs?.[i]?.beneficiaryName?.message}
        {...register(`legs.${i}.beneficiaryName`)}
      />
      {/* Đơn BH xe máy không cần ngày sinh — định danh bằng GPLX/biển số, PVI
          không hỏi trường này (spec P-10). Đơn tai nạn điện thì vẫn cần. */}
      {(selectedPackage?.legs ?? [])[i]?.product === "motorbike" ? (
        <TextField
            label="CCCD"
            required={!watch(`legs.${i}.beneficiaryIsCustomer`)}
            inputMode="numeric"
            maxLength={12}
            labelAppend={
              <CharCount value={watch(`legs.${i}.beneficiaryIdNumber`)} max={12} />
            }
            /**
             * Ô rỗng + chấm mờ khi máy chủ sẽ tự điền. KHÔNG hiện 4 số cuối ở
             * đây: trong một ô nhập, "7872" đọc ra như một CCCD đã điền xong và
             * người nhập tưởng số đã đủ. Màn hồ sơ khách hiện `•••• •••• 7872`
             * thì khác — ở đó nó là chữ để đối chiếu giấy tờ, không phải ô gõ.
             */
            placeholder={
              watch(`legs.${i}.beneficiaryIsCustomer`) ? "•••• •••• ••••" : undefined
            }
            hint={
              watch(`legs.${i}.beneficiaryIsCustomer`)
                ? "Lấy theo hồ sơ khách khi lưu — gõ vào ô này nếu người thụ hưởng là người khác"
                : undefined
            }
            error={errors.legs?.[i]?.beneficiaryIdNumber?.message}
            {...register(`legs.${i}.beneficiaryIdNumber`, {
              // Gõ tay = người thụ hưởng không còn là khách, tắt cờ để máy chủ
              // dùng đúng số vừa gõ thay vì móc lại CCCD của khách.
              onChange: () => setValue(`legs.${i}.beneficiaryIsCustomer`, false),
            })}
          />
      ) : (
        <div className={styles.pair}>
          <DateField
            label="Ngày sinh"
            required
            value={watch(`legs.${i}.beneficiaryDob`)}
            onChange={(v) =>
              setValue(`legs.${i}.beneficiaryDob`, v, { shouldDirty: true, shouldValidate: true })
            }
            error={errors.legs?.[i]?.beneficiaryDob?.message}
          />
          <TextField
            label="CCCD"
            required={!watch(`legs.${i}.beneficiaryIsCustomer`)}
            inputMode="numeric"
            maxLength={12}
            labelAppend={
              <CharCount value={watch(`legs.${i}.beneficiaryIdNumber`)} max={12} />
            }
            /**
             * Ô rỗng + chấm mờ khi máy chủ sẽ tự điền. KHÔNG hiện 4 số cuối ở
             * đây: trong một ô nhập, "7872" đọc ra như một CCCD đã điền xong và
             * người nhập tưởng số đã đủ. Màn hồ sơ khách hiện `•••• •••• 7872`
             * thì khác — ở đó nó là chữ để đối chiếu giấy tờ, không phải ô gõ.
             */
            placeholder={
              watch(`legs.${i}.beneficiaryIsCustomer`) ? "•••• •••• ••••" : undefined
            }
            hint={
              watch(`legs.${i}.beneficiaryIsCustomer`)
                ? "Lấy theo hồ sơ khách khi lưu — gõ vào ô này nếu người thụ hưởng là người khác"
                : undefined
            }
            error={errors.legs?.[i]?.beneficiaryIdNumber?.message}
            {...register(`legs.${i}.beneficiaryIdNumber`, {
              // Gõ tay = người thụ hưởng không còn là khách, tắt cờ để máy chủ
              // dùng đúng số vừa gõ thay vì móc lại CCCD của khách.
              onChange: () => setValue(`legs.${i}.beneficiaryIsCustomer`, false),
            })}
          />
        </div>
      )}
      <TextField
        label="Số điện thoại"
        required
        inputMode="numeric"
        maxLength={10}
        labelAppend={<CharCount value={watch(`legs.${i}.beneficiaryPhone`)} max={10} />}
        error={errors.legs?.[i]?.beneficiaryPhone?.message}
        {...register(`legs.${i}.beneficiaryPhone`)}
      />
      <TextField
        label="Địa chỉ"
        required
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

              <TextField
                label="Ngày tạo đơn"
                type="date"
                required
                max={businessDay()}
                hint="Nhập bù cho hôm trước thì sửa lại ngày này"
                error={errors.legs?.[i]?.orderDate?.message}
                {...register(`legs.${i}.orderDate`)}
              />

              <div className={styles.pair}>
                <TextField
                  label="Ngày bắt đầu"
                  type="date"
                  required
                  error={errors.legs?.[i]?.startDate?.message}
                  {...register(`legs.${i}.startDate`)}
                />
                <TextField
                  label="Ngày kết thúc"
                  type="date"
                  required
                  error={errors.legs?.[i]?.endDate?.message}
                  {...register(`legs.${i}.endDate`)}
                />
              </div>

              <TextField
                label="Mức phí (đ)"
                type="number"
                inputMode="numeric"
                required
                error={errors.legs?.[i]?.fee?.message}
                {...register(`legs.${i}.fee`, { valueAsNumber: true })}
              />

              {(selectedPackage?.legs ?? [])[i].product === "motorbike"
                ? renderVehicleInfo(i)
                : renderHouseholdInfo(i)}
              {renderBeneficiary(i)}
            </fieldset>
          ))}

        {legsField.fields.length === 1 && (
          <>
            <TextField
              label="Ngày tạo đơn"
              type="date"
              required
              max={businessDay()}
              hint="Nhập bù cho hôm trước thì sửa lại ngày này"
              error={errors.legs?.[0]?.orderDate?.message}
              {...register("legs.0.orderDate")}
            />

            <div className={styles.pair}>
              <TextField
                label="Ngày bắt đầu"
                type="date"
                required
                error={errors.legs?.[0]?.startDate?.message}
                {...register("legs.0.startDate")}
              />
              <TextField
                label="Ngày kết thúc"
                type="date"
                required
                error={errors.legs?.[0]?.endDate?.message}
                {...register("legs.0.endDate")}
              />
            </div>
            <TextField
              label="Mức phí (đ)"
              type="number"
              inputMode="numeric"
              required
              error={errors.legs?.[0]?.fee?.message}
              {...register("legs.0.fee", { valueAsNumber: true })}
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
