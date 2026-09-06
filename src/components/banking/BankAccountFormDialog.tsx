"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { DepartmentPicker } from "@/components/layout/DepartmentPicker";
import { Select } from "@/components/ui/Select";
import { SkeletonText } from "@/components/ui/Skeleton";
import { fetchBanks, fetchOpenReferralCodes, type Bank } from "@/lib/api/bankCatalog";
import { ageRangeLabel } from "@/lib/format";
import {
  ACCOUNT_TYPE_LABEL,
  BankAccountStartForm,
  fetchCustomerBankSlots,
  MAX_BANK_ACCOUNTS_PER_CUSTOMER,
  startBankAccount,
  AccountType,
  type BankAccountPick,
} from "@/lib/api/bankAccounts";
import styles from "./BankAccountFormDialog.module.scss";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { errorMessage, toast } from "@/lib/toast";
import { reportInvalid } from "@/lib/formErrors";

const BANKING_PATH = "/banking";

type Props = {
  open: boolean;
  onClose: () => void;
  customerId: string;
  /**
   * Phòng của hồ sơ khách — giá trị mặc định cho ô "Ghi nhận vào phòng"
   * (chốt 2026-09-03). Khách đã thuộc về một phòng nên bản ghi mở cho khách đó
   * ghi vào chính phòng ấy; người không thuộc phòng nào vẫn đổi được.
   */
  customerDepartmentId?: string | null;
  /**
   * Có khi hộp thoại này là bước 2 của `CustomerPickerDialog`. Không có khi mở
   * thẳng từ bảng khách (P-40) hay hồ sơ khách (P-42) — ở đó khách đã cố định.
   */
  onBack?: () => void;
};

/**
 * P-20 · Giữ chỗ mã giới thiệu cho 1–3 ngân hàng trong MỘT lượt bấm.
 *
 * Mỗi ngân hàng tích chọn sinh một dòng `creating` ở bảng P-21. Số tài khoản,
 * ngày mở và ảnh chứng minh KHÔNG hỏi ở đây: chúng riêng cho từng dòng, và nhân
 * viên chỉ điền được sau khi đã mở tài khoản thật ở ngoài — ba lượt đó cách nhau
 * hàng giờ, có khi sang ngày hôm sau. Điền nốt ở nút "Hoàn tất tài khoản" của
 * từng dòng (P-21) hoặc màn P-22.
 *
 * Đổi lại, mở MỘT tài khoản tốn thêm một lượt bấm so với bản trước — bản đó gộp
 * luôn bước điền nốt vào cùng hộp thoại.
 */
export function BankAccountFormDialog({
  open,
  onClose,
  customerId,
  customerDepartmentId,
  onBack,
}: Props) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });

  /**
   * Trần tài khoản của khách (chốt 2026-08-25): mỗi ngân hàng một tài khoản, và
   * tối đa ba tài khoản. Máy chủ mới là chỗ chặn — đọc ở đây để tắt ô tích thay
   * vì để người dùng chọn xong mã rồi mới bị từ chối.
   */
  const { data: slots } = useQuery({
    queryKey: ["customer-bank-slots", customerId],
    queryFn: () => fetchCustomerBankSlots(customerId),
    enabled: open && Boolean(customerId),
  });
  const remaining = slots?.remaining ?? MAX_BANK_ACCOUNTS_PER_CUSTOMER;

  const {
    watch,
    setValue,
    getValues,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BankAccountStartForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(BankAccountStartForm),
    defaultValues: { customerId, picks: [], departmentId: customerDepartmentId ?? "" },
  });

  const picks = watch("picks");
  const departmentId = watch("departmentId");

  /**
   * Đọc `picks` bằng `getValues`, KHÔNG dùng biến `picks` của lượt render này.
   *
   * Hai dòng ngân hàng cùng gợi ý mã trong CÙNG một lượt vẽ — hai effect chạy
   * nối nhau, mà cả hai đều đóng gói cùng một mảng `picks` cũ. Ghi theo mảng cũ
   * thì lượt sau xoá mất mã lượt trước vừa đặt. `getValues` đọc trạng thái sống
   * của biểu mẫu nên lượt sau thấy được lượt trước.
   */
  const writePicks = (next: (current: BankAccountPick[]) => BankAccountPick[]) =>
    setValue("picks", next(getValues("picks")), { shouldDirty: true, shouldValidate: true });

  /**
   * Một ngân hàng có HAI dòng tích: dòng chính (thường hoặc CNKD) và dòng HKD
   * (chốt 2026-09-06). Hai dòng là hai pick riêng, nhận ra nhau bằng cặp (ngân
   * hàng, có phải HKD), không bằng ngân hàng đơn thuần.
   */
  const samePick = (p: BankAccountPick, bankId: string, hkd: boolean) =>
    p.bankId === bankId && (p.accountType === "HKD") === hkd;

  const toggleBank = (bankId: string, hkd: boolean, checked: boolean) =>
    writePicks((current) =>
      checked
        ? [...current, { bankId, referralCode: "", accountType: hkd ? "HKD" : "none" }]
        : current.filter((p) => !samePick(p, bankId, hkd)),
    );

  const setCode = (bankId: string, hkd: boolean, referralCode: string) =>
    writePicks((current) =>
      current.map((p) => (samePick(p, bankId, hkd) ? { ...p, referralCode } : p)),
    );

  // Chỉ dòng chính đổi được loại, và chỉ giữa thường và CNKD.
  const setAccountType = (bankId: string, accountType: AccountType) =>
    writePicks((current) =>
      current.map((p) =>
        samePick(p, bankId, false) ? { ...p, accountType, referralCode: "" } : p,
      ),
    );

  const create = useMutation({
    mutationFn: (form: BankAccountStartForm) => startBankAccount(form),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
      // Ô lọc "Mã giới thiệu" ở P-21 và màn Xuất dữ liệu đọc key này — giữ chỗ
      // xong là số chỗ còn lại của mã đã đổi.
      queryClient.invalidateQueries({ queryKey: ["referral-code-options"] });
      queryClient.invalidateQueries({ queryKey: ["customer-bank-slots", customerId] });
      invalidateKpi(queryClient);
      onClose();

      const codes = created.map((a) => a.bankCode).join(", ");
      toast.ok(
        created.length === 1
          ? `Đã giữ chỗ tài khoản ${codes} — bấm Hoàn tất ở dòng đó để điền nốt`
          : `Đã giữ chỗ ${created.length} tài khoản: ${codes} — điền nốt từng dòng`,
      );

      /**
       * Đưa người dùng tới chỗ có mấy dòng vừa tạo.
       *
       * Không chuyển trang khi đã đứng ở đó: `push` lên chính trang hiện tại đẩy
       * thêm một mục vào lịch sử trình duyệt, và nút Quay lại của điện thoại
       * phải bấm hai lần mới rời đi.
       */
      if (pathname !== BANKING_PATH) router.push(BANKING_PATH);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không mở được tài khoản nào.")),
  });

  const noSlotLeft = slots ? remaining <= 0 : false;
  // Trần 3 chỉ đếm dòng chính; dòng HKD không phải ngân hàng nên không chiếm chỗ.
  const mainPicks = picks.filter((p) => p.accountType !== "HKD").length;

  /**
   * Ngân hàng KHÔNG tích được vẫn nằm trong danh sách, khoá lại và mang một
   * dòng lý do (chốt 2026-09-05). Bản trước lọc chúng ra khỏi danh sách, nên
   * nhân viên không có cách nào biết vì sao ngân hàng họ đang tìm lại không có
   * ở đó. Nặng nhất là ca "lần trước đã mở": hồ sơ đang xem không hiện tài
   * khoản của lần trước, nên dòng đó biến mất mà không có gì thay thế.
   *
   * Thứ tự lý do là thứ tự dứt khoát dần. Ngân hàng ngừng triển khai thì không
   * ai mở được nữa; các lý do sau đều gắn với riêng khách này.
   *
   * `hkd` là dòng HKD của ngân hàng đó: một chỗ riêng, so với dòng HKD đã có
   * chứ không so với dòng chính. Dòng chính đang CNKD thì dòng HKD khoá, vì
   * một khách chỉ có CNKD hoặc HKD.
   */
  const reasonFor = (bank: Bank, hkd: boolean): string | null => {
    if (!bank.active) return "Ngừng triển khai";
    if (!slots) return null;
    const mine = slots.used.filter((u) => u.bankId === bank.id);
    const taken = mine.find((u) => u.hkd === hkd);
    if (taken) return taken.here ? "Hồ sơ này đã có tài khoản" : "Khách đã mở ở hồ sơ trước";
    if (hkd && mine.some((u) => !u.hkd && u.cnkd)) return "Tài khoản chính đang là CNKD";
    if (slots.eligibleBankIds.includes(bank.id)) return null;
    return slots.hasDob
      ? `Khách ngoài độ tuổi (${ageRangeLabel(bank)})`
      : "Chưa có ngày sinh của khách";
  };

  /**
   * Cùng luật CNKD/HKD nhưng xét trên những dòng ĐANG TÍCH trong biểu mẫu này:
   * dòng chính đang chọn CNKD thì dòng HKD khoá. Chiều ngược lại xử lý ở ô chọn
   * loại của dòng chính (`hideCnkd`), nên hai chiều không bao giờ cùng xảy ra.
   */
  const inFormReason = (bankId: string, hkd: boolean): string | null =>
    hkd && picks.some((p) => samePick(p, bankId, false) && p.accountType === "CNKD")
      ? "Tài khoản chính đang chọn CNKD"
      : null;

  /**
   * Sắp lại ở trình duyệt là ngoại lệ có chủ ý của AGENTS.md §5.1. Đây là danh
   * mục đóng vài chục dòng, và thứ hạng phụ thuộc dữ liệu của KHÁCH chứ không
   * phải của ngân hàng: sắp ở máy chủ nghĩa là sắp lại riêng cho từng khách.
   * Thứ tự ưu tiên của `listBanks` giữ nguyên trong từng nhóm.
   *
   * Ngân hàng có mã HKD ra HAI dòng, dòng HKD đứng ngay sau dòng chính.
   */
  type PickOption = { bank: Bank; hkd: boolean; reason: string | null };
  const options: PickOption[] = banks.flatMap((bank) => {
    const rows: PickOption[] = [{ bank, hkd: false, reason: reasonFor(bank, false) }];
    if (slots?.hkdBankIds.includes(bank.id))
      rows.push({ bank, hkd: true, reason: reasonFor(bank, true) });
    return rows;
  });
  const orderedOptions = [
    ...options.filter((o) => o.reason === null),
    ...options.filter((o) => o.reason !== null),
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Mở tài khoản ngân hàng"
      footerStart={onBack && <BackButton onClick={onBack}>Chọn khách khác</BackButton>}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="bank-account-form"
            disabled={isSubmitting || create.isPending || !slots || picks.length === 0}
          >
            {picks.length > 1 ? `Tạo ${picks.length} tài khoản` : "Tạo tài khoản"}
          </Button>
        </>
      }
    >
      {!slots ? (
        /*
         * Chưa biết chỗ trống thì CHƯA vẽ danh sách.
         *
         * Vẽ trước rồi sắp lại khi dữ liệu về thì trong khoảng một giây đầu mọi
         * ngân hàng đều tích được: người dùng tích trúng một ngân hàng sắp
         * khoá, dòng đó tụt xuống cuối, mà dấu tích vẫn nằm trong biểu mẫu và
         * máy chủ mới từ chối lúc lưu.
         */
        <SkeletonText lines={4} label="Đang tải danh sách ngân hàng" />
      ) : (
        <form
          id="bank-account-form"
          className={styles.form}
          onSubmit={handleSubmit((form) => create.mutate(form), reportInvalid)}
          noValidate
        >
          {/*
            Đủ trần vẫn dựng danh sách: dòng HKD không chiếm chỗ trong trần
            nên khách đủ 3 tài khoản vẫn mở thêm được dòng HKD (chốt
            2026-09-06). Các dòng chính khoá theo `full`, câu này nói vì sao.
            P-21 đã bỏ khách đủ trần khỏi ô tìm, nên đường tới đây là hai nút
            "Mở ngân hàng" ở P-40 và P-42, chỗ khách đã cố định sẵn.
          */}
          {noSlotLeft && (
            <Alert tone="warning">
              {`Hồ sơ này đã có đủ ${MAX_BANK_ACCOUNTS_PER_CUSTOMER} tài khoản ngân hàng, chỉ còn mở thêm được dòng HKD. Bản nháp cũng tính; xoá một bản nháp thì mở thêm được một tài khoản.`}
            </Alert>
          )}
          <DepartmentPicker
            module="banking"
            value={departmentId}
            /**
             * Đổi phòng là đổi danh sách mã dùng được (spec §4.4d). Mã đã chọn
             * theo phòng cũ có thể không còn dùng được cho phòng mới, mà máy chủ
             * chỉ từ chối lúc lưu. Xoá hết mã đã chọn để từng dòng gợi ý lại.
             */
            onChange={(v) => {
              setValue("departmentId", v, { shouldDirty: true });
              writePicks((current) => current.map((p) => ({ ...p, referralCode: "" })));
            }}
          />

          <div className={styles.pickHead}>
            <span id="bank-pick-label" className={styles.pickTitle}>
              Chọn ngân hàng
            </span>
            <span className={styles.pickCount}>
              Đã chọn {mainPicks}/{remaining}
            </span>
          </div>

          {/*
            `role="group"` chứ không phải danh sách trơn: trình đọc màn hình phải
            đọc được "Ngân hàng mở lần này" một lần rồi mới tới từng ô tích, chứ
            không đọc mười ba ô tích rời rạc không rõ thuộc về câu hỏi nào.
          */}
          <div className={styles.pickList} role="group" aria-labelledby="bank-pick-label">
            {orderedOptions.map(({ bank, hkd, reason }) => (
              <BankPickRow
                key={`${bank.id}:${hkd ? "hkd" : "main"}`}
                bank={bank}
                hkd={hkd}
                departmentId={departmentId}
                pick={picks.find((p) => samePick(p, bank.id, hkd))}
                full={!hkd && mainPicks >= remaining}
                reason={reason ?? inFormReason(bank.id, hkd)}
                hideCnkd={picks.some((p) => samePick(p, bank.id, true))}
                onToggle={(checked) => toggleBank(bank.id, hkd, checked)}
                onCodeChange={(code) => setCode(bank.id, hkd, code)}
                onAccountTypeChange={(type) => setAccountType(bank.id, type)}
              />
            ))}
          </div>

          {/* Lỗi mức DANH SÁCH — chưa tích ngân hàng nào, hoặc tích quá trần.
              Không ô tích nào mang được câu này nên nó đứng riêng ở đây. */}
          {errors.picks?.message && (
            <span className={styles.pickError} role="alert">
              {errors.picks.message}
            </span>
          )}
        </form>
      )}
    </Dialog>
  );
}

type RowProps = {
  bank: Bank;
  /** Dòng HKD của ngân hàng này, không phải dòng chính. Loại cố định là HKD. */
  hkd: boolean;
  departmentId: string;
  /** Có giá trị nghĩa là ngân hàng này đang được tích. */
  pick: BankAccountPick | undefined;
  /** Đã tích đủ số tài khoản khách mở thêm được. */
  full: boolean;
  /** Có giá trị nghĩa là ngân hàng này không mở được, và đây là vì sao. */
  reason: string | null;
  /** Dòng HKD của ngân hàng này đang tích, nên dòng chính không được chọn CNKD. */
  hideCnkd: boolean;
  onToggle: (checked: boolean) => void;
  onCodeChange: (referralCode: string) => void;
  onAccountTypeChange: (accountType: AccountType) => void;
};

/**
 * Một dòng ngân hàng: ô tích, và ô chọn mã hiện ra khi tích.
 *
 * Tách thành component riêng vì mỗi ngân hàng cần MỘT truy vấn mã của riêng nó —
 * gọi `useQuery` trong vòng lặp ở component cha là gọi hook có điều kiện.
 */
function BankPickRow({
  bank,
  hkd,
  departmentId,
  pick,
  full,
  reason,
  hideCnkd,
  onToggle,
  onCodeChange,
  onAccountTypeChange,
}: RowProps) {
  const checked = pick !== undefined;
  const rowLabel = hkd ? `${bank.code} HKD` : bank.code;

  /**
   * Máy chủ đã lọc "còn chỗ" và lọc theo phạm vi phòng — không lọc lại ở đây
   * (AGENTS.md §5.1).
   *
   * `departmentId` chỉ có giá trị với người không thuộc phòng nào; máy chủ bỏ
   * qua nó với người có phòng và dùng phòng thật của họ. Nó nằm trong khoá cache
   * vì đổi phòng là đổi danh sách mã (spec §4.4d).
   */
  const { data: allCodes = [], isPending: allCodesPending } = useQuery({
    queryKey: ["referral-codes", "open", bank.id, departmentId, "all-types"],
    queryFn: () => fetchOpenReferralCodes(bank.id, departmentId),
    enabled: checked && !hkd,
  });
  /**
   * Dòng chính chỉ chọn giữa thường và CNKD; HKD là dòng riêng ngay dưới. Đã
   * tích dòng HKD thì bỏ luôn CNKD khỏi ô chọn: một khách chỉ có CNKD hoặc
   * HKD, và máy chủ từ chối cặp đó.
   */
  const availableTypes: AccountType[] = hkd
    ? ["HKD"]
    : [...new Set(allCodes.map((code) => code.accountType))].filter(
        (t) => t !== "HKD" && !(hideCnkd && t === "CNKD"),
      );
  const accountType = pick?.accountType ?? (hkd ? "HKD" : "none");
  const { data: codes = [], isPending } = useQuery({
    queryKey: ["referral-codes", "open", bank.id, departmentId, accountType],
    queryFn: () => fetchOpenReferralCodes(bank.id, departmentId, accountType),
    enabled: checked && availableTypes.includes(accountType),
  });

  // Ngân hàng chỉ có một loại (VD VPb chỉ CNKD) tự chốt loại đó; không bày
  // thêm ô chọn một giá trị duy nhất. Dòng HKD cố định loại từ lúc tích.
  useEffect(() => {
    if (checked && !hkd && availableTypes.length === 1 && accountType !== availableTypes[0])
      onAccountTypeChange(availableTypes[0]);
  }, [accountType, availableTypes, checked, hkd, onAccountTypeChange]);

  /**
   * Gợi ý sẵn mã đầu còn chỗ. Đây là ĐỒNG BỘ dữ liệu ngoài vào biểu mẫu, không
   * phải giá trị suy ra được: danh sách mã về sau qua mạng, còn lúc người dùng
   * tích thì chưa có gì để chọn.
   *
   * Chỉ ghi khi ô đang RỖNG — đè lên lựa chọn của người dùng mỗi lần danh sách
   * tải lại là họ chọn mã khác rồi thấy nó tự nhảy về mã đầu.
   */
  const suggested = codes[0]?.id ?? "";
  useEffect(() => {
    if (checked && !pick.referralCode && suggested) onCodeChange(suggested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, pick?.referralCode, suggested]);

  /**
   * Tích đủ số tài khoản rồi thì các dòng CÒN LẠI khoá, không kèm chữ giải
   * thích: dòng "Đã chọn 1/1" ở ngay trên đã nói vì sao, viết thêm ở từng dòng
   * là lặp lại cùng một câu mười ba lần.
   *
   * Dòng đang tích thì KHÔNG khoá. Khoá cả nó thì bỏ tích không được nữa —
   * khách mở thêm được đúng một tài khoản, tích một ngân hàng là mọi dòng khoá
   * lại, không cách nào đổi sang ngân hàng khác.
   */
  const locked = !checked && full;
  // Mờ cả mã ngân hàng khi khoá vì bất kỳ lý do nào: ô tích khoá tự mờ nhưng
  // chữ bên cạnh thì không, và nhìn bằng mắt không phân biệt được dòng nào còn
  // tích được.
  const off = locked || reason !== null;

  return (
    <div className={off ? `${styles.pickRow} ${styles.pickRowOff}` : styles.pickRow}>
      <Checkbox
        block
        checked={checked}
        disabled={locked || reason !== null}
        onCheckedChange={onToggle}
        /*
         * Lý do nằm TRONG nhãn của ô tích, không phải một dòng chữ đứng cạnh:
         * trình đọc màn hình đọc nhãn của ô tích đang khoá, nên phải nghe được
         * "VPb, khách đã mở ở hồ sơ trước" trong cùng một câu.
         */
        label={
          <span className={styles.pickLabelBox}>
            <strong className={styles.pickLabel}>{rowLabel}</strong>
            {reason && <span className={styles.pickReason}>{reason}</span>}
          </span>
        }
      />

      {checked && (
        <div className={styles.pickCode}>
          {availableTypes.length > 1 ? (
            <Select
              block
              required
              label={`Loại tài khoản · ${rowLabel}`}
              value={accountType}
              onChange={(v) => onAccountTypeChange(v as AccountType)}
              options={availableTypes.map((value) => ({ value, label: ACCOUNT_TYPE_LABEL[value] }))}
            />
          ) : availableTypes.length === 1 && availableTypes[0] !== "none" ? (
            <p className={styles.codeDetail}>Loại tài khoản: {ACCOUNT_TYPE_LABEL[availableTypes[0]]}</p>
          ) : null}
          <Select
            block
            label={`Mã giới thiệu · ${rowLabel}`}
            required
            value={pick.referralCode}
            onChange={onCodeChange}
            options={
              codes.length === 0
                ? [{ value: "", label: isPending || allCodesPending ? "— Đang tải mã —" : "— Hết mã —" }]
                : codes.map((c) => ({
                    value: c.id,
                    // Trừ cả `holding`: tài khoản người khác đang mở dở đã chiếm
                    // chỗ rồi, không trừ là hứa thừa.
                    label: `${c.displayName || c.code}${c.code && (c.displayName || c.code) !== c.code ? ` — ${c.code}` : ""}${c.province ? ` · ${c.province}` : ""} · còn ${c.total - c.used - c.holding} chỗ`,
                  }))
            }
          />
          {(() => {
            const picked = codes.find((c) => c.id === pick.referralCode);
            const detail = picked
              ? [picked.province, picked.supportBranch].filter(Boolean).join(" · ")
              : "";
            return detail ? <p className={styles.codeDetail}>{detail}</p> : null;
          })()}
        </div>
      )}
    </div>
  );
}
