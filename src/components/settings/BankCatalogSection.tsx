"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Landmark, Pencil } from "lucide-react";
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
import { BankGuideDialog } from "@/components/banking/BankGuideDialog";
import { banksInScope } from "@/lib/permissions";
import { errorMessage, toast } from "@/lib/toast";
import { useSession } from "@/store/session";

type Props = {
  /**
   * Nút "Thêm ngân hàng" nằm ở thanh tiêu đề TRANG, đồng bộ với P-40 và P-51 —
   * nên trạng thái mở hộp thoại do trang giữ, khối này chỉ nhận vào.
   */
  creating: boolean;
  onCreatingChange: (creating: boolean) => void;
};

/** P-60 · Kho ngân hàng — danh sách phẳng, mỗi dòng một ngân hàng độc lập. */
export function BankCatalogSection({ creating, onCreatingChange }: Props) {
  const queryClient = useQueryClient();
  const actor = useSession((s) => s.user);
  const [editing, setEditing] = useState<Bank | null>(null);
  const [confirming, setConfirming] = useState<Bank | null>(null);
  /** Ngân hàng đang xem hướng dẫn; `null` = không mở. */
  const [viewingGuide, setViewingGuide] = useState<Bank | null>(null);

  const { data: allBanks = [], isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["banks"],
    queryFn: fetchBanks,
  });

  /**
   * Bảng chỉ hiện ngân hàng người này SỬA được.
   *
   * `GET /api/settings/banks` cố ý không lọc — mọi form nghiệp vụ cần đủ danh
   * sách, và nhân viên mở tài khoản phải thấy cả 13 ngân hàng. Lọc ở đây vì
   * đây là màn cấu hình: bày ra một dòng có nút Sửa mà bấm vào nhận 403 thì
   * người dùng không đoán được vì sao.
   */
  const banks = banksInScope(actor, allBanks);

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
      key: "priority",
      label: "Ưu tiên",
      sortBy: (b) => b.priority,
      render: (b) => <span className="tabular-nums">{b.priority}</span>,
    },
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
      key: "managers",
      label: "Người quản",
      /*
        Danh sách rỗng đọc ra là "chưa giao cho ai" chứ không phải "không ai
        sửa được" — người ở phạm vi mọi ngân hàng vẫn sửa được như cũ.
      */
      render: (b) =>
        b.managers.length === 0 ? (
          <span className="text-muted">Chưa giao</span>
        ) : (
          <span className={styles.managerNames}>
            {b.managers.map((m) => (
              <Link key={m.id} href={`/users/${m.id}`} className={styles.managerLink}>
                {m.fullName}
              </Link>
            ))}
          </span>
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
          {/* Chỉ dựng nút khi có gì để xem — nút mở ra một hộp thoại trống là
              bắt người dùng bấm để biết rằng không có gì. */}
          {(b.guide || b.guidePhotoUrls.length > 0) && (
            <Button
              variant="secondary"
              icon
              tooltip="Xem hướng dẫn mở tài khoản"
              aria-label={`Xem hướng dẫn ${b.code}`}
              onClick={() => setViewingGuide(b)}
            >
              <BookOpen size={16} aria-hidden />
            </Button>
          )}
          <Button
            variant="secondary"
            icon
            tooltip="Sửa ngân hàng"
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
      >
        {isPending && <SkeletonTable rows={5} columns={6} />}
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
            emptyText="Chưa có ngân hàng nào — bấm “Thêm ngân hàng” ở thanh tiêu đề."
          />
        )}

        <p className={styles.footnote}>
          <strong>Ưu tiên</strong> quyết định thứ tự ô chọn ngân hàng lúc mở tài
          khoản — số lớn lên đầu, bằng nhau thì xếp theo mã. <strong>Tắt</strong>{" "}
          chỉ chặn tạo tài khoản mới — tài khoản cũ thuộc
          ngân hàng đã tắt vẫn hiển thị và xuất được bình thường. VPa/VPb và
          MSBa/MSBb là bốn ngân hàng riêng biệt dù cùng một nhà băng ngoài đời:
          khác mã giới thiệu, khác chính sách.
        </p>
      </SectionCard>

      {viewingGuide && (
        <BankGuideDialog
          open
          onClose={() => setViewingGuide(null)}
          bankCode={viewingGuide.code}
          guide={viewingGuide.guide}
          photoUrls={viewingGuide.guidePhotoUrls}
        />
      )}

      {(creating || editing) && (
        <BankFormDialog
          open
          bank={editing}
          onClose={() => {
            onCreatingChange(false);
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
