"use client";

import { clsx } from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { GIFT_DECLINED, chooseExtraGift, fetchCustomerDetail } from "@/lib/api/customers";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./GiftGivingDialog.module.scss";

const DECLINE = "__decline__";

type Props = { open: boolean; onClose: () => void; customerId: string; customerName: string };

/**
 * Chọn quà thêm HKD cho đợt ĐÃ chốt mà chưa có quà thêm — đợt phát trước
 * 2026-09-17, lúc Loa và Bảng mica còn nằm chung rổ với gói bảo hiểm.
 *
 * Danh sách lấy rổ quà thêm TÍNH THEO TÀI KHOẢN HIỆN TẠI: snapshot của đợt cũ không
 * có rổ quà thêm. Ghi đúng một lần, không có đường đổi.
 */
export function GiftExtraDialog({ open, onClose, customerId, customerName }: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState("");
  const detail = useQuery({ queryKey: ["customer", customerId], queryFn: () => fetchCustomerDetail(customerId) });
  const save = useMutation({
    mutationFn: () => chooseExtraGift(customerId, selected === DECLINE ? GIFT_DECLINED : selected),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      toast.ok(`Đã ghi quà thêm cho ${customerName}`);
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không ghi được quà thêm.")),
  });

  const extraBasket = detail.data?.gift.liveExtraBasket ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Chọn quà thêm · ${customerName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          <Button onClick={() => save.mutate()} disabled={!selected || save.isPending}>
            Xác nhận
          </Button>
        </>
      }
    >
      {detail.isPending && <p className="text-muted">Đang tải rổ quà thêm…</p>}
      {detail.isError && <ErrorState what="rổ quà thêm" onRetry={detail.refetch} retrying={detail.isFetching} />}
      {detail.data && (
        <div className={styles.body}>
          <p className={styles.current}>
            Quà chính: <strong>{detail.data.gift.givenItem}</strong>
          </p>
          <p className={styles.hint}>
            Khách có HKD nên được thêm <strong>đúng 1</strong> món dưới đây, cộng với quà chính:
          </p>
          <div className={styles.cards}>
            {extraBasket.map((item, i) => {
              const off = item.status !== "ok";
              return (
                <label
                  key={`${item.code}-${i}`}
                  className={clsx(styles.card, selected === item.code && styles.cardActive, off && styles.cardOff)}
                >
                  <input
                    type="radio"
                    name="gift-extra"
                    disabled={off}
                    checked={!off && selected === item.code}
                    onChange={() => setSelected(item.code)}
                  />
                  <span className={styles.cardName}>{item.name}</span>
                  <span className={styles.cardKind}>
                    {off ? (item.status === "discontinued" ? "Đã ngưng cấp" : "Không còn trong danh mục") : "Vật phẩm"}
                  </span>
                </label>
              );
            })}
            <label className={clsx(styles.card, selected === DECLINE && styles.cardActive)}>
              <input
                type="radio"
                name="gift-extra"
                checked={selected === DECLINE}
                onChange={() => setSelected(DECLINE)}
              />
              <span className={styles.cardName}>Từ chối quà thêm</span>
            </label>
          </div>
        </div>
      )}
    </Dialog>
  );
}
