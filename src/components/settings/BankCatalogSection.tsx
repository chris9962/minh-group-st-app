"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
import { errorMessage, toast } from "@/lib/toast";

/** P-60 · Kho ngân hàng — danh sách phẳng, mỗi dòng một ngân hàng độc lập. */
export function BankCatalogSection() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Bank | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<Bank | null>(null);

  const { data: banks = [], isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["banks"],
    queryFn: fetchBanks,
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => setBankActive(id, next),
    onSuccess: (_item, { next }) => {
      queryClient.invalidateQueries({ queryKey: ["banks"] });
      toast.ok(next ? "Đã bật lại ngân hàng" : "Đã ngừng ngân hàng");
      setConfirming(null);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đổi được trạng thái ngân hàng này.")),
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
            onClick={() => setConfirming(b)}
          >
            {b.active ? "Tắt" : "Bật lại"}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <SectionCard
        title="Kho ngân hàng"
        icon={<Landmark size={17} />}
        meta={isPending ? undefined : `${banks.length} dòng`}
        /* Nút nằm NGANG HÀNG TIÊU ĐỀ, không nằm dưới bảng: bảng cắt 15 dòng
           một trang nên nút bị đẩy khỏi màn hình điện thoại, muốn thêm một
           ngân hàng phải cuộn hết bảng xuống rồi cuộn ngược lên. */
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            Thêm ngân hàng
          </Button>
        }
      >
        {isPending && <SkeletonTable rows={5} columns={5} />}
        {isError && (
          <ErrorState what="kho ngân hàng" onRetry={refetch} retrying={isFetching} />
        )}

        {!isPending && !isError && (
          <RankTable
            rows={banks}
            columns={columns}
            rowKey={(b) => b.id}
            defaultSort="code"
            pageSize={15}
            caption="Ngân hàng và các trường cấu hình"
            emptyText="Chưa có ngân hàng nào — bấm “Thêm ngân hàng” ở góc trên."
          />
        )}

        <p className={styles.footnote}>
          <strong>Tắt</strong> chỉ chặn tạo tài khoản mới — tài khoản cũ thuộc
          ngân hàng đã tắt vẫn hiển thị và xuất được bình thường. VPa/VPb và
          MSBa/MSBb là bốn ngân hàng riêng biệt dù cùng một nhà băng ngoài đời:
          khác mã giới thiệu, khác chính sách.
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

      <ConfirmDialog
        open={confirming !== null}
        title={confirming?.active ? "Tắt ngân hàng" : "Bật lại ngân hàng"}
        confirmLabel={confirming?.active ? "Tắt" : "Bật lại"}
        pending={toggleActive.isPending}
        onConfirm={() =>
          confirming && toggleActive.mutate({ id: confirming.id, next: !confirming.active })
        }
        onClose={() => setConfirming(null)}
        consequence={
          confirming?.active ? (
            <>
              Ngân hàng biến mất khỏi ô chọn lúc mở tài khoản và lúc nhập mã giới
              thiệu nên <strong>không mở tài khoản mới cho ngân hàng này được nữa</strong>.
              Tài khoản đã mở và mã đã cấp vẫn giữ nguyên, bật lại lúc nào cũng được.
            </>
          ) : (
            <>Ngân hàng hiện lại ở mọi ô chọn và nhận tài khoản mới được ngay.</>
          )
        }
      >
        {confirming?.active ? "Tắt ngân hàng " : "Bật lại ngân hàng "}
        <strong>{confirming?.code}</strong>?
      </ConfirmDialog>
    </>
  );
}
