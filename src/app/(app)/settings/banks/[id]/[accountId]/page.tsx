"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { Check, ChevronLeft, Landmark, TriangleAlert } from "lucide-react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { BankAccountPhotos, savedPhotos } from "@/components/banking/BankAccountPhotos";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import { TextArea } from "@/components/ui/TextArea";
import {
  BANK_ACCOUNT_STATUS_LABEL,
  BANK_ACCOUNT_STATUS_TONE,
  approveBankAccount,
  type AccountType,
} from "@/lib/api/bankAccounts";
import { fetchBankAccountOfBank, markBankAccountError } from "@/lib/api/banking";
import { formatDate, formatPhone } from "@/lib/format";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { errorMessage, toast } from "@/lib/toast";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  none: "Thường",
  CNKD: "CNKD",
  HKD: "HKD",
};

/**
 * Chi tiết một tài khoản, mở từ bảng của trang chi tiết ngân hàng (chốt
 * 2026-09-02) — bấm dòng là vào đây. CHỈ XEM: người quản ngân hàng đối chiếu
 * với ngân hàng, không sửa hồ sơ; sửa vẫn đi đường P-21/P-22 theo phạm vi
 * `banking`. Cùng chốt `canManageBank` với bảng, nên không link sang hồ sơ
 * khách hay P-22 — hai màn đó gác theo phạm vi khác, link dễ dẫn tới 404.
 */
export default function BankAccountOfBankPage({
  params,
}: {
  params: Promise<{ id: string; accountId: string }>;
}) {
  const { id, accountId } = use(params);
  const user = useSession((s) => s.user);
  const inScope = canManageBank(user, id);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["bank-account-of-bank", id, accountId],
    queryFn: () => fetchBankAccountOfBank(id, accountId),
    enabled: inScope,
  });

  const queryClient = useQueryClient();
  const [approving, setApproving] = useState(false);
  const [markingError, setMarkingError] = useState(false);
  const [errorNote, setErrorNote] = useState("");

  const refreshAfterChange = () => {
    queryClient.invalidateQueries({ queryKey: ["bank-account-of-bank", id, accountId] });
    queryClient.invalidateQueries({ queryKey: ["bank-accounts-of-bank"] });
    queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
    invalidateKpi(queryClient);
  };

  const approve = useMutation({
    mutationFn: () => approveBankAccount(accountId),
    onSuccess: () => {
      setApproving(false);
      refreshAfterChange();
      toast.ok("Đã duyệt tài khoản và tính lại KPI");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không duyệt được tài khoản này.")),
  });

  const markError = useMutation({
    mutationFn: () => markBankAccountError(id, accountId, errorNote),
    onSuccess: () => {
      setMarkingError(false);
      setErrorNote("");
      refreshAfterChange();
      toast.ok("Đã đánh dấu lỗi và tính lại KPI");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đánh dấu lỗi được tài khoản này.")),
  });

  return (
    <RequirePermission allow={canOpenBankAdmin}>
      <TopBar title={data ? `${data.bankCode} · ${data.customerName}` : "Tài khoản"} keepTitleOnMobile />

      <main className={styles.body}>
        <Link href={`/settings/banks/${id}`} className={styles.back}>
          <ChevronLeft size={15} aria-hidden />
          Chi tiết ngân hàng
        </Link>

        {!inScope && <p className="text-muted">Bạn không quản ngân hàng này.</p>}
        {inScope && isPending && <SkeletonCard lines={8} />}
        {inScope && isError && (
          <ErrorState what="tài khoản này" onRetry={refetch} retrying={isFetching} />
        )}

        {inScope && data && (
          <SectionCard
            title="Thông tin tài khoản"
            icon={<Landmark size={17} />}
            /*
              Hai nút DUY NHẤT của màn chỉ-xem này. Đặt ở đây vì người quản ngân
              hàng vào đúng màn này để đối chiếu, còn P-22 thì họ thường không mở
              được — hai màn gác theo hai phạm vi khác nhau.

              `fixed` hiện CẢ HAI: có Duyệt thì phải có đường từ chối, không thì
              người xem thấy bản sửa chưa đạt mà không làm gì được ngoài duyệt.
            */
            action={
              data.status === "done" || data.status === "fixed" ? (
                <>
                  {data.status === "fixed" && (
                    <Button disabled={approve.isPending} onClick={() => setApproving(true)}>
                      <Check size={16} aria-hidden />
                      Duyệt
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    disabled={markError.isPending}
                    onClick={() => setMarkingError(true)}
                  >
                    <TriangleAlert size={16} aria-hidden />
                    Đánh dấu lỗi
                  </Button>
                </>
              ) : undefined
            }
          >
            <dl className={styles.fields}>
              <div>
                <dt>Trạng thái</dt>
                <dd>
                  <StatusTag tone={BANK_ACCOUNT_STATUS_TONE[data.status]}>
                    {BANK_ACCOUNT_STATUS_LABEL[data.status]}
                  </StatusTag>
                </dd>
              </div>
              <div>
                <dt>Khách hàng</dt>
                <dd>{data.customerName}</dd>
              </div>
              <div>
                <dt>STK</dt>
                <dd className="tabular-nums">{formatPhone(data.accountNumber) || "—"}</dd>
              </div>
              <div>
                <dt>Mã giới thiệu</dt>
                <dd>{data.referralCode}</dd>
              </div>
              <div>
                <dt>Loại tài khoản</dt>
                <dd>{ACCOUNT_TYPE_LABEL[data.accountType]}</dd>
              </div>
              <div>
                <dt>Kênh</dt>
                <dd>
                  {data.channel || "Không có"}
                  {data.channelDetail ? ` · ${data.channelDetail}` : ""}
                </dd>
              </div>
              <div>
                <dt>Ngày mở</dt>
                <dd>{data.date ? formatDate(data.date) : "—"}</dd>
              </div>
              <div>
                <dt>Ngày giao dịch</dt>
                <dd>
                  {data.transactionAt ? (
                    formatDate(data.transactionAt)
                  ) : (
                    <span className="text-muted">Chưa ghi nhận</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Đã cài app</dt>
                <dd>
                  <StatusTag ok={data.appInstalled}>{data.appInstalled ? "Có" : "Không"}</StatusTag>
                </dd>
              </div>
              <div>
                <dt>Người tạo</dt>
                <dd>
                  {[data.createdByStaffCode || data.createdByName, data.createdByDepartmentName]
                    .filter(Boolean)
                    .join(" - ") || "—"}
                </dd>
              </div>
              {data.note && (
                <div>
                  <dt>Ghi chú</dt>
                  <dd>{data.note}</dd>
                </div>
              )}
              {data.errorNote && (
                <div>
                  <dt>Lý do lỗi</dt>
                  <dd>{data.errorNote}</dd>
                </div>
              )}
            </dl>

            <BankAccountPhotos
              photos={savedPhotos(data.photoUrls)}
              requiredPhotos={0}
              title="Ảnh chứng minh"
            />
            {data.transactionPhotoUrls.length > 0 && (
              <BankAccountPhotos
                photos={savedPhotos(data.transactionPhotoUrls)}
                requiredPhotos={0}
                title="Ảnh giao dịch"
              />
            )}
          </SectionCard>
        )}

        {approving && data && (
          <ConfirmDialog
            open
            title="Duyệt tài khoản đã sửa?"
            consequence="Tài khoản về Hoàn thành và điểm KPI của người mở được tính lại ngay."
            confirmLabel="Duyệt"
            pending={approve.isPending}
            onConfirm={() => approve.mutate()}
            onClose={() => setApproving(false)}
          >
            Tài khoản <strong>{data.bankCode}</strong> của {data.customerName}. Lý do đánh dấu
            lỗi trước đó: {data.errorNote || "không ghi"}.
          </ConfirmDialog>
        )}

        {markingError && data && (
          <Dialog
            open
            title="Đánh dấu tài khoản lỗi"
            onClose={() => !markError.isPending && setMarkingError(false)}
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => setMarkingError(false)}
                  disabled={markError.isPending}
                >
                  Huỷ
                </Button>
                <Button
                  variant="danger"
                  disabled={markError.isPending || errorNote.trim().length < 2}
                  onClick={() => markError.mutate()}
                >
                  Đánh dấu lỗi
                </Button>
              </>
            }
          >
            {/* Tài khoản `fixed` vốn đã ngoài KPI — chỉ `done` mới vào phép tính.
                Nói "sẽ bị loại khỏi KPI" ở đó là nói một thứ đã xảy ra rồi. */}
            <Alert tone="warning">
              {data.status === "fixed"
                ? "Tài khoản quay về trạng thái lỗi. Nhân viên sửa tiếp rồi gửi duyệt lại."
                : "Tài khoản này sẽ bị loại khỏi KPI của người mở. Quà của khách giữ nguyên."}
            </Alert>
            <TextArea
              label="Lý do lỗi"
              required
              rows={3}
              placeholder="Ví dụ: Tài khoản không hợp lệ khi đối soát"
              value={errorNote}
              onChange={(event) => setErrorNote(event.target.value)}
            />
          </Dialog>
        )}
      </main>
    </RequirePermission>
  );
}
