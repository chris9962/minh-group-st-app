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
  fetchCustomerDetail,
  type CustomerDetail,
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
 * Hai nhóm, quà chính và quà thêm HKD (chốt 2026-09-17). Nhóm nào không chọn
 * gì là giữ nguyên; phải đổi ít nhất một nhóm. Chỉ đổi quà thêm thì máy chủ
 * không đụng đơn bảo hiểm của quà chính.
 *
 * Cũng là đường CHỌN quà chính cho đợt mang `UNCHOSEN` (migration 0095): lúc
 * đó không đòi lý do và máy chủ không đòi trong ngày phát.
 */
export function GiftChangeDialog({ open, onClose, customerId, customerName }: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState("");
  const [selectedExtra, setSelectedExtra] = useState("");
  const [reason, setReason] = useState("");
  const [creatingOrder, setCreatingOrder] = useState(false);
  const detail = useQuery({ queryKey: ["customer", customerId], queryFn: () => fetchCustomerDetail(customerId) });
  const packages = useQuery({ queryKey: ["insurance-packages"], queryFn: fetchInsurancePackages });

  const gift = detail.data?.gift;
  const unchosen = gift?.givenCode === GIFT_UNCHOSEN;
  const reasonText = unchosen ? UNCHOSEN_REASON : reason;
  const reasonOk = reasonText.trim().length >= 2;

  // Rổ quà thêm chỉ hiện khi khách có, và khi đợt đã có câu trả lời — đợt
  // chưa có thì đi nút "Chọn quà thêm", không đòi lý do.
  const extraBasket = gift?.givenExtraCode !== null ? (gift?.liveExtraBasket ?? []) : [];
  const mainCode = selected === DECLINE ? GIFT_DECLINED : selected;
  const extraCode = selectedExtra === DECLINE ? GIFT_DECLINED : selectedExtra;
  const anyChange = selected !== "" || selectedExtra !== "";

  const save = useMutation({
    mutationFn: (newOrderIds: string[] | undefined) =>
      changeGift(customerId, {
        // Không chọn gì ở nhóm chính là giữ món đang có.
        item: mainCode || (gift?.givenCode ?? ""),
        extraItem: extraCode || undefined,
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

  const renderCard = (item: BasketItem, group: "main" | "extra", index: number) => {
    const current = group === "main" ? selected : selectedExtra;
    const pick = group === "main" ? setSelected : setSelectedExtra;
    const applied = item.code === (group === "main" ? gift?.givenCode : gift?.givenExtraCode);
    const off = applied || item.status !== "ok";
    return (
      <label key={`${group}-${item.code}-${index}`} className={clsx(styles.card, current === item.code && styles.cardActive, off && styles.cardOff)}>
        <input type="radio" name={`gift-change-${group}`} disabled={off} checked={current === item.code} onChange={() => pick(item.code)} />
        <span className={styles.cardName}>{item.name}</span>
        <span className={styles.cardKind}>{applied ? "Đang áp dụng" : item.status === "ok" ? "Chọn đổi" : "Không còn cấp"}</span>
      </label>
    );
  };

  const renderDecline = (group: "main" | "extra", label: string) => {
    const current = group === "main" ? selected : selectedExtra;
    const pick = group === "main" ? setSelected : setSelectedExtra;
    return (
      <label className={clsx(styles.card, current === DECLINE && styles.cardActive)}>
        <input type="radio" name={`gift-change-${group}`} checked={current === DECLINE} onChange={() => pick(DECLINE)} />
        <span className={styles.cardName}>{label}</span>
      </label>
    );
  };

  return <Dialog open={open} onClose={onClose} title={`Đổi quà · ${customerName}`} footer={<><Button variant="secondary" onClick={onClose}>Đóng</Button><Button onClick={confirm} disabled={!anyChange || !reasonOk || save.isPending || packages.isPending}>Xác nhận đổi quà</Button></>}>
    {detail.isPending && <p className="text-muted">Đang tải danh sách quà…</p>}
    {detail.isError && <ErrorState what="danh sách quà" onRetry={detail.refetch} retrying={detail.isFetching} />}
    {gift && <div className={styles.body}>
      {unchosen
        ? <Alert tone="warning">Khách đã nhận quà thêm trước đó, phần quà chính chưa chọn. Danh sách tính theo tài khoản hiện tại của khách.</Alert>
        : <Alert tone="warning">Danh sách quà tính theo tài khoản hiện tại của khách. Đổi quà chính thì đơn bảo hiểm quà cũ sẽ được huỷ tự động.</Alert>}

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>{extraBasket.length > 0 ? "Quà chính" : "Danh sách quà"}</legend>
        {/* Món đang tặng đọc từ lượt đã chốt, không đọc danh sách bên dưới: rổ
            tính lại có thể không còn chứa nó, và lúc đó đây là chỗ duy nhất nhân
            viên thấy mình đang đổi từ món nào. */}
        <p className={styles.current}>Đang tặng: <strong>{gift.givenItem}</strong></p>
        <div className={styles.cards}>
          {gift.liveBasket.map((item, i) => renderCard(item, "main", i))}
          {gift.givenCode !== GIFT_DECLINED && renderDecline("main", "Từ chối, không lấy gì")}
        </div>
      </fieldset>

      {extraBasket.length > 0 && (
        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Quà thêm HKD</legend>
          <p className={styles.current}>Đang tặng: <strong>{gift.givenExtraItem}</strong></p>
          <div className={styles.cards}>
            {extraBasket.map((item, i) => renderCard(item, "extra", i))}
            {gift.givenExtraCode !== GIFT_DECLINED && renderDecline("extra", "Từ chối quà thêm")}
          </div>
        </fieldset>
      )}

      {!unchosen && <TextArea label="Lý do đổi quà" required rows={3} placeholder="Khách đổi quà" value={reason} onChange={(event) => setReason(event.target.value)} />}
    </div>}
  </Dialog>;
}
