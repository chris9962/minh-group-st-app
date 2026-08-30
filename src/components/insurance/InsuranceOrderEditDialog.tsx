"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Select } from "@/components/ui/Select";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { DateField } from "@/components/ui/DateField";
import { TextField } from "@/components/ui/TextField";
import { fetchInsuranceDetail, updateInsuranceOrder } from "@/lib/api/insurance";
import {
  insuranceOrderEditSchema,
  type InsuranceOrderEditForm,
} from "@/lib/api/insuranceOrders";
import { businessDay, formatVnd } from "@/lib/format";
import { SUM_INSURED_OPTIONS, VEHICLE_TYPES } from "@/lib/pvi";
import { errorMessage, toast } from "@/lib/toast";
import { PRODUCT_LABEL } from "@/lib/types";
import styles from "./InsuranceOrderFormDialog.module.scss";
import { digitsOnly, numberValue, numericField } from "@/lib/numberField";
import { reportInvalid } from "@/lib/formErrors";

type Props = {
  open: boolean;
  onClose: () => void;
  orderId: string;
};

/**
 * Hai bậc PVI bán, cộng bậc của chính đơn này nếu nó nằm ngoài hai bậc đó.
 *
 * Đơn ghi trước khi có cột `sum_insured` mang giá trị 0, và đơn cũ có thể mang
 * một mức PVI từng bán rồi bỏ. Không chèn dòng đó thì ô chọn hiện sai giá trị
 * đang lưu, người sửa một ô khác cũng vô tình ghi đè mức chi trả của hợp đồng.
 */
const sumInsuredOptions = (current: number) => {
  const options = SUM_INSURED_OPTIONS.map((amount) => ({
    value: String(amount),
    label: formatVnd(amount),
  }));
  if (SUM_INSURED_OPTIONS.some((a) => a === current)) return options;
  return [
    { value: String(current), label: current === 0 ? "— Chưa chọn —" : formatVnd(current) },
    ...options,
  ];
};

/**
 * Sửa một đơn CHƯA hoàn thành, mở thẳng từ bảng P-13.
 *
 * Không sửa được: khách hàng, sản phẩm, gói, nguồn gốc — bốn thứ đó là danh
 * tính của đơn, đổi chúng là biến bản ghi này thành một đơn khác hẳn. Chúng
 * hiện ra ở đầu hộp thoại để đối chiếu.
 *
 * Tự tải chi tiết theo `orderId` chứ không nhận sẵn dòng bảng: form cần các
 * trường người thụ hưởng và thông tin sản phẩm không nằm trên dòng danh sách.
 *
 * KHÔNG có nút Xoá đơn ở đây: bảng bên ngoài đã có nút xoá kèm hộp xác nhận nói
 * rõ hệ quả. Đường xoá thứ hai nằm sát nút "Huỷ" của hộp thoại là đặt bẫy đúng
 * chỗ ngón tay quen bấm.
 */
export function InsuranceOrderEditDialog({ open, onClose, orderId }: Props) {
  const queryClient = useQueryClient();

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["insurance-detail", orderId],
    queryFn: () => fetchInsuranceDetail(orderId),
  });

  const motorbike = data?.product === "motorbike";

  const form = useForm<InsuranceOrderEditForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    // Luật biển số phụ thuộc sản phẩm, mà sản phẩm chỉ biết sau khi chi tiết về
    // — máy chủ kiểm lại đúng luật này với sản phẩm đọc từ database.
    resolver: zodResolver(insuranceOrderEditSchema(data?.product ?? "electric-accident")),
    // `values` chứ không phải `defaultValues`: chi tiết về SAU lượt render đầu,
    // mà `defaultValues` chỉ đọc một lần nên form sẽ trống mãi.
    values: {
      orderDate: data?.orderDate ?? "",
      fee: data?.fee ?? 0,
      startDate: data?.startDate ?? "",
      endDate: data?.endDate ?? "",
      beneficiaryName: data?.beneficiaryName ?? "",
      beneficiaryDob: data?.beneficiaryDob ?? "",
      beneficiaryAddress: data?.beneficiaryAddress ?? "",
      householdSize: data?.householdSize ?? 0,
      sumInsured: data?.sumInsured ?? 0,
      licensePlate: data?.licensePlate ?? "",
      vehicleType: data?.vehicleType ?? "",
      chassisNumber: data?.chassisNumber ?? "",
      engineNumber: data?.engineNumber ?? "",
    },
  });

  const save = useMutation({
    mutationFn: (values: InsuranceOrderEditForm) => updateInsuranceOrder(orderId, values),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ["insurance-list"] });
      queryClient.invalidateQueries({ queryKey: ["insurance-detail", orderId] });
      queryClient.invalidateQueries({ queryKey: ["customer", order.customerId] });
      onClose();
      toast.ok(`Đã lưu thay đổi đơn ${order.orderCode}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được thay đổi này.")),
  });

  const { errors } = form.formState;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Sửa đơn bảo hiểm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="insurance-edit-form" disabled={!data || save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      {isPending && <SkeletonCard lines={6} />}
      {isError && <ErrorState what="đơn bảo hiểm này" onRetry={refetch} retrying={isFetching} />}

      {data && (
        <form
          id="insurance-edit-form"
          className={styles.form}
          onSubmit={form.handleSubmit((values) => save.mutate(values), reportInvalid)}
          noValidate
        >
          <p className="text-muted">
            {data.orderCode} · {PRODUCT_LABEL[data.product]} · {data.packageName} ·{" "}
            {data.customerName}
          </p>

          {/* Ngày TẠO đơn — đổi nó là đổi tháng mà đơn này được tính. Khác hẳn
              ngày hiệu lực bên dưới. */}
          <DateField
            label="Ngày tạo đơn"
            required
            max={businessDay()}
            hint="Nhập bù cho hôm trước thì sửa lại ngày này"
            error={errors.orderDate?.message}
            value={form.watch("orderDate")}
            onChange={(v) =>
              form.setValue("orderDate", v, { shouldDirty: true, shouldValidate: true })
            }
          />

          <div className={styles.pair}>
            <DateField
              label="Ngày bắt đầu"
              required
              error={errors.startDate?.message}
              value={form.watch("startDate")}
              onChange={(v) =>
                form.setValue("startDate", v, { shouldDirty: true, shouldValidate: true })
              }
            />
            <DateField
              label="Ngày kết thúc"
              required
              error={errors.endDate?.message}
              value={form.watch("endDate")}
              onChange={(v) =>
                form.setValue("endDate", v, { shouldDirty: true, shouldValidate: true })
              }
            />
          </div>

          <TextField
            label="Mức phí (đ)"
            type="text"
            inputMode="numeric"
            required
            error={errors.fee?.message}
            {...numericField(form.register("fee", { setValueAs: numberValue }), digitsOnly)}
          />

          {motorbike && (
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Thông tin xe</legend>

              <div className={styles.pair}>
                <TextField
                  label="Biển số xe"
                  required
                  placeholder="67A1-123.45"
                  error={errors.licensePlate?.message}
                  {...form.register("licensePlate")}
                />
                <Select
                  label="Loại xe"
                  value={form.watch("vehicleType")}
                  block
                  required
                  error={errors.vehicleType?.message}
                  // `shouldValidate`: ô này không `register` nên không có onChange
                  // của RHF để tự kiểm lại. Thiếu nó thì sau một lần submit hỏng,
                  // chọn đúng loại xe rồi dòng chữ đỏ vẫn nằm đó.
                  onChange={(v) =>
                    form.setValue("vehicleType", v, { shouldDirty: true, shouldValidate: true })
                  }
                  options={[
                    { value: "", label: "— Chọn loại xe —" },
                    ...VEHICLE_TYPES.map((v) => ({ value: v.code, label: `${v.code} – ${v.label}` })),
                  ]}
                />
              </div>

              <div className={styles.pair}>
                <TextField
                  label="Số khung"
                  placeholder="Không bắt buộc"
                  error={errors.chassisNumber?.message}
                  {...form.register("chassisNumber")}
                />
                <TextField
                  label="Số máy"
                  placeholder="Không bắt buộc"
                  error={errors.engineNumber?.message}
                  {...form.register("engineNumber")}
                />
              </div>
            </fieldset>
          )}

          {!motorbike && (
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Thông tin hộ</legend>

              <div className={styles.pair}>
                <TextField
                  label="Số thành viên"
                  type="text"
                  inputMode="numeric"
                  required
                  error={errors.householdSize?.message}
                  {...numericField(form.register("householdSize", { setValueAs: numberValue }), digitsOnly)}
                />
                <Select
                  label="Số tiền bảo hiểm"
                  block
                  required
                  value={String(form.watch("sumInsured"))}
                  error={errors.sumInsured?.message}
                  onChange={(v) =>
                    form.setValue("sumInsured", Number(v), {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  options={sumInsuredOptions(data.sumInsured)}
                />
              </div>
            </fieldset>
          )}

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Khách hàng</legend>

            <TextField
              label="Họ tên"
              required
              placeholder="Nguyễn Văn A"
              error={errors.beneficiaryName?.message}
              {...form.register("beneficiaryName")}
            />
            {/* Đơn BH xe máy không hỏi ngày sinh; đơn tai nạn điện vẫn cần. */}
            {!motorbike && (
              <DateField
                label="Ngày sinh"
                required
                value={form.watch("beneficiaryDob")}
                onChange={(v) =>
                  form.setValue("beneficiaryDob", v, { shouldDirty: true, shouldValidate: true })
                }
                error={errors.beneficiaryDob?.message}
              />
            )}
            <TextField
              label="Địa chỉ"
              required
              error={errors.beneficiaryAddress?.message}
              {...form.register("beneficiaryAddress")}
            />
          </fieldset>
        </form>
      )}
    </Dialog>
  );
}
