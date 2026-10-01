"use client";

import { clsx } from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { InsuranceOrderFormDialog } from "@/components/insurance/InsuranceOrderFormDialog";
import { TextArea } from "@/components/ui/TextArea";
import {
  GIFT_DECLINED,
  GIFT_UNCHOSEN,
  changeGift,
  extraSlotKey,
  extraSlotLabel,
  fetchCustomerDetail,
  type CustomerDetail,
  type GivenExtra,
} from "@/lib/api/customers";
import { fetchInsurancePackages } from "@/lib/api/settings";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./GiftGivingDialog.module.scss";

const DECLINE = "__decline__";

/**
 * Lý do ghi sẵn khi quà chính còn trống sau migration 0095: đây không phải
 * khách đổi ý, nên không bắt nhân viên nghĩ ra một câu.
 */
const UNCHOSEN_REASON = "Chọn quà chính sau khi tách quà thêm HKD";

type Props = { open: boolean; onClose: () => void; customerId: string; customerName: string };

type BasketItem = CustomerDetail["gift"]["basket"][number];

/**
 * Đổi món quà của khách đã chốt; đơn bảo hiểm cũ được server xử lý cùng lượt.
 *
 * Danh sách lấy rổ TÍNH THEO TÀI KHOẢN HIỆN TẠI, không phải rổ lúc phát (chốt
 * 2026-09-06) — khách mở thêm tài khoản trong ngày thì đổi lên món của combo
 * cao hơn ngay tại đây.
 *
 * Nhóm quà chính và một nhóm cho MỖI dòng HKD đã có câu trả lời (chốt
 * 2026-09-17, tách theo dòng HKD 2026-09-30). Nhóm nào không chọn gì là giữ
 * nguyên; phải đổi ít nhất một nhóm. Chỉ đổi quà thêm thì máy chủ không đụng
 * đơn bảo hiểm của quà chính. Dòng HKD chưa có câu trả lời đi hộp thoại "Chọn
 * quà thêm".
 *
 * Cũng là đường CHỌN quà chính cho đợt mang `UNCHOSEN` (migration 0095): lúc
 * đó không đòi lý do và máy chủ không đòi trong ngày phát.
 */
export function GiftChangeDialog({ open, onClose, customerId, customerName }: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState("");
  const [selectedExtras, setSelectedExtras] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [creatingOrder, setCreatingOrder] = useState(false);
  const detail = useQuery({ queryKey: ["customer", customerId], queryFn: () => fetchCustomerDetail(customerId) });
  const packages = useQuery({ queryKey: ["insurance-packages"], queryFn: fetchInsurancePackages });

  const gift = detail.data?.gift;
  const unchosen = gift?.givenCode === GIFT_UNCHOSEN;
  const reasonText = unchosen ? UNCHOSEN_REASON : reason;
  const reasonOk = reasonText.trim().length >= 2;

  // Chỉ dòng HKD đã có câu trả lời và còn suất theo tài khoản hiện tại mới đổi được ở đây.
  const liveKeys = new Set((gift?.extraSlots ?? []).map(extraSlotKey));
  const changeableExtras: GivenExtra[] =
    (gift?.liveExtraBasket.length ?? 0) > 0
      ? (gift?.givenExtras ?? []).filter((e) => liveKeys.has(extraSlotKey(e)))
      : [];
  const extraBasket = gift?.liveExtraBasket ?? [];

  const mainCode = selected === DECLINE ? GIFT_DECLINED : selected;
  const extras = changeableExtras.flatMap((given) => {
    const picked = selectedExtras[extraSlotKey(given)];
    if (!picked) return [];
    return [{ bankAccountId: given.bankAccountId, item: picked === DECLINE ? GIFT_DECLINED : picked }];
  });
  const anyChange = selected !== "" || extras.length > 0;

  const save = useMutation({
    mutationFn: (newOrderIds: string[] | undefined) =>
      changeGift(customerId, {
        // Không chọn gì ở nhóm chính là giữ món đang có.
        item: mainCode || (gift?.givenCode ?? ""),
        extras,
        reason: reasonText,
        newOrderIds: newOrderIds ?? [],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      toast.ok(`Đã đổi quà cho ${customerName}`);
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đổi được quà.")),
  });

  const chosen = gift?.liveBasket.find((item) => item.code === selected);
  if (creatingOrder && detail.data && chosen) {
    return <InsuranceOrderFormDialog open customer={detail.data.customer} source="gift" prefill={{ packageName: chosen.name }} onClose={() => setCreatingOrder(false)} onCreated={(orders) => save.mutate(orders.map((o) => o.id))} />;
  }
  const confirm = () => {
    if (!anyChange || !reasonOk) return;
    if (selected && selected !== DECLINE && packages.data?.some((p) => p.id === chosen?.id)) setCreatingOrder(true);
    else save.mutate([]);
  };

  type Group = { name: string; current: string; applied: string | null; pick: (code: string) => void };
  const mainGroup: Group = { name: "gift-change-main", current: selected, applied: gift?.givenCode ?? null, pick: setSelected };
  const extraGroupOf = (given: GivenExtra): Group => {
    const key = extraSlotKey(given);
    return {
      name: `gift-change-extra-${key}`,
      current: selectedExtras[key] ?? "",
      applied: given.code,
      pick: (code) => setSelectedExtras((prev) => ({ ...prev, [key]: code })),
    };
  };

  const renderCard = (item: BasketItem, group: Group, index: number) => {
    const applied = item.code === group.applied;
    const off = applied || item.status !== "ok";
    return (
      <label key={`${group.name}-${item.code}-${index}`} className={clsx(styles.card, group.current === item.code && styles.cardActive, off && styles.cardOff)}>
        <input type="radio" name={group.name} disabled={off} checked={group.current === item.code} onChange={() => group.pick(item.code)} />
        <span className={styles.cardName}>{item.name}</span>
        <span className={styles.cardKind}>{applied ? "Đang áp dụng" : item.status === "ok" ? "Chọn đổi" : "Không còn cấp"}</span>
      </label>
    );
  };

  const renderDecline = (group: Group, label: string) => (
    <label className={clsx(styles.card, group.current === DECLINE && styles.cardActive)}>
      <input type="radio" name={group.name} checked={group.current === DECLINE} onChange={() => group.pick(DECLINE)} />
      <span className={styles.cardName}>{label}</span>
    </label>
  );

  return <Dialog open={open} onClose={onClose} title={`Đổi quà - ${customerName}`} footer={<><Button variant="secondary" onClick={onClose}>Đóng</Button><Button onClick={confirm} disabled={!anyChange || !reasonOk || save.isPending || packages.isPending}>Xác nhận đổi quà</Button></>}>
    {detail.isPending && <p className="text-muted">Đang tải danh sách quà…</p>}
    {detail.isError && <ErrorState what="danh sách quà" onRetry={detail.refetch} retrying={detail.isFetching} />}
    {gift && <div className={styles.body}>
      {unchosen
        ? <Alert tone="warning">Khách đã nhận quà thêm, chưa chọn quà chính.</Alert>
        : <Alert tone="warning">Đổi quà chính thì app tự huỷ đơn bảo hiểm của quà cũ.</Alert>}

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>{changeableExtras.length > 0 ? "Quà chính" : "Danh sách quà"}</legend>
        {/* Món đang tặng đọc từ lượt đã chốt, không đọc danh sách bên dưới: rổ
            tính lại có thể không còn chứa nó, và lúc đó đây là chỗ duy nhất nhân
            viên thấy mình đang đổi từ món nào. */}
        <p className={styles.current}>Đang tặng: <strong>{gift.givenItem}</strong></p>
        <div className={styles.cards}>
          {gift.liveBasket.map((item, i) => renderCard(item, mainGroup, i))}
          {gift.givenCode !== GIFT_DECLINED && renderDecline(mainGroup, "Từ chối, không lấy gì")}
        </div>
      </fieldset>

      {changeableExtras.map((given) => {
        const group = extraGroupOf(given);
        return (
          <fieldset key={group.name} className={styles.group}>
            <legend className={styles.groupTitle}>Quà thêm {extraSlotLabel(given)}</legend>
            <p className={styles.current}>Đang tặng: <strong>{given.item}</strong></p>
            <div className={styles.cards}>
              {extraBasket.map((item, i) => renderCard(item, group, i))}
              {given.code !== GIFT_DECLINED && renderDecline(group, "Từ chối quà thêm")}
            </div>
          </fieldset>
        );
      })}

      {!unchosen && <TextArea label="Lý do đổi quà" required rows={3} placeholder="Khách đổi quà" value={reason} onChange={(event) => setReason(event.target.value)} />}
    </div>}
  </Dialog>;
}
