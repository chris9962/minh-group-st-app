"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { useForm } from "react-hook-form";
import { SkeletonText } from "@/components/ui/Skeleton";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { SectionCard } from "@/components/ui/SectionCard";
import { TextField } from "@/components/ui/TextField";
import { fetchKpiTarget, KpiTargetForm, updateKpiTarget } from "@/lib/api/settings";
import styles from "./KpiTargetSection.module.scss";
import { errorMessage, toast } from "@/lib/toast";
import { reportInvalid } from "@/lib/formErrors";

/** P-83 · Chỉ tiêu KPI theo tháng — một con số chung cho toàn công ty. */
export function KpiTargetSection() {
  const queryClient = useQueryClient();
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["kpi-target"],
    queryFn: fetchKpiTarget,
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<KpiTargetForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(KpiTargetForm),
    defaultValues: { monthlyPoints: 100 },
    // `values` chứ không phải effect + `reset`: giá trị suy ra từ dữ liệu đã
    // tải, tính thẳng lúc render (AGENTS.md §7).
    values: data ?? undefined,
  });

  const save = useMutation({
    mutationFn: updateKpiTarget,
    onSuccess: (next) => {
      queryClient.setQueryData(["kpi-target"], next);
      // P-51/P-52 đọc chỉ tiêu này — đổi xong phải thấy ngay ở đó.
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["person"] });
      toast.ok("Đã lưu chỉ tiêu mới");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được chỉ tiêu này.")),
  });

  return (
    <SectionCard title="Chỉ tiêu KPI theo tháng" icon={<Target size={17} />}>
      {isPending && <SkeletonText lines={2} label="Đang tải chỉ tiêu" />}
      {isError && <ErrorState what="chỉ tiêu KPI" onRetry={refetch} retrying={isFetching} />}

      {/*
        Bám vào `isError`, KHÔNG chỉ `!isPending`. Tải hỏng thì `isPending` cũng
        thành false, form hiện ra với `defaultValues` 100 trông y như số đã lưu
        — quản trị bấm "Lưu chỉ tiêu" là ghi đè chỉ tiêu thật của cả công ty
        bằng một con số bịa.

        `data === null` thì KHÁC: đó là "chưa ai đặt mốc", form phải hiện ra mới
        đặt được lần đầu, chỉ cần nói rõ con số đang là gợi ý chứ không phải số
        đã lưu.
      */}
      {!isPending && !isError && (
        <form
          className={styles.form}
          onSubmit={handleSubmit((form) => save.mutate(form), reportInvalid)}
          noValidate
        >
          {data === null && (
            <Alert tone="warning">
              Chưa đặt chỉ tiêu cho tháng này. Con số dưới đây là{" "}
              <strong>gợi ý</strong>, chưa được lưu — sửa lại cho đúng rồi bấm Lưu.
            </Alert>
          )}

          <TextField
            label="Chỉ tiêu điểm mỗi tháng"
            type="number"
            inputMode="numeric"
            error={errors.monthlyPoints?.message}
            {...register("monthlyPoints", { valueAsNumber: true })}
          />

          <div className={styles.footRow}>
            <Button type="submit" disabled={isSubmitting || save.isPending}>
              Lưu chỉ tiêu
            </Button>
          </div>

          <p className={styles.footnote}>
            Áp dụng <strong>chung cho toàn công ty</strong>, chưa tách riêng theo
            phòng hay từng người. Đổi ở đây thì bảng Nhân sự &amp; KPI (P-51) và
            hồ sơ từng nhân viên (P-52) đổi theo ngay.
          </p>
        </form>
      )}
    </SectionCard>
  );
}
