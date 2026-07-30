"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { TextField } from "@/components/ui/TextField";
import { fetchKpiTarget, KpiTargetForm, updateKpiTarget } from "@/lib/api/settings";
import styles from "./KpiTargetSection.module.scss";

/** P-83 · Chỉ tiêu KPI theo tháng — một con số chung cho toàn công ty. */
export function KpiTargetSection() {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ["kpi-target"], queryFn: fetchKpiTarget });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<KpiTargetForm>({
    resolver: zodResolver(KpiTargetForm),
    defaultValues: { monthlyPoints: 100, warnDaysLeft: 7 },
  });

  // Nạp giá trị đã lưu vào form khi tải xong — `defaultValues` không tự cập
  // nhật lại lúc dữ liệu về sau khi component đã dựng.
  useEffect(() => {
    if (data) reset(data);
  }, [data, reset]);

  const save = useMutation({
    mutationFn: updateKpiTarget,
    onSuccess: (next) => {
      queryClient.setQueryData(["kpi-target"], next);
      // P-51/P-52 đọc chỉ tiêu này — đổi xong phải thấy ngay ở đó.
      queryClient.invalidateQueries({ queryKey: ["people"] });
      queryClient.invalidateQueries({ queryKey: ["person"] });
    },
  });

  return (
    <SectionCard title="Chỉ tiêu KPI theo tháng" icon={<Target size={17} />}>
      {isPending && <p className="text-muted">Đang tải chỉ tiêu…</p>}

      {!isPending && (
        <form
          className={styles.form}
          onSubmit={handleSubmit((form) => save.mutate(form))}
          noValidate
        >
          {save.isSuccess && <Alert tone="info">Đã lưu chỉ tiêu mới.</Alert>}
          {save.isError && <Alert tone="error">Không lưu được chỉ tiêu này.</Alert>}

          <div className={styles.pair}>
            <TextField
              label="Chỉ tiêu điểm mỗi tháng"
              type="number"
              inputMode="numeric"
              error={errors.monthlyPoints?.message}
              {...register("monthlyPoints", { valueAsNumber: true })}
            />
            <TextField
              label="Cảnh báo khi còn (ngày)"
              type="number"
              inputMode="numeric"
              hint="Số ngày cuối tháng bắt đầu nhắc người chưa đạt"
              error={errors.warnDaysLeft?.message}
              {...register("warnDaysLeft", { valueAsNumber: true })}
            />
          </div>

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
