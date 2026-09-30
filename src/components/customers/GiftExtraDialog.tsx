"use client";

import { clsx } from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  GIFT_DECLINED,
  chooseExtraGift,
  extraSlotKey,
  extraSlotLabel,
  fetchCustomerDetail,
  pendingExtraSlots,
} from "@/lib/api/customers";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./GiftGivingDialog.module.scss";

const DECLINE = "__decline__";

type Props = { open: boolean; onClose: () => void; customerId: string; customerName: string };

/**
 * Chọn quà thêm HKD cho dòng HKD CHƯA có câu trả lời trong đợt đã chốt: đợt
 * phát trước 2026-09-17, hoặc khách mở thêm HKD sau lượt phát (mỗi tài khoản
 * HKD một món, chốt 2026-09-30).
 *
 * Danh sách lấy suất và rổ quà thêm TÍNH THEO TÀI KHOẢN HIỆN TẠI: snapshot của
 * đợt cũ không có rổ quà thêm. Đổi món đã chọn đi hộp thoại Đổi quà.
 */
export function GiftExtraDialog({ open, onClose, customerId, customerName }: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const detail = useQuery({ queryKey: ["customer", customerId], queryFn: () => fetchCustomerDetail(customerId) });

  const gift = detail.data?.gift;
  const extraBasket = gift?.liveExtraBasket ?? [];
  const pending = pendingExtraSlots(gift);
  const extras = pending.map((slot) => {
    const picked = selected[extraSlotKey(slot)] ?? "";
    return { bankAccountId: slot.bankAccountId, item: picked === DECLINE ? GIFT_DECLINED : picked };
  });
  const ready = pending.length > 0 && extras.every((e) => e.item !== "");

  const save = useMutation({
    mutationFn: () => chooseExtraGift(customerId, extras),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      toast.ok(`Đã ghi quà thêm cho ${customerName}`);
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không ghi được quà thêm.")),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Chọn quà thêm - ${customerName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          <Button onClick={() => save.mutate()} disabled={!ready || save.isPending}>
            Xác nhận
          </Button>
        </>
      }
    >
      {detail.isPending && <p className="text-muted">Đang tải rổ quà thêm…</p>}
      {detail.isError && <ErrorState what="rổ quà thêm" onRetry={detail.refetch} retrying={detail.isFetching} />}
      {gift && (
        <div className={styles.body}>
          <p className={styles.current}>
            Quà chính: <strong>{gift.givenItem}</strong>
          </p>
          {pending.map((slot) => {
            const key = extraSlotKey(slot);
            const current = selected[key] ?? "";
            const pick = (code: string) => setSelected((prev) => ({ ...prev, [key]: code }));
            const name = `gift-extra-${key}`;
            return (
              <fieldset key={key} className={styles.group}>
                <legend className={styles.groupTitle}>Quà thêm {extraSlotLabel(slot)}</legend>
                <p className={styles.hint}>
                  Chọn <strong>đúng 1</strong> món dưới đây, cộng với quà chính:
                </p>
                <div className={styles.cards}>
                  {extraBasket.map((item, i) => {
                    const off = item.status !== "ok";
                    return (
                      <label
                        key={`${item.code}-${i}`}
                        className={clsx(styles.card, current === item.code && styles.cardActive, off && styles.cardOff)}
                      >
                        <input
                          type="radio"
                          name={name}
                          disabled={off}
                          checked={!off && current === item.code}
                          onChange={() => pick(item.code)}
                        />
                        <span className={styles.cardName}>{item.name}</span>
                        <span className={styles.cardKind}>
                          {off ? (item.status === "discontinued" ? "Đã ngưng cấp" : "Không còn trong danh mục") : "Vật phẩm"}
                        </span>
                      </label>
                    );
                  })}
                  <label className={clsx(styles.card, current === DECLINE && styles.cardActive)}>
                    <input type="radio" name={name} checked={current === DECLINE} onChange={() => pick(DECLINE)} />
                    <span className={styles.cardName}>Từ chối quà thêm</span>
                  </label>
                </div>
              </fieldset>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
