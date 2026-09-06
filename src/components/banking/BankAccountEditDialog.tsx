"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { CheckCircle2, Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { Select } from "@/components/ui/Select";
import { ReferralCodeCard } from "./ReferralCodeCard";
import {
  ACCOUNT_TYPE_LABEL,
  type AccountType,
  BankAccountFinishForm,
  canEditOpeningPhotos,
  finishBankAccount,
  setBankAccountPhotos,
  updateBankAccount,
} from "@/lib/api/bankAccounts";
import { fetchOpenReferralCodes } from "@/lib/api/bankCatalog";
import { BankAccountTransaction } from "./BankAccountTransaction";
import { fetchBankAccountDetail } from "@/lib/api/banking";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { can } from "@/lib/permissions";
import { businessDay } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import { useSession } from "@/store/session";
import { BankAccountFinishFields } from "./BankAccountFinishFields";
import {
  photosChanged,
  savedPhotos,
  uploadPendingPhotos,
  type PhotoItem,
} from "./BankAccountPhotos";
import styles from "./BankAccountFormDialog.module.scss";
import { reportInvalid } from "@/lib/formErrors";

type Props = {
  open: boolean;
  onClose: () => void;
  accountId: string;
};

/**
 * Mở một tài khoản ĐÃ CÓ ngay trên bảng P-21 — không phải rời màn hình.
 *
 * Hai mặt tuỳ trạng thái, vì hai việc khác nhau:
 *  - `creating` → đây là BƯỚC 2: điền nốt STK/ngày mở/app + ảnh rồi Hoàn thành.
 *                 Bấm nút là TIÊU một lượt mã giới thiệu.
 *  - `done`     → SỬA: cùng bộ ô, nhưng không đụng kho mã. Bản trước chỉ cho
 *                 thay ảnh, và đó là ngõ cụt thật — gõ nhầm số tài khoản hay
 *                 quên tích "đã cài app" thì không có đường chữa nào, vì bản
 *                 `done` cũng không xoá được.
 *
 * Khách và ngân hàng KHÔNG sửa được ở cả hai mặt: đổi chúng là viết lại lịch
 * sử kho mã, không phải sửa một chỗ gõ nhầm. Loại tài khoản thì đổi được từ
 * 2026-09-06, kèm một mã của loại mới — mã cũ nhả chỗ, mã mới giữ chỗ.
 *
 * Tự tải chi tiết theo `accountId` chứ không nhận sẵn từ dòng bảng: dòng bảng
 * không có `photoUrls`, `requiredPhotos` lẫn `accountNumberMethod`, mà thiếu ba
 * thứ đó thì không vẽ nổi phần ảnh. Nhồi chúng vào mọi dòng của danh sách chỉ
 * để phục vụ một hộp thoại hiếm khi mở là trả giá sai chỗ.
 *
 * KHÔNG có nút Xoá ở đây: bảng bên ngoài đã có nút xoá kèm hộp xác nhận nói rõ
 * hệ quả. Thêm đường xoá thứ hai KHÔNG hỏi lại, nằm sát nút "Đóng" trong cùng
 * thanh footer, là đặt bẫy đúng chỗ ngón tay quen bấm.
 *
 * Trang `/banking/[id]` vẫn còn và vẫn là nơi mở bằng link — hộp thoại này chỉ
 * là lối tắt, hai đường dùng chung đúng hai component `BankAccountFinishFields`
 * và `BankAccountPhotos`.
 */
export function BankAccountEditDialog({ open, onClose, accountId }: Props) {
  const user = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const canWrite = can(user, "banking", "update");

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["bank-account-detail", accountId],
    queryFn: () => fetchBankAccountDetail(accountId),
  });

  const finishForm = useForm<BankAccountFinishForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(BankAccountFinishForm),
    // `values` chứ không phải `defaultValues`: chi tiết về SAU lượt render đầu,
    // mà `defaultValues` chỉ đọc một lần nên form sẽ trống mãi.
    values: {
      /**
       * Ngân hàng lấy số tài khoản theo SĐT thì điền sẵn SỐ CHÍNH — phần lớn
       * khách mở bằng số đó. Nhân viên đổi sang số phụ ngay trong ô chọn nếu
       * khách dùng số khác. `customerPhones[0]` là số chính, máy chủ đã sắp.
       *
       * Ngân hàng NHẬP TAY có tiền tố (P-60) thì điền sẵn tiền tố — nhân viên
       * gõ nốt phần sau.
       *
       * Chỉ điền khi bản ghi CHƯA có số: tài khoản đang sửa mang số thật rồi
       * thì đè lên là ghi lại hợp đồng theo dữ liệu suy đoán.
       */
      accountNumber:
        data?.accountNumber ||
        (data?.accountNumberMethod === "phone-match"
          ? (data.customerPhones[0] ?? "")
          : (data?.accountNumberPrefix ?? "")),
      openedDate: data?.date || businessDay(),
      // Bản nháp chưa ai tích ô này, nên lấy mặc định của ngân hàng (P-60).
      // Tài khoản đã hoàn thành thì đọc giá trị đã lưu.
      appInstalled:
        data?.status === "creating" ? (data.appDefault ?? false) : (data?.appInstalled ?? false),
      accountType: data?.accountType ?? "none",
      // Chỉ có giá trị khi người dùng đổi loại — xem khối "Loại tài khoản".
      referralCode: "",
      note: data?.note ?? "",
    },
  });

  /**
   * Đổi loại tài khoản trên dòng đã có (chốt 2026-09-06): thường ↔ CNKD trên
   * dòng chính, hoặc chuyển một dòng sang HKD. Mã giới thiệu tách theo loại nên
   * đổi loại là phải chọn mã của loại mới; máy chủ từ chối cặp CNKD với HKD và
   * dòng trùng chỗ, câu báo hiện qua toast.
   *
   * Hai truy vấn: kho mã mọi loại để biết ngân hàng này có những loại nào, và
   * kho mã của loại MỚI để chọn. Cả hai đọc theo phòng ghi nhận bản ghi, cùng
   * phạm vi mà máy chủ sẽ kiểm.
   */
  const accountType = finishForm.watch("accountType");
  const newReferralCode = finishForm.watch("referralCode") ?? "";
  const typeChanged = !!data && accountType !== data.accountType;
  const codeDepartment = data?.createdByDepartmentId ?? "";
  const { data: allCodes = [] } = useQuery({
    queryKey: ["referral-codes", "open", data?.bankId, codeDepartment, "all-types"],
    queryFn: () => fetchOpenReferralCodes(data!.bankId, codeDepartment),
    // Bước Hoàn tất không có ô đổi loại, nên không phải hỏi kho mã.
    enabled: !!data && canWrite && data.status !== "creating",
  });
  const { data: newCodes = [], isPending: newCodesPending } = useQuery({
    queryKey: ["referral-codes", "open", data?.bankId, codeDepartment, accountType],
    queryFn: () => fetchOpenReferralCodes(data!.bankId, codeDepartment, accountType),
    enabled: typeChanged,
  });
  // Loại đang ghi luôn có mặt dù kho mã của nó đã hết, để ô chọn không tự nhảy.
  const typeOptions: AccountType[] = [
    ...new Set<AccountType>([...(data ? [data.accountType] : []), ...allCodes.map((c) => c.accountType)]),
  ];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["bank-account-detail", accountId] });
    queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
    if (data?.customerId) queryClient.invalidateQueries({ queryKey: ["customer", data.customerId] });
    // Hoàn tất tài khoản là ghi điểm KPI — ba nơi hiện điểm phải hỏi lại.
    invalidateKpi(queryClient);
  };

  /**
   * `null` = người dùng chưa đụng vào ảnh, cứ lấy theo bản ghi. Tính khi render
   * chứ không đồng bộ bằng effect (AGENTS.md §7) — chi tiết về sau lượt render
   * đầu nên `useState(data.photoUrls)` sẽ mãi rỗng.
   */
  const [editedPhotos, setEditedPhotos] = useState<PhotoItem[] | null>(null);
  const photos = editedPhotos ?? savedPhotos(data?.photoUrls ?? []);

  /** Bước 3 — cùng lối "chưa đụng thì lấy theo bản ghi" như ảnh ở trên. */
  const [editedTransactionAt, setEditedTransactionAt] = useState<string | null>(null);
  const transactionAt = editedTransactionAt ?? data?.transactionAt ?? "";
  const [editedTransactionPhotos, setEditedTransactionPhotos] = useState<PhotoItem[] | null>(null);
  const transactionPhotos =
    editedTransactionPhotos ?? savedPhotos(data?.transactionPhotoUrls ?? []);

  /**
   * Ảnh đi trước, bản ghi đi sau — và phải ĐỦ CẢ HAI mới coi là xong.
   *
   * Máy chủ đếm ảnh trong bảng `bank_account_photos` ngay trong giao dịch hoàn
   * thành, nên tải file lên thôi chưa đủ: phải ghi danh sách URL vào bản ghi
   * trước khi gọi đường hoàn thành/sửa.
   *
   * Hai nhóm ảnh ghi bằng HAI lượt riêng: mỗi lượt xoá sạch rồi chèn lại đúng
   * nhóm của nó, gộp làm một là nhóm kia mất trắng.
   *
   * ⚠️ Lượt nào ghi xong thì ĐÁNH DẤU ĐÃ LƯU ngay, đừng đợi tới cuối. Ba lượt đi
   * mạng nối nhau sau một nút bấm; lượt 2 rớt thì lượt 1 vẫn đã ghi. Không đánh
   * dấu thì mấy tấm đó còn `pending`, và người dùng bấm Lưu lần nữa là
   * `uploadPendingPhotos` tải lại đúng file cũ — URL mới, còn tấm lượt trước nằm
   * lại kho vĩnh viễn. Mỗi lần thử lại thêm một bộ rác.
   */
  const savePhotosThen = async <T,>(run: () => Promise<T>): Promise<T> => {
    if (photosEditable && photosChanged(photos, data?.photoUrls ?? [])) {
      const urls = await uploadPendingPhotos(photos);
      await setBankAccountPhotos(accountId, urls);
      setEditedPhotos(savedPhotos(urls));
    }
    if (photosChanged(transactionPhotos, data?.transactionPhotoUrls ?? [])) {
      const urls = await uploadPendingPhotos(transactionPhotos);
      await setBankAccountPhotos(accountId, urls, "transaction");
      setEditedTransactionPhotos(savedPhotos(urls));
    }
    return run();
  };

  const finish = useMutation({
    mutationFn: (form: BankAccountFinishForm) =>
      savePhotosThen(() => finishBankAccount(accountId, form)),
    onSuccess: (result) => {
      invalidate();
      onClose();
      toast.ok("Đã hoàn tất tài khoản ngân hàng");
      // Cảnh báo mềm mức khách hàng (spec §4.8) — mỗi luật một dòng, hiện SAU
      // khi đã lưu xong nên không được dùng tông lỗi.
      for (const w of result.warnings) toast.warn(w);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không hoàn tất được tài khoản này.")),
  });

  /**
   * Sửa bản ghi đã hoàn thành. Máy chủ tính lại điểm KPI của CẢ tháng cũ lẫn
   * tháng mới khi ngày mở đổi, và tính lại trường hợp quà khi cờ app đổi — nên
   * `invalidate()` ở đây quan trọng y như ở nhánh hoàn thành.
   */
  const update = useMutation({
    mutationFn: (form: BankAccountFinishForm) =>
      savePhotosThen(() => updateBankAccount(accountId, { ...form, transactionAt })),
    onSuccess: (result) => {
      invalidate();
      onClose();
      toast.ok("Đã lưu thay đổi cho tài khoản này");
      for (const w of result.warnings) toast.warn(w);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được thay đổi cho tài khoản này.")),
  });

  const draft = data?.status === "creating";
  /**
   * Ảnh chứng minh của bản ghi đã hoàn thành chỉ sửa được trong ngày hoàn
   * thành (chốt 2026-08-23) — cùng một hàm luật với máy chủ, không chép lại
   * điều kiện ở đây. Khoá rồi thì các ô chữ và bước 3 vẫn sửa bình thường.
   */
  const photosEditable = !!data && canWrite && canEditOpeningPhotos(user, data);
  const enoughPhotos = photos.length >= (data?.requiredPhotos ?? 0);
  const busy = finish.isPending || update.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={draft ? "Hoàn tất tài khoản" : "Sửa tài khoản"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          {canWrite &&
            (draft ? (
              <Button
                type="submit"
                form="edit-account-form"
                disabled={busy || !enoughPhotos}
              >
                <CheckCircle2 size={16} aria-hidden />
                Hoàn thành
              </Button>
            ) : (
              <Button type="submit" form="edit-account-form" disabled={busy}>
                <Save size={16} aria-hidden />
                Lưu
              </Button>
            ))}
        </>
      }
    >
      {isPending && <SkeletonCard lines={5} />}
      {isError && (
        <ErrorState what="tài khoản này" onRetry={refetch} retrying={isFetching} />
      )}

      {data && (
        <div className={styles.form}>
          <div className={styles.summary}>
            <strong>{data.bankCode}</strong>
            {/* CNKD/HKD có hướng dẫn và số ảnh riêng — ghi loại ra để người điền
                biết mình đang theo bản nào; loại thường thì không cần nói. */}
            {data.accountType !== "none" && <> · {data.accountType}</>} · {data.customerName}
            {data.channel && (
              <span className="text-muted">
                {" "}
                — {data.channel}
                {data.channelDetail ? ` · ${data.channelDetail}` : ""}
              </span>
            )}
          </div>

          {/* Bước Hoàn tất không đổi loại (chốt 2026-09-06): loại đã chốt từ mã
              giới thiệu lúc giữ chỗ, bước này chỉ điền nốt số tài khoản, ngày
              mở và ảnh. Đổi loại làm ở màn sửa tài khoản. */}
          {canWrite && !draft && typeOptions.length > 1 && (
            <div className={styles.pickCode}>
              <Select
                block
                label="Loại tài khoản"
                value={accountType}
                onChange={(v) => {
                  finishForm.setValue("accountType", v as AccountType, { shouldDirty: true });
                  finishForm.setValue("referralCode", "", { shouldDirty: true });
                }}
                options={typeOptions.map((value) => ({ value, label: ACCOUNT_TYPE_LABEL[value] }))}
                hint={
                  typeChanged
                    ? "Đổi loại thì chọn mã giới thiệu của loại mới. Mã cũ được nhả chỗ."
                    : undefined
                }
              />
              {typeChanged && (
                <Select
                  block
                  required
                  label="Mã giới thiệu mới"
                  value={newReferralCode}
                  onChange={(v) => finishForm.setValue("referralCode", v, { shouldDirty: true })}
                  options={
                    newCodes.length === 0
                      ? [{ value: "", label: newCodesPending ? "— Đang tải mã —" : "— Hết mã —" }]
                      : newCodes.map((c) => ({
                          value: c.id,
                          label: `${c.displayName || c.code}${c.province ? ` · ${c.province}` : ""} · còn ${c.total - c.used - c.holding} chỗ`,
                        }))
                  }
                />
              )}
            </div>
          )}

          <ReferralCodeCard account={data} />

          {/* Cùng một bộ ô cho cả hai mặt — khác nhau ở chỗ bấm nút thì làm gì.
              Ảnh vẫn lưu ngay khi thả, không chờ nút, ở cả hai mặt. */}
          <BankAccountFinishFields
            formId="edit-account-form"
            onSubmit={
              draft
                ? finishForm.handleSubmit((form) => finish.mutate(form), reportInvalid)
                : finishForm.handleSubmit((form) => update.mutate(form), reportInvalid)
            }
            register={finishForm.register}
            errors={finishForm.formState.errors}
            watch={finishForm.watch}
            setValue={finishForm.setValue}
            bankCode={data.bankCode}
            accountNumberMethod={data.accountNumberMethod}
            accountNumberLength={data.accountNumberLength}
        customerPhones={data.customerPhones}
        referralQrUrl={data.referralQrUrl}
        bankGuide={data.bankGuide}
        bankGuidePhotoUrls={data.bankGuidePhotoUrls}
            photos={photos}
            requiredPhotos={data.requiredPhotos}
            onPhotosChange={photosEditable ? setEditedPhotos : undefined}
            busy={busy}
          />
          {!draft && !photosEditable && (
            <p className="text-muted">
              Ảnh chứng minh chỉ sửa được trong ngày hoàn thành tài khoản. Cần đổi thì nhờ
              trưởng phòng trở lên.
            </p>
          )}
          {draft && !enoughPhotos && (
            <p className="text-muted">
              Cần đủ {data.requiredPhotos} ảnh chứng minh mới hoàn thành được.
            </p>
          )}

          {/* Bước 3 chỉ có nghĩa khi tài khoản đã xong — lúc còn `creating` thì
              khách chưa có tài khoản thật để mà giao dịch. */}
          {!draft && (
            <BankAccountTransaction
              date={transactionAt}
              onDateChange={setEditedTransactionAt}
              photos={transactionPhotos}
              onPhotosChange={setEditedTransactionPhotos}
              busy={busy}
            />
          )}
          {/* Đổi ngày mở là đổi tháng tính điểm, đổi cờ app là đổi cả combo quà
              — nói trước khi người dùng bấm, không phải sau. */}
          {!draft && (
            <p className="text-muted">
              Đổi ngày mở hoặc trạng thái cài app sẽ tính lại điểm KPI và trường hợp quà
              của khách này.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
