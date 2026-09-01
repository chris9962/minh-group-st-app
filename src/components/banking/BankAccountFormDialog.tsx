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
import { fetchBanks, fetchOpenReferralCodes, type Bank } from "@/lib/api/bankCatalog";
import {
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
const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  none: "Thường",
  CNKD: "CNKD",
  HKD: "HKD",
};

type Props = {
  open: boolean;
  onClose: () => void;
  customerId: string;
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
export function BankAccountFormDialog({ open, onClose, customerId, onBack }: Props) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const activeBanks = banks.filter((b) => b.active);

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
  const usedBankIds = new Set(slots?.usedBankIds ?? []);
  const eligibleBankIds = new Set(slots?.eligibleBankIds ?? []);
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
    defaultValues: { customerId, picks: [], departmentId: "" },
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

  const toggleBank = (bankId: string, checked: boolean) =>
    writePicks((current) =>
      checked
        ? [...current, { bankId, referralCode: "", accountType: "none" }]
        : current.filter((p) => p.bankId !== bankId),
    );

  const setCode = (bankId: string, referralCode: string) =>
    writePicks((current) =>
      current.map((p) => (p.bankId === bankId ? { ...p, referralCode } : p)),
    );

  const setAccountType = (bankId: string, accountType: AccountType) =>
    writePicks((current) =>
      current.map((p) => (p.bankId === bankId ? { ...p, accountType, referralCode: "" } : p)),
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
  const unownedActiveBanks = activeBanks.filter((b) => !usedBankIds.has(b.id));
  const selectableBanks = unownedActiveBanks.filter((b) => !slots || eligibleBankIds.has(b.id));
  const noBankLeft = slots ? selectableBanks.length === 0 : false;
  const noAgeEligibleBank = slots ? unownedActiveBanks.length > 0 && selectableBanks.length === 0 : false;
  const blocked = noSlotLeft || noBankLeft;

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
            disabled={isSubmitting || create.isPending || blocked || picks.length === 0}
          >
            {picks.length > 1 ? `Tạo ${picks.length} tài khoản` : "Tạo tài khoản"}
          </Button>
        </>
      }
    >
      {blocked ? (
        /*
         * Hết chỗ thì hộp thoại chỉ còn câu giải thích — không dựng danh sách
         * ngân hàng đã tắt hết ô tích dưới một dòng báo lỗi.
         *
         * P-21 đã bỏ khách đủ trần khỏi ô tìm, nên đường tới đây là hai nút
         * "Mở ngân hàng" ở P-40 và P-42, chỗ khách đã cố định sẵn.
         */
        <Alert tone="error">
          {noSlotLeft
            ? `Khách này đã có đủ ${MAX_BANK_ACCOUNTS_PER_CUSTOMER} tài khoản ngân hàng, không mở thêm được. Bản nháp cũng tính — xoá một bản nháp thì mở thêm được một tài khoản.`
            : noAgeEligibleBank
              ? "Không có ngân hàng phù hợp với độ tuổi của khách này."
              : "Khách này đã mở tài khoản ở tất cả ngân hàng đang triển khai."}
        </Alert>
      ) : (
        <form
          id="bank-account-form"
          className={styles.form}
          onSubmit={handleSubmit((form) => create.mutate(form), reportInvalid)}
          noValidate
        >
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
              Đã chọn {picks.length}/{remaining}
            </span>
          </div>

          {/*
            `role="group"` chứ không phải danh sách trơn: trình đọc màn hình phải
            đọc được "Ngân hàng mở lần này" một lần rồi mới tới từng ô tích, chứ
            không đọc mười ba ô tích rời rạc không rõ thuộc về câu hỏi nào.
          */}
          <div className={styles.pickList} role="group" aria-labelledby="bank-pick-label">
            {selectableBanks.map((bank) => (
              <BankPickRow
                key={bank.id}
                bank={bank}
                departmentId={departmentId}
                pick={picks.find((p) => p.bankId === bank.id)}
                full={picks.length >= remaining}
                onToggle={(checked) => toggleBank(bank.id, checked)}
                onCodeChange={(code) => setCode(bank.id, code)}
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
  departmentId: string;
  /** Có giá trị nghĩa là ngân hàng này đang được tích. */
  pick: BankAccountPick | undefined;
  /** Đã tích đủ số tài khoản khách mở thêm được. */
  full: boolean;
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
  departmentId,
  pick,
  full,
  onToggle,
  onCodeChange,
  onAccountTypeChange,
}: RowProps) {
  const checked = pick !== undefined;

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
    enabled: checked,
  });
  const availableTypes = [...new Set(allCodes.map((code) => code.accountType))];
  const accountType = pick?.accountType ?? "none";
  const { data: codes = [], isPending } = useQuery({
    queryKey: ["referral-codes", "open", bank.id, departmentId, accountType],
    queryFn: () => fetchOpenReferralCodes(bank.id, departmentId, accountType),
    enabled: checked && availableTypes.includes(accountType),
  });

  // Ngân hàng chỉ có một loại (VD VPb chỉ CNKD) tự chốt loại đó; không bày
  // thêm ô chọn một giá trị duy nhất.
  useEffect(() => {
    if (checked && availableTypes.length === 1 && accountType !== availableTypes[0])
      onAccountTypeChange(availableTypes[0]);
  }, [accountType, availableTypes, checked, onAccountTypeChange]);

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

  return (
    <div className={styles.pickRow}>
      <Checkbox
        block
        checked={checked}
        disabled={locked}
        onCheckedChange={onToggle}
        label={<strong className={styles.pickLabel}>{bank.code}</strong>}
      />

      {checked && (
        <div className={styles.pickCode}>
          {availableTypes.length > 1 ? (
            <Select
              block
              required
              label={`Loại tài khoản · ${bank.code}`}
              value={accountType}
              onChange={(v) => onAccountTypeChange(v as AccountType)}
              options={availableTypes.map((value) => ({ value, label: ACCOUNT_TYPE_LABEL[value] }))}
            />
          ) : availableTypes.length === 1 && availableTypes[0] !== "none" ? (
            <p className={styles.codeDetail}>Loại tài khoản: {ACCOUNT_TYPE_LABEL[availableTypes[0]]}</p>
          ) : null}
          <Select
            block
            label={`Mã giới thiệu · ${bank.code}`}
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
