"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Select } from "@/components/ui/Select";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { TextField } from "@/components/ui/TextField";
import { fetchInsuranceDetail, updateInsuranceOrder } from "@/lib/api/insurance";
import {
  insuranceOrderEditSchema,
  type InsuranceOrderEditForm,
} from "@/lib/api/insuranceOrders";
import { businessDay } from "@/lib/format";
import { VEHICLE_TYPES } from "@/lib/pvi";
import { errorMessage, toast } from "@/lib/toast";
import { PRODUCT_LABEL } from "@/lib/types";
import styles from "./InsuranceOrderFormDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  orderId: string;
};

/**
 * Sửa một đơn CHƯA hoàn thành, mở thẳng từ bảng P-13.
 *
 * Không sửa được: khách hàng, sản phẩm, gói, nguồn gốc — bốn thứ đó là danh
 * tính của đơn, đổi chúng là biến bản ghi này thành một đơn khác hẳn. Chúng
 * hiện ra ở đầu hộp thoại để đối chiếu.
 *
 * Tự tải chi tiết theo `orderId` chứ không nhận sẵn dòng bảng: dòng bảng cố ý
 * không mang bốn trường người thụ hưởng (một trong số đó là CCCD), mà thiếu
 * chúng thì không dựng nổi form.
 *
 * KHÔNG có nút Huỷ đơn ở đây: bảng bên ngoài đã có nút xoá kèm hộp xác nhận nói
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
      beneficiaryIdNumber: data?.beneficiaryIdNumber ?? "",
      beneficiaryPhone: data?.beneficiaryPhone ?? "",
      beneficiaryAddress: data?.beneficiaryAddress ?? "",
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
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          noValidate
        >
          <p className="text-muted">
            {data.orderCode} · {PRODUCT_LABEL[data.product]} · {data.packageName} ·{" "}
            {data.customerName}
          </p>

          {/* Ngày BÁN đơn — đổi nó là đổi tháng mà đơn này được tính. Khác hẳn
              ngày hiệu lực bên dưới. */}
          <TextField
            label="Ngày đơn"
            type="date"
            max={businessDay()}
            hint="Ngày bán đơn cho khách"
            error={errors.orderDate?.message}
            {...form.register("orderDate")}
          />

          <div className={styles.pair}>
            <TextField label="Ngày bắt đầu" type="date" {...form.register("startDate")} />
            <TextField label="Ngày kết thúc" type="date" {...form.register("endDate")} />
          </div>

          <TextField
            label="Mức phí (đ)"
            type="number"
            inputMode="numeric"
            error={errors.fee?.message}
            {...form.register("fee", { valueAsNumber: true })}
          />

          {motorbike && (
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Thông tin xe</legend>

              <div className={styles.pair}>
                <TextField
                  label="Biển số xe"
                  error={errors.licensePlate?.message}
                  {...form.register("licensePlate")}
                />
                <Select
                  label="Loại xe"
                  value={form.watch("vehicleType")}
                  block
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
              {errors.vehicleType && <p className={styles.error}>{errors.vehicleType.message}</p>}

              <div className={styles.pair}>
                <TextField label="Số khung" hint="Không bắt buộc" {...form.register("chassisNumber")} />
                <TextField label="Số máy" hint="Không bắt buộc" {...form.register("engineNumber")} />
              </div>
            </fieldset>
          )}

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Người thụ hưởng</legend>

            <TextField
              label="Họ tên"
              error={errors.beneficiaryName?.message}
              {...form.register("beneficiaryName")}
            />
            {/* Đơn BH xe máy không hỏi ngày sinh — định danh bằng GPLX/biển số,
                PVI không hỏi trường này (spec P-10). */}
            {motorbike ? (
              <TextField label="CCCD" {...form.register("beneficiaryIdNumber")} />
            ) : (
              <div className={styles.pair}>
                <TextField label="Ngày sinh" type="date" {...form.register("beneficiaryDob")} />
                <TextField label="CCCD" {...form.register("beneficiaryIdNumber")} />
              </div>
            )}
            <TextField label="Số điện thoại" {...form.register("beneficiaryPhone")} />
            <TextField
              label="Địa chỉ"
              error={errors.beneficiaryAddress?.message}
              {...form.register("beneficiaryAddress")}
            />
          </fieldset>
        </form>
      )}
    </Dialog>
  );
}
