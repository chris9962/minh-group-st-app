"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  ACCOUNT_NUMBER_METHOD_LABEL,
  fetchBanks,
  setBankActive,
  type Bank,
} from "@/lib/api/bankCatalog";
import { BankFormDialog } from "./BankFormDialog";
import styles from "./BankCatalogSection.module.scss";

/** P-60 · Kho ngân hàng — danh sách phẳng, mỗi dòng một ngân hàng độc lập. */
export function BankCatalogSection() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Bank | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: banks = [], isPending, isError } = useQuery({
    queryKey: ["banks"],
    queryFn: fetchBanks,
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => setBankActive(id, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["banks"] }),
  });

  const columns: RankColumn<Bank>[] = [
    { key: "code", label: "Mã ngân hàng", render: (b) => b.code },
    {
      key: "requiredPhotos",
      label: "Số ảnh bắt buộc",
      sortBy: (b) => b.requiredPhotos,
      render: (b) => b.requiredPhotos,
    },
    {
      key: "accountNumberMethod",
      label: "Cách lấy số tài khoản",
      render: (b) => ACCOUNT_NUMBER_METHOD_LABEL[b.accountNumberMethod],
    },
    {
      key: "coefficient",
      label: "Hệ số điểm KPI",
      sortBy: (b) => b.coefficient,
      render: (b) => b.coefficient,
    },
    {
      key: "countsAsApp",
      label: "Đi kèm app",
      render: (b) => (
        <StatusTag ok={b.countsAsApp}>{b.countsAsApp ? "Có" : "Không"}</StatusTag>
      ),
    },
    {
      key: "active",
      label: "Trạng thái",
      render: (b) => (
        <StatusTag ok={b.active}>{b.active ? "Đang triển khai" : "Đã tắt"}</StatusTag>
      ),
    },
    {
      key: "actions",
      label: "Thao tác",
      render: (b) => (
        <span className={styles.actions}>
          <Button
            variant="secondary"
            icon
            aria-label={`Sửa ${b.code}`}
            onClick={() => setEditing(b)}
          >
            <Pencil size={16} aria-hidden />
          </Button>
          <Button
            variant="secondary"
            disabled={toggleActive.isPending}
            onClick={() => toggleActive.mutate({ id: b.id, next: !b.active })}
          >
            {b.active ? "Tắt" : "Bật lại"}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <SectionCard title="Kho ngân hàng" icon={<Landmark size={17} />} meta={`${banks.length} dòng`}>
        {isPending && <p className="text-muted">Đang tải danh sách…</p>}
        {isError && <p className="text-muted">Không tải được kho ngân hàng.</p>}

        {!isPending && !isError && (
          <RankTable
            rows={banks}
            columns={columns}
            rowKey={(b) => b.id}
            defaultSort="code"
            pageSize={15}
            caption="Ngân hàng và các trường cấu hình"
          />
        )}

        <div className={styles.footRow}>
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            Thêm ngân hàng
          </Button>
        </div>

        <p className={styles.footnote}>
          <strong>Tắt</strong> chỉ chặn tạo tài khoản mới — tài khoản cũ thuộc
          ngân hàng đã tắt vẫn hiển thị và xuất được bình thường. VPa/VPb và
          MSBa/MSBb là bốn ngân hàng riêng biệt dù cùng một nhà băng ngoài đời:
          khác mã giới thiệu, khác hệ số điểm, khác chính sách.
        </p>
      </SectionCard>

      {(creating || editing) && (
        <BankFormDialog
          open
          bank={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
