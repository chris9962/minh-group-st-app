"use client";
import { BankAccountHistory } from "@/components/banking/BankAccountHistory";
import { PhotoCheckPanel } from "@/components/banking/PhotoCheckPanel";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { Check, Landmark, Trash2, TriangleAlert } from "lucide-react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { BankAccountPhotos, savedPhotos } from "@/components/banking/BankAccountPhotos";
import { Alert } from "@/components/ui/Alert";
import { BackLink } from "@/components/ui/BackLink";
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
  setPhotoCheckConfirmed,
  type AccountType,
} from "@/lib/api/bankAccounts";
import {
  deleteBankAccountOfBank,
  fetchBankAccountOfBank,
  markBankAccountError,
} from "@/lib/api/banking";
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
 * 2026-09-02) — bấm dòng là vào đây. GẦN NHƯ CHỈ XEM: người quản ngân hàng đối
 * chiếu với ngân hàng, không sửa hồ sơ; sửa vẫn đi đường P-21/P-22 theo phạm vi
 * `banking`. Cùng chốt `canManageBank` với bảng, nên không link sang hồ sơ
 * khách hay P-22 — hai màn đó gác theo phạm vi khác, link dễ dẫn tới 404.
 *
 * Ngoại lệ duy nhất: tài khoản còn ĐANG TẠO có thêm nút Xoá (chốt 2026-09-12)
 * — người quản ngân hàng dọn bản nháp bỏ dở của người khác, xem
 * `deleteCreatingAccountByBankManager`.
 */
export default function BankAccountOfBankPage({
  params,
}: {
  params: Promise<{ id: string; accountId: string }>;
}) {
  const { id, accountId } = use(params);
  const router = useRouter();
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
  const [removing, setRemoving] = useState(false);

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

  const confirmPhotos = useMutation({
    mutationFn: (confirmed: boolean) => setPhotoCheckConfirmed(accountId, confirmed),
    onSuccess: (_, confirmed) => {
      refreshAfterChange();
      toast.ok(confirmed ? "Đã xác nhận ảnh đạt" : "Đã bỏ xác nhận");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không ghi được xác nhận ảnh.")),
  });

  // Trang chi tiết biến mất theo tài khoản, nên xoá xong quay về bảng của
  // ngân hàng thay vì ở lại một đường dẫn không còn gì để tải.
  const remove = useMutation({
    mutationFn: () => deleteBankAccountOfBank(id, accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-accounts-of-bank"] });
      queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
      toast.ok("Đã xoá tài khoản đang tạo, mã giới thiệu được trả lại");
      router.push(`/settings/banks/${id}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không xoá được tài khoản này.")),
  });

  return (
    <RequirePermission allow={canOpenBankAdmin}>
      <TopBar title={data ? `${data.bankCode} · ${data.customerName}` : "Tài khoản"} keepTitleOnMobile />

      <main className={styles.body}>
        <BackLink href={`/settings/banks/${id}`}>Chi tiết ngân hàng</BackLink>

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
              Nút của màn gần-như-chỉ-xem này. Đặt ở đây vì người quản ngân
              hàng vào đúng màn này để đối chiếu, còn P-22 thì họ thường không mở
              được — hai màn gác theo hai phạm vi khác nhau.

              `fixed` hiện CẢ HAI: có Duyệt thì phải có đường từ chối, không thì
              người xem thấy bản sửa chưa đạt mà không làm gì được ngoài duyệt.

              `creating` chỉ có nút Xoá: bản nháp bỏ dở, không có gì để duyệt
              hay đánh dấu lỗi.
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
              ) : data.status === "creating" ? (
                <Button variant="danger" disabled={remove.isPending} onClick={() => setRemoving(true)}>
                  <Trash2 size={16} aria-hidden />
                  Xoá
                </Button>
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

        {data && (
          <PhotoCheckPanel
            check={data.photoCheck}
            onMarkError={
              data.status === "done" || data.status === "fixed"
                ? (note) => {
                    setErrorNote(note);
                    setMarkingError(true);
                  }
                : undefined
            }
            onConfirm={(confirmed) => confirmPhotos.mutate(confirmed)}
            confirming={confirmPhotos.isPending}
          />
        )}
        {data && <BankAccountHistory history={data.history} />}

        {removing && data && (
          <ConfirmDialog
            open
            title="Xoá tài khoản đang tạo?"
            consequence="Tài khoản biến mất khỏi kho ngay, mã giới thiệu được trả lại. Không khôi phục lại được. Người tạo tài khoản nhận được thông báo."
            confirmLabel="Xoá"
            pending={remove.isPending}
            onConfirm={() => remove.mutate()}
            onClose={() => setRemoving(false)}
          >
            Tài khoản <strong>{data.bankCode}</strong> của {data.customerName}, mã{" "}
            {data.referralCode}.
          </ConfirmDialog>
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
