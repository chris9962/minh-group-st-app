"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useRef, useState } from "react";
import { ChevronLeft, ImagePlus, Landmark, Pencil } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Alert } from "@/components/ui/Alert";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { setBankAccountPhotos } from "@/lib/api/bankAccounts";
import { fetchBankAccountDetail } from "@/lib/api/banking";
import { fetchDepartments } from "@/lib/api/departments";
import { formatDate, formatPhone } from "@/lib/format";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  none: "Không",
  CNKD: "CNKD",
  HKD: "HKD",
};

/** P-22 · Chi tiết tài khoản ngân hàng — chỉ xem, không có nút sửa/huỷ. */
export default function BankAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingSlot, setPendingSlot] = useState<number | null>(null);

  const { data, isPending, isError } = useQuery({
    queryKey: ["bank-account-detail", id],
    queryFn: () => fetchBankAccountDetail(id, actor?.id ?? ""),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    staleTime: Infinity,
  });
  const departmentName = departments.find((d) => d.id === data?.createdByDepartmentId)?.name;

  const uploadPhotos = useMutation({
    mutationFn: (photoUrls: string[]) => setBankAccountPhotos(id, photoUrls, actor?.id ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-account-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
    },
  });

  const openPicker = (slot: number) => {
    setPendingSlot(slot);
    fileInputRef.current?.click();
  };

  return (
    <>
      <TopBar title={data ? `${data.bankCode} · ${data.customerName}` : "Tài khoản ngân hàng"} />

      <main className={styles.body}>
        <Link href="/banking" className={styles.back}>
          <ChevronLeft size={15} aria-hidden />
          Ngân hàng
        </Link>

        {isPending && <p className="text-muted">Đang tải tài khoản…</p>}
        {isError && <p className="text-muted">Không tìm thấy tài khoản này.</p>}

        {data && (
          <SectionCard title="Chi tiết tài khoản" icon={<Landmark size={17} />}>
            <dl className={styles.fields}>
              <div>
                <dt>Khách hàng</dt>
                <dd>{data.customerName}</dd>
              </div>
              <div>
                <dt>Ngân hàng</dt>
                <dd>{data.bankCode}</dd>
              </div>
              <div>
                <dt>Số tài khoản</dt>
                <dd className="tabular-nums">{formatPhone(data.accountNumber)}</dd>
              </div>
              <div>
                <dt>Mã giới thiệu</dt>
                <dd>{data.referralCode}</dd>
              </div>
              <div>
                <dt>Ngày mở</dt>
                <dd>{formatDate(data.date)}</dd>
              </div>
              <div>
                <dt>Kênh</dt>
                <dd>
                  {data.channel || "Không có"}
                  {data.channelDetail ? ` · ${data.channelDetail}` : ""}
                </dd>
              </div>
              <div>
                <dt>Đã cài app</dt>
                <dd>
                  <StatusTag ok={data.appInstalled}>{data.appInstalled ? "Có" : "Không"}</StatusTag>
                </dd>
              </div>
              <div>
                <dt>CNKD / HKD</dt>
                <dd>{ACCOUNT_TYPE_LABEL[data.accountType]}</dd>
              </div>
              <div>
                <dt>Ghi chú</dt>
                <dd>{data.note || "—"}</dd>
              </div>
              <div>
                <dt>Người tạo</dt>
                <dd>{data.createdByName ?? "—"}</dd>
              </div>
              <div>
                <dt>Đơn vị lúc tạo</dt>
                <dd>{departmentName ?? "—"}</dd>
              </div>
            </dl>

            {uploadPhotos.isError && (
              <Alert tone="error">Không lưu được ảnh chứng minh này.</Alert>
            )}

            <div className={styles.photoSection}>
              <h3 className={styles.photoTitle}>
                Ảnh chứng minh ({data.photoUrls.length}/{data.requiredPhotos})
              </h3>

              <div className={styles.photoGrid}>
                {data.photoUrls.map((url, i) => (
                  <div key={i} className={styles.photoTile}>
                    <a href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt={`Ảnh chứng minh ${i + 1}`} className={styles.photo} />
                    </a>
                    <button
                      type="button"
                      className={styles.photoEdit}
                      aria-label={`Thay ảnh chứng minh ${i + 1}`}
                      onClick={() => openPicker(i)}
                    >
                      <Pencil size={14} aria-hidden />
                    </button>
                  </div>
                ))}

                {data.photoUrls.length < data.requiredPhotos && (
                  <button
                    type="button"
                    className={styles.photoAdd}
                    onClick={() => openPicker(data.photoUrls.length)}
                  >
                    <ImagePlus size={20} aria-hidden />
                    Thêm ảnh
                  </button>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className={styles.hiddenInput}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file || pendingSlot === null) return;
                  const next = [...data.photoUrls];
                  next[pendingSlot] = URL.createObjectURL(file);
                  uploadPhotos.mutate(next);
                  e.target.value = "";
                  setPendingSlot(null);
                }}
              />
            </div>
          </SectionCard>
        )}
      </main>
    </>
  );
}
