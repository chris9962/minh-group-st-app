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
import { GIFT_DECLINED, changeGift, fetchCustomerDetail } from "@/lib/api/customers";
import { fetchInsurancePackages } from "@/lib/api/settings";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./GiftGivingDialog.module.scss";

const DECLINE = "__decline__";

type Props = { open: boolean; onClose: () => void; customerId: string; customerName: string };

/** Đổi món trong rổ quà đã chốt; đơn bảo hiểm cũ được server xử lý cùng lượt. */
export function GiftChangeDialog({ open, onClose, customerId, customerName }: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState("");
  const [reason, setReason] = useState("");
  const [creatingOrder, setCreatingOrder] = useState(false);
  const detail = useQuery({ queryKey: ["customer", customerId], queryFn: () => fetchCustomerDetail(customerId) });
  const packages = useQuery({ queryKey: ["insurance-packages"], queryFn: fetchInsurancePackages });
  const save = useMutation({
    mutationFn: (newOrderIds: string[] | undefined) =>
      changeGift(customerId, { item: selected === DECLINE ? GIFT_DECLINED : selected, reason, newOrderIds: newOrderIds ?? [] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      toast.ok(`Đã đổi quà cho ${customerName}`);
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đổi được quà.")),
  });

  const chosen = detail.data?.gift.basket.find((item) => item.code === selected);
  if (creatingOrder && detail.data && chosen) {
    return <InsuranceOrderFormDialog open customer={detail.data.customer} source="gift" prefill={{ packageName: chosen.name }} onClose={() => setCreatingOrder(false)} onCreated={(orders) => save.mutate(orders.map((o) => o.id))} />;
  }
  const confirm = () => {
    if (!selected || reason.trim().length < 2) return;
    if (selected !== DECLINE && packages.data?.some((p) => p.id === chosen?.id)) setCreatingOrder(true);
    else save.mutate([]);
  };

  return <Dialog open={open} onClose={onClose} title={`Đổi quà · ${customerName}`} footer={<><Button variant="secondary" onClick={onClose}>Đóng</Button><Button onClick={confirm} disabled={!selected || reason.trim().length < 2 || save.isPending || packages.isPending}>Xác nhận đổi quà</Button></>}>
    {detail.isPending && <p className="text-muted">Đang tải danh sách quà ban đầu…</p>}
    {detail.isError && <ErrorState what="danh sách quà ban đầu" onRetry={detail.refetch} retrying={detail.isFetching} />}
    {detail.data && <div className={styles.body}>
      <Alert tone="warning">Chỉ chọn được món trong danh sách quà lúc khách được tặng. Đơn bảo hiểm quà cũ sẽ được xử lý tự động.</Alert>
      <div className={styles.cards}>{detail.data.gift.basket.map((item, i) => <label key={`${item.code}-${i}`} className={clsx(styles.card, selected === item.code && styles.cardActive, item.code === detail.data.gift.givenCode && styles.cardOff)}><input type="radio" name="gift-change" disabled={item.code === detail.data.gift.givenCode || item.status !== "ok"} checked={selected === item.code} onChange={() => setSelected(item.code)} /><span className={styles.cardName}>{item.name}</span><span className={styles.cardKind}>{item.code === detail.data.gift.givenCode ? "Đang áp dụng" : item.status === "ok" ? "Chọn đổi" : "Không còn cấp"}</span></label>)}</div>
      {detail.data.gift.givenCode !== GIFT_DECLINED && <label className={clsx(styles.card, selected === DECLINE && styles.cardActive)}><input type="radio" name="gift-change" checked={selected === DECLINE} onChange={() => setSelected(DECLINE)} /><span className={styles.cardName}>Từ chối, không lấy gì</span></label>}
      <TextArea label="Lý do đổi quà" required rows={3} placeholder="Khách đổi quà" value={reason} onChange={(event) => setReason(event.target.value)} />
    </div>}
  </Dialog>;
}
