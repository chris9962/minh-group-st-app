"use client";

import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Signpost } from "lucide-react";
import { useState } from "react";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/Button";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { fetchChannels, INPUT_KIND_LABEL, type Channel } from "@/lib/api/channelCatalog";
import { ChannelFormDialog } from "./ChannelFormDialog";
import styles from "./ChannelCatalogSection.module.scss";

/**
 * P-70 · Danh mục kênh — mỗi kênh mang theo "kiểu nhập kèm" của riêng nó, app
 * chỉ vẽ ô nhập theo kiểu này chứ không biết kênh tên là gì (spec §2.3).
 */
export function ChannelCatalogSection() {
  const [editing, setEditing] = useState<Channel | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: channels = [], isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["channels"],
    queryFn: fetchChannels,
  });

  const columns: RankColumn<Channel>[] = [
    { key: "name", label: "Tên kênh", render: (c) => c.name },
    {
      key: "inputKind",
      label: "Nhập thêm khi chọn kênh này",
      render: (c) => INPUT_KIND_LABEL[c.inputKind],
    },
    {
      key: "actions",
      label: "Thao tác",
      render: (c) => (
        <span className={styles.actions}>
          <Button
            variant="secondary"
            icon
            aria-label={`Sửa kênh ${c.name}`}
            onClick={() => setEditing(c)}
          >
            <Pencil size={16} aria-hidden />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <SectionCard title="Danh mục kênh" icon={<Signpost size={17} />} meta={`${channels.length} kênh`}>
        {isPending && <SkeletonTable rows={5} columns={4} />}
        {isError && (
          <ErrorState what="danh mục kênh" onRetry={refetch} retrying={isFetching} />
        )}

        {!isPending && !isError && (
          <RankTable
            rows={channels}
            columns={columns}
            rowKey={(c) => c.id}
            defaultSort="name"
            caption="Kênh và kiểu nhập kèm theo từng kênh"
          />
        )}

        <div className={styles.footRow}>
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            Thêm kênh
          </Button>
        </div>

        <p className={styles.footnote}>
          Thêm kênh mới xong chọn đúng <strong>kiểu nhập kèm</strong> là app tự
          hiện ô tương ứng cho KD — không cần sửa code hay phát hành lại app.
        </p>
      </SectionCard>

      {(creating || editing) && (
        <ChannelFormDialog
          open
          channel={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
