"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Wrench } from "lucide-react";
import { useState } from "react";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { fetchServiceTypeMonth, setServiceTypeActive, type ServiceTypeRow } from "@/lib/api/settings";
import { formatPoints } from "@/lib/format";
import { ServiceTypeFormDialog } from "./ServiceTypeFormDialog";
import styles from "./ServiceTypeSection.module.scss";
import { errorMessage, toast } from "@/lib/toast";

type Props = {
  /** Tháng của trọng số đang xem và đang sửa. */
  month: string;
  /**
   * Nút "Thêm loại dịch vụ" nằm ở thanh tiêu đề TRANG, đồng bộ với P-60 và
   * P-61 — nên trạng thái mở hộp thoại do trang giữ, khối này chỉ nhận vào.
   */
  creating: boolean;
  onCreatingChange: (creating: boolean) => void;
};

/** P-84 · Danh mục loại dịch vụ + hệ số điểm KPI. */
export function ServiceTypeSection({ month, creating, onCreatingChange }: Props) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ServiceTypeRow | null>(null);
  const [confirming, setConfirming] = useState<ServiceTypeRow | null>(null);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["service-types", month],
    queryFn: () => fetchServiceTypeMonth(month),
  });
  const rows = data?.rows ?? [];
  const locked = data?.locked ?? false;

  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => setServiceTypeActive(id, next),
    onSuccess: (_item, { next }) => {
      queryClient.invalidateQueries({ queryKey: ["service-types"] });
      toast.ok(next ? "Đã bật lại loại dịch vụ" : "Đã ngừng loại dịch vụ");
      setConfirming(null);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đổi được trạng thái loại dịch vụ này.")),
  });

  const columns: RankColumn<ServiceTypeRow>[] = [
    { key: "name", label: "Tên loại dịch vụ", render: (r) => r.name },
    {
      key: "coefficient",
      label: "Hệ số điểm",
      sortBy: (r) => r.coefficient,
      render: (r) => formatPoints(r.coefficient),
    },
    {
      key: "cap",
      label: "Giới hạn lượt",
      render: (r) =>
        [
          r.dailyCap === null
            ? null
            : r.overCapCoefficient > 0
              ? `${r.dailyCap} lượt/ngày, lượt vượt ${formatPoints(r.overCapCoefficient)} điểm`
              : `${r.dailyCap} lượt/ngày`,
          r.monthlyCap === null ? null : `${r.monthlyCap} lượt/tháng`,
        ]
          .filter(Boolean)
          .join(" - ") || "Không giới hạn",
    },
    {
      key: "active",
      label: "Trạng thái",
      render: (r) => (
        <StatusTag ok={r.active}>{r.active ? "Đang dùng" : "Đã ngừng"}</StatusTag>
      ),
    },
    {
      key: "actions",
      label: "Thao tác",
      render: (r) => (
        <span className={styles.actions}>
          <Button
            variant="secondary"
            icon
            tooltip="Sửa loại dịch vụ"
            aria-label={`Sửa ${r.name}`}
            onClick={() => setEditing(r)}
          >
            <Pencil size={16} aria-hidden />
          </Button>
          <Button
            variant={r.active ? "danger" : "secondary"}
            disabled={toggleActive.isPending}
            onClick={() => setConfirming(r)}
          >
            {r.active ? "Ngừng" : "Dùng lại"}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <SectionCard
        title="Loại dịch vụ"
        icon={<Wrench size={17} />}
        meta={isPending ? undefined : `${rows.length} loại`}
        action={locked ? <StatusTag tone="neutral">Đã chốt lương</StatusTag> : undefined}
      >
        {isPending && <SkeletonTable rows={5} columns={4} />}
        {isError && (
          <ErrorState what="danh mục loại dịch vụ" onRetry={refetch} retrying={isFetching} />
        )}

        {!isPending && !isError && (
          <RankTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            defaultSort="name"
            pageSize={10}
            caption="Loại dịch vụ và hệ số điểm KPI"
            emptyText="Chưa có loại dịch vụ nào — bấm “Thêm loại dịch vụ” ở đầu trang."
          />
        )}
      </SectionCard>

      {(creating || editing) && (
        <ServiceTypeFormDialog
          open
          month={month}
          locked={locked}
          serviceType={editing}
          onClose={() => {
            onCreatingChange(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={confirming?.active ? "Ngừng loại dịch vụ" : "Dùng lại loại dịch vụ"}
        confirmLabel={confirming?.active ? "Ngừng" : "Dùng lại"}
        pending={toggleActive.isPending}
        onConfirm={() =>
          confirming && toggleActive.mutate({ id: confirming.id, next: !confirming.active })
        }
        onClose={() => setConfirming(null)}
      >
        Bạn muốn {confirming?.active ? "ngừng" : "dùng lại"} loại dịch vụ{" "}
        <strong>{confirming?.name}</strong>?
      </ConfirmDialog>
    </>
  );
}
