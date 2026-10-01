"use client";

import { clsx } from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SkeletonText } from "@/components/ui/Skeleton";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { InsuranceOrderFormDialog } from "@/components/insurance/InsuranceOrderFormDialog";
import {
  GIFT_DECLINED,
  GIFT_NONE,
  extraSlotKey,
  extraSlotLabel,
  fetchCustomerDetail,
  isCashOnlyGift,
  markGiftGiven,
  type CustomerDetail,
} from "@/lib/api/customers";
import { fetchInsurancePackages } from "@/lib/api/settings";
import { formatVnd } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./GiftGivingDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  customerId: string;
  customerName: string;
};

const DECLINE = "__decline__";

type BasketItem = CustomerDetail["gift"]["basket"][number];

/**
 * P-43 · Tặng quà — bật lên từ hồ sơ khách (P-42) hoặc bảng khách hàng (P-40).
 *
 * Rổ chính chọn ĐÚNG 1 món hoặc từ chối: gói bảo hiểm của combo, hoặc món quy
 * đổi của Phòng Y. Rổ quà thêm: MỖI dòng HKD của khách chọn đúng 1 món hoặc
 * từ chối (chốt 2026-09-30), cộng thêm vào rổ chính.
 *
 * Món bảo hiểm tự mở form người thụ hưởng và tạo đơn luôn, món vật phẩm đánh
 * dấu đã tặng ngay. Rổ quà thêm chỉ có vật phẩm.
 */
export function GiftGivingDialog({ open, onClose, customerId, customerName }: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string>("");
  /** Món đang chọn của từng dòng HKD, khoá theo `extraSlotKey`. */
  const [selectedExtras, setSelectedExtras] = useState<Record<string, string>>({});
  const [creatingOrder, setCreatingOrder] = useState(false);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => fetchCustomerDetail(customerId),
  });
  /**
   * Danh mục gói bảo hiểm quyết định món đã chọn đi đường nào: món BẢO HIỂM phải
   * mở form người thụ hưởng rồi tạo đơn, món VẬT PHẨM thì đánh dấu đã tặng ngay.
   *
   * Chưa tải xong mà vẫn cho bấm là hỏng KHÔNG SỬA ĐƯỢC: `packages` rỗng nên mọi
   * món trông như vật phẩm, khách chọn gói bảo hiểm sẽ bị ghi "đã tặng" mà không
   * có đơn nào được tạo — mà quà chỉ tặng đúng một lần, không có đợt hai (spec
   * §4.4 P-43). Nên phải chặn ở nút, không chỉ hiện nhãn sai.
   */
  const {
    data: packages = [],
    isPending: packagesPending,
    isError: packagesError,
    refetch: refetchPackages,
    isFetching: packagesFetching,
  } = useQuery({
    queryKey: ["insurance-packages"],
    queryFn: fetchInsurancePackages,
  });

  const basket = data?.gift.basket ?? [];
  const extraBasket = data?.gift.extraBasket ?? [];
  const extraSlots = data?.gift.extraSlots ?? [];
  const hasExtra = extraBasket.length > 0 && extraSlots.length > 0;
  /**
   * Rổ chính rỗng mà rổ quà thêm có món — khách chỉ có dòng HKD. Không có gì để chọn
   * ở rổ chính nên máy chủ nhận `NONE`, khác với "từ chối".
   */
  const mainIsNone = basket.length === 0 && hasExtra;

  // Sự thật gửi lên máy chủ. `DECLINE` là giá trị nội bộ của nút radio.
  const mainCode = mainIsNone ? GIFT_NONE : selected === DECLINE ? GIFT_DECLINED : selected;
  const extras = hasExtra
    ? extraSlots.map((slot) => {
        const picked = selectedExtras[extraSlotKey(slot)] ?? "";
        return { bankAccountId: slot.bankAccountId, item: picked === DECLINE ? GIFT_DECLINED : picked };
      })
    : [];
  const chosenExtraNames = extras
    .map((e) => extraBasket.find((b) => b.code === e.item)?.name ?? "")
    .filter(Boolean);

  const ready = (mainIsNone || selected !== "") && extras.every((e) => e.item !== "");

  // Gửi MÃ món lên máy chủ (#74), nhưng toast phải nói TÊN — người dùng không
  // đọc `BH-1N-XEMAY`. Nên mutation nhận cả hai.
  const markGiven = useMutation({
    mutationFn: ({ code, orderIds = [] }: { code: string; label: string; orderIds?: string[] }) =>
      markGiftGiven(customerId, code, orderIds, extras),
    onSuccess: (_data, { code, label }) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      onClose();
      const parts = [code === GIFT_DECLINED || code === GIFT_NONE ? "" : label, ...chosenExtraNames].filter(
        Boolean,
      );
      toast.ok(
        parts.length === 0
          ? `Đã ghi nhận ${customerName} từ chối quà`
          : `Đã tặng ${parts.join(" + ")} cho ${customerName}`,
      );
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đánh dấu được quà đã tặng.")),
  });

  if (creatingOrder && data) {
    const chosen = basket.find((b) => b.code === selected);
    return (
      <InsuranceOrderFormDialog
        open
        customer={data.customer}
        source="gift"
        prefill={{ packageName: chosen?.name ?? "" }}
        onClose={() => setCreatingOrder(false)}
        onCreated={(orders) =>
          markGiven.mutate({
            code: chosen?.code ?? "",
            label: chosen?.name ?? "Quà tặng",
            orderIds: orders.map((order) => order.id),
          })
        }
      />
    );
  }

  /**
   * Tiền mặt ứng với món ĐANG chọn. Chưa chọn gì hoặc chọn "Từ chối" thì lấy số
   * mặc định — từ chối quà không làm mất tiền.
   */
  const cashOfChoice =
    selected && selected !== DECLINE
      ? (basket.find((b) => b.code === selected)?.cashIfChosen ?? data?.gift.cashTotal ?? 0)
      : (data?.gift.cashTotal ?? 0);

  const confirm = () => {
    if (!ready) return;
    // Chốt chặn thứ hai, sau nút bị vô hiệu: không biết món nào là bảo hiểm thì
    // KHÔNG được chốt. Đánh dấu nhầm là mất suất quà của khách vĩnh viễn.
    if (packagesPending || packagesError) return;
    if (mainCode === GIFT_DECLINED || mainCode === GIFT_NONE) {
      markGiven.mutate({ code: mainCode, label: "" });
      return;
    }
    const item = basket.find((b) => b.code === mainCode);
    if (!item) return;
    if (packages.some((p) => p.id === item.id)) {
      setCreatingOrder(true);
    } else {
      markGiven.mutate({ code: item.code, label: item.name });
    }
  };

  /** Một nhóm radio: rổ chính hoặc một dòng HKD. */
  type Group = { name: string; current: string; pick: (code: string) => void; insurance: boolean };
  const mainGroup: Group = { name: "gift-choice-main", current: selected, pick: setSelected, insurance: true };
  const extraGroupOf = (key: string): Group => ({
    name: `gift-choice-extra-${key}`,
    current: selectedExtras[key] ?? "",
    pick: (code) => setSelectedExtras((prev) => ({ ...prev, [key]: code })),
    insurance: false,
  });

  const renderCard = (item: BasketItem, group: Group, index: number) => {
    const isInsurance = group.insurance && packages.some((p) => p.id === item.id);
    // Vẫn hiện, nhưng không chọn được: khách đủ điều kiện nhận món này, chỉ là
    // danh mục đang ngừng cấp. Giấu đi thì nhân viên tưởng khách không được hưởng.
    const off = item.status !== "ok";
    return (
      <label
        key={`${group.name}-${item.code}-${index}`}
        className={clsx(styles.card, group.current === item.code && styles.cardActive, off && styles.cardOff)}
      >
        <input
          type="radio"
          name={group.name}
          disabled={off}
          checked={!off && group.current === item.code}
          onChange={() => group.pick(item.code)}
        />
        <span className={styles.cardName}>{item.name}</span>
        <span className={styles.cardKind}>
          {off
            ? item.status === "discontinued"
              ? "Đã ngưng cấp"
              : "Không còn trong danh mục"
            : isInsurance
              ? "Bảo hiểm"
              : "Vật phẩm"}
        </span>
      </label>
    );
  };

  const renderDecline = (group: Group, label: string) => (
    <label className={clsx(styles.card, group.current === DECLINE && styles.cardActive)}>
      <input
        type="radio"
        name={group.name}
        checked={group.current === DECLINE}
        onChange={() => group.pick(DECLINE)}
      />
      <span className={styles.cardName}>{label}</span>
    </label>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Tặng quà - ${customerName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            onClick={confirm}
            disabled={!ready || markGiven.isPending || packagesPending || packagesError}
          >
            Xác nhận
          </Button>
        </>
      }
    >
      {isPending && <SkeletonText lines={3} label="Đang tải danh sách quà" />}
      {/* Thiếu nhánh này thì tải hỏng ra hộp thoại RỖNG: không chữ, không nút thử lại. */}
      {isError && <ErrorState what="danh sách quà của khách" onRetry={refetch} retrying={isFetching} />}
      {packagesError && (
        <ErrorState
          what="danh mục gói bảo hiểm"
          onRetry={refetchPackages}
          retrying={packagesFetching}
        />
      )}

      {data && (
        <div className={styles.body}>
          {data.gift.given ? (
            <Alert tone="warning">
              Khách này đã nhận quà.
            </Alert>
          ) : (
            <>
              {/*
                Số tiền đổi theo món đang chọn. Con số từng món do luật trả về
                (`cashIfChosen`), giao diện không tự biết món nào chặn tiền.

                Chưa chọn gì và "Từ chối" đều dùng `cashTotal` — từ chối quà
                không làm mất tiền.
              */}
              <p className={styles.cash}>
                Tiền mặt tự động: <strong>{formatVnd(cashOfChoice)}</strong>
              </p>

              {basket.length === 0 && !hasExtra ? (
                // Danh sách khách (P-40) vẫn mở được hộp này cho khách chỉ nhận
                // tiền; câu "chưa đủ điều kiện" sai với họ.
                <p className="text-muted">
                  {isCashOnlyGift(data.gift) ? "Khách chỉ nhận tiền mặt." : "Khách chưa đủ điều kiện nhận quà."}
                </p>
              ) : (
                <>
                  <fieldset className={styles.group}>
                    <legend className={styles.groupTitle}>{hasExtra ? "Quà chính" : "Danh sách quà"}</legend>
                    {mainIsNone ? (
                      <p className="text-muted">Khách chưa đủ combo nào nên không có quà chính.</p>
                    ) : (
                      <>
                        <p className={styles.hint}>
                          Chọn <strong>đúng 1</strong> món dưới đây:
                        </p>
                        <div className={styles.cards}>
                          {basket.map((item, i) => renderCard(item, mainGroup, i))}
                          {renderDecline(mainGroup, "Từ chối, không lấy gì")}
                        </div>
                      </>
                    )}
                  </fieldset>

                  {/* Mỗi dòng HKD một nhóm: khách có hai HKD thì chọn hai lần. */}
                  {hasExtra &&
                    extraSlots.map((slot) => {
                      const group = extraGroupOf(extraSlotKey(slot));
                      return (
                        <fieldset key={group.name} className={styles.group}>
                          <legend className={styles.groupTitle}>Quà thêm {extraSlotLabel(slot)}</legend>
                          <p className={styles.hint}>
                            Chọn <strong>đúng 1</strong> món dưới đây, cộng với quà chính:
                          </p>
                          <div className={styles.cards}>
                            {extraBasket.map((item, i) => renderCard(item, group, i))}
                            {renderDecline(group, "Từ chối quà thêm")}
                          </div>
                        </fieldset>
                      );
                    })}
                </>
              )}

              {/* Khoản ngoài hệ thống, không phải món chọn được. Đặt dưới danh
                  sách quà để nhân viên nói với khách sau khi chốt món. */}
              {data.gift.giftNote && <p className={styles.note}>{data.gift.giftNote}</p>}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
