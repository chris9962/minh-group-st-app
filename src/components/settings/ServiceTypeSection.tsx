"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Wrench } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { fetchServiceTypes, setServiceTypeActive, type ServiceTypeRow } from "@/lib/api/settings";
import { ServiceTypeFormDialog } from "./ServiceTypeFormDialog";
import styles from "./ServiceTypeSection.module.scss";

/** P-84 · Danh mục loại dịch vụ + hệ số điểm KPI. */
export function ServiceTypeSection() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ServiceTypeRow | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: rows = [], isPending, isError } = useQuery({
    queryKey: ["service-types"],
    queryFn: fetchServiceTypes,
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => setServiceTypeActive(id, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["service-types"] }),
  });

  const columns: RankColumn<ServiceTypeRow>[] = [
    { key: "name", label: "Tên loại dịch vụ", render: (r) => r.name },
    {
      key: "coefficient",
      label: "Hệ số điểm",
      sortBy: (r) => r.coefficient,
      render: (r) => r.coefficient,
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
            aria-label={`Sửa ${r.name}`}
            onClick={() => setEditing(r)}
          >
            <Pencil size={16} aria-hidden />
          </Button>
          <Button
            variant="secondary"
            disabled={toggleActive.isPending}
            onClick={() => toggleActive.mutate({ id: r.id, next: !r.active })}
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
        meta={`${rows.length} loại`}
      >
        {isPending && <p className="text-muted">Đang tải danh mục…</p>}
        {isError && <p className="text-muted">Không tải được danh mục loại dịch vụ.</p>}

        {!isPending && !isError && (
          <RankTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            defaultSort="name"
            pageSize={10}
            caption="Loại dịch vụ và hệ số điểm KPI"
          />
        )}

        <div className={styles.footRow}>
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            Thêm loại dịch vụ
          </Button>
        </div>

        <p className={styles.footnote}>
          Mặc định hệ số <strong>1</strong> cho loại mới — số cụ thể theo từng
          loại cập nhật sau khi có dữ liệu thật.
        </p>
      </SectionCard>

      {(creating || editing) && (
        <ServiceTypeFormDialog
          open
          serviceType={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
