"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Check, Download, Images, X, ZoomIn } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ErrorState } from "@/components/ui/ErrorState";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import {
  BANK_PHOTOS_PAGE_SIZE,
  downloadBankPhotoZip,
  fetchBankPhotos,
  PHOTO_DOWNLOAD_LIMIT,
} from "@/lib/api/bankPhotos";
import { EMPTY_PAGE } from "@/lib/api/pagination";
import { formatDate } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./BankPhotoGallery.module.scss";

type Filters = {
  from: string;
  to: string;
  status: string;
  referralCodeId: string;
  departmentId: string;
};

type Props = {
  bankId: string;
  /** Mã đặt tên file zip; `''` = danh mục ngân hàng chưa nạp xong. */
  bankCode: string;
  /** Bộ lọc dùng chung với tab tài khoản — nơi gọi đổi bộ lọc thì đổi `key` để reset lượt chọn. */
  filters: Filters;
  /** Trang do NƠI GỌI giữ để ghi được lên URL — trang của lưới ảnh riêng với trang của bảng tài khoản. */
  page: number;
  onPageChange: (page: number) => void;
  /** Ngân hàng ngoài phạm vi thì không gọi mạng — máy chủ trả 403. */
  inScope: boolean;
  hasActiveFilters: boolean;
};

/**
 * Tab Ảnh của trang chi tiết ngân hàng (chốt 2026-09-02) — lưới ảnh chứng minh
 * để TẢI HÀNG LOẠT, phân trang theo TÀI KHOẢN ở máy chủ (AGENTS.md §5.1).
 *
 * Bấm vào ảnh là chọn; xem lớn đi nút kính lúp riêng. Nơi gọi truyền `key`
 * theo bộ lọc nên đổi bộ lọc là mất lượt chọn — giữ lại là tải nhầm cả ảnh đã
 * bị bộ lọc ẩn đi. Sang trang thì lượt chọn giữ nguyên, vì tập kết quả không đổi.
 */
export function BankPhotoGallery({
  bankId,
  bankCode,
  filters,
  page,
  onPageChange,
  inScope,
  hasActiveFilters,
}: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);

  const { data = EMPTY_PAGE, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["bank-photos", bankId, filters, page],
    queryFn: () => fetchBankPhotos(bankId, { ...filters, page, sort: "date", dir: "desc" }),
    enabled: inScope,
    placeholderData: keepPreviousData,
  });

  const addCapped = (prev: ReadonlySet<string>, ids: string[]): ReadonlySet<string> => {
    const next = new Set(prev);
    for (const id of ids) {
      if (!next.has(id) && next.size >= PHOTO_DOWNLOAD_LIMIT) {
        toast.fail(`Chỉ tải được tối đa ${PHOTO_DOWNLOAD_LIMIT} ảnh một lượt.`);
        break;
      }
      next.add(id);
    }
    return next;
  };

  const togglePhoto = (id: string, on: boolean) =>
    setSelected((prev) => {
      if (!on) {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }
      return addCapped(prev, [id]);
    });

  const toggleMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      if (!on) {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      }
      return addCapped(prev, ids);
    });

  const download = useMutation({
    mutationFn: () => downloadBankPhotoZip(bankId, bankCode, [...selected]),
    onSuccess: () => {
      toast.ok(`Đã tải ${selected.size} ảnh về máy`);
      setSelected(new Set());
    },
    onError: (e) => toast.fail(errorMessage(e, "Không tải được ảnh về máy.")),
  });

  const pageIds = data.rows.flatMap((r) => r.photos.map((p) => p.id));
  const allPicked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const pageCount = Math.max(1, Math.ceil(data.total / BANK_PHOTOS_PAGE_SIZE));

  if (isError) {
    return (
      <SectionCard title="Ảnh chứng minh" icon={<Images size={17} />}>
        <ErrorState what="ảnh của ngân hàng này" onRetry={refetch} retrying={isFetching} />
      </SectionCard>
    );
  }

  if (isPending && inScope) {
    return (
      <SectionCard title="Ảnh chứng minh" icon={<Images size={17} />}>
        <SkeletonTable rows={6} columns={4} />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Ảnh chứng minh"
      icon={<Images size={17} />}
      meta={inScope ? `${data.total} tài khoản có ảnh` : undefined}
    >
      {data.rows.length === 0 ? (
        <p className="text-muted">
          {!inScope
            ? "Bạn không quản ngân hàng này."
            : hasActiveFilters
              ? "Không có ảnh nào khớp bộ lọc."
              : "Ngân hàng này chưa có ảnh nào."}
        </p>
      ) : (
        <>
          <div className={styles.toolbar}>
            <Checkbox
              label={`Chọn cả ${pageIds.length} ảnh trong trang này`}
              checked={allPicked}
              onCheckedChange={(v) => toggleMany(pageIds, v)}
            />
            <span className={styles.toolbarActions}>
              {selected.size > 0 && (
                <Button
                  variant="secondary"
                  aria-label={`Bỏ chọn ${selected.size} ảnh`}
                  onClick={() => setSelected(new Set())}
                >
                  <X size={16} aria-hidden />
                  Bỏ chọn
                </Button>
              )}
              {/* Chưa chọn ảnh nào thì nút mờ — không tooltip, không dòng chú thích. */}
              <Button
                aria-label={`Tải ${selected.size} ảnh đã chọn về máy`}
                disabled={selected.size === 0 || download.isPending}
                onClick={() => download.mutate()}
              >
                <Download size={16} aria-hidden />
                {download.isPending ? "Đang đóng gói…" : `Tải về (${selected.size})`}
              </Button>
            </span>
          </div>

          <ul className={styles.grid}>
            {data.rows.flatMap((row) =>
              row.photos.map((photo) => {
                const picked = selected.has(photo.id);
                const alt = `Ảnh ${photo.kind === "transaction" ? "giao dịch" : "mở tài khoản"} · ${row.customerName}`;
                return (
                  <li key={photo.id} className={clsx(styles.card, picked && styles.cardSelected)}>
                    {/* Bấm vào ẢNH là chọn; xem lớn đi nút kính lúp riêng. */}
                    <button
                      type="button"
                      className={styles.view}
                      aria-pressed={picked}
                      aria-label={`Chọn ${alt}`}
                      onClick={() => togglePhoto(photo.id, !picked)}
                    >
                      <img src={photo.url} alt={alt} loading="lazy" />
                    </button>
                    {/* Dấu tick + viền cam cùng báo "đang chọn" — icon để không
                        truyền đạt trạng thái chỉ bằng màu (AGENTS.md §8). */}
                    {picked && (
                      <span className={styles.pickedMark} aria-hidden>
                        <Check size={14} />
                      </span>
                    )}
                    {photo.kind === "transaction" && (
                      <span className={styles.kindTag}>Giao dịch</span>
                    )}
                    <button
                      type="button"
                      className={styles.zoom}
                      aria-label={`Xem lớn: ${alt}`}
                      onClick={() => setLightbox({ url: photo.url, alt })}
                    >
                      <ZoomIn size={16} aria-hidden />
                    </button>
                    <span className={styles.caption}>
                      {row.customerName}
                      {row.date ? ` · ${formatDate(row.date)}` : ""}
                    </span>
                  </li>
                );
              }),
            )}
          </ul>

          {pageCount > 1 && (
            <div className={styles.pager}>
              <span>
                {page * BANK_PHOTOS_PAGE_SIZE + 1}–{Math.min((page + 1) * BANK_PHOTOS_PAGE_SIZE, data.total)} trên {data.total} tài khoản
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onPageChange(page - 1)}
                disabled={page === 0}
              >
                Trước
              </button>
              <span>
                {page + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onPageChange(page + 1)}
                disabled={page >= pageCount - 1}
              >
                Sau
              </button>
            </div>
          )}
        </>
      )}

      {lightbox && (
        <ImageLightbox src={lightbox.url} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
    </SectionCard>
  );
}
