"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { InsuranceOrderFormDialog } from "@/components/insurance/InsuranceOrderFormDialog";
import { fetchCustomerDetail, markGiftGiven } from "@/lib/api/customers";
import { fetchInsurancePackages } from "@/lib/api/settings";
import { formatVnd } from "@/lib/format";
import { useSession } from "@/store/session";
import styles from "./GiftGivingDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  customerId: string;
  customerName: string;
};

const DECLINE = "__decline__";

/**
 * BH tai nạn điện 2 năm và món ghép ("A + B") tách thành nhiều đơn/nhiều
 * bước tạo đơn — tầng tạo đơn (`insuranceOrders.ts`) đã lo việc tách 2 năm,
 * ở đây chỉ cần tách các sản phẩm GHÉP bằng dấu "+".
 */
function parseInsuranceItem(name: string): { product: string; packageName: string }[] {
  return name.split("+").map((part) => {
    const trimmed = part.trim();
    const product = trimmed.includes("xe máy") ? "BH xe máy" : "BH tai nạn điện";
    return { product, packageName: trimmed };
  });
}

/**
 * P-43 · Tặng quà — bật lên từ hồ sơ khách (P-42) hoặc bảng khách hàng (P-40).
 * Khách chọn ĐÚNG 1 món trong rổ; món bảo hiểm tự mở form người thụ hưởng và
 * tạo đơn luôn, món vật phẩm đánh dấu đã tặng ngay.
 */
export function GiftGivingDialog({ open, onClose, customerId, customerName }: Props) {
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string>("");
  const [pendingOrders, setPendingOrders] = useState<
    { product: string; packageName: string }[] | null
  >(null);

  const { data, isPending } = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => fetchCustomerDetail(customerId, actor?.id ?? ""),
  });
  const { data: packages = [] } = useQuery({
    queryKey: ["insurance-packages"],
    queryFn: fetchInsurancePackages,
  });

  const markGiven = useMutation({
    mutationFn: (item: string) => markGiftGiven(customerId, item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      onClose();
    },
  });

  if (pendingOrders && pendingOrders.length > 0 && data) {
    return (
      <InsuranceOrderFormDialog
        open
        customer={data.customer}
        source="gift"
        prefill={pendingOrders[0]}
        onClose={onClose}
        onCreated={() => {
          const rest = pendingOrders.slice(1);
          if (rest.length === 0) {
            const chosen = data.gift.basket.find((b) => b.id === selected);
            markGiven.mutate(chosen?.name ?? "Quà tặng");
          } else {
            setPendingOrders(rest);
          }
        }}
      />
    );
  }

  const confirm = () => {
    if (!selected) return;
    if (selected === DECLINE) {
      markGiven.mutate("Từ chối nhận quà");
      return;
    }
    const item = data?.gift.basket.find((b) => b.id === selected);
    if (!item) return;
    if (packages.some((p) => p.id === item.id)) {
      setPendingOrders(parseInsuranceItem(item.name));
    } else {
      markGiven.mutate(item.name);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Tặng quà · ${customerName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={confirm} disabled={!selected || markGiven.isPending}>
            Xác nhận
          </Button>
        </>
      }
    >
      {isPending && <p className="text-muted">Đang tải rổ quà…</p>}

      {data && (
        <div className={styles.body}>
          {data.gift.given ? (
            <Alert tone="warning">
              Khách này đã được tặng quà rồi — mỗi khách chỉ tặng đúng một lần.
            </Alert>
          ) : (
            <>
              <p className={styles.cash}>
                Tiền mặt tự động: <strong>{formatVnd(data.gift.cashTotal)}</strong>
              </p>

              {data.gift.basket.length === 0 ? (
                <p className="text-muted">Khách chưa đủ điều kiện nhận quà.</p>
              ) : (
                <>
                  <p className={styles.hint}>
                    Chọn <strong>đúng 1</strong> món dưới đây — rổ trộn giá trị rất khác
                    nhau, đọc kỹ trước khi chọn:
                  </p>
                  <div className={styles.cards}>
                    {data.gift.basket.map((item, i) => {
                      const isInsurance = packages.some((p) => p.id === item.id);
                      return (
                        <label
                          key={`${item.id}-${i}`}
                          className={[styles.card, selected === item.id && styles.cardActive]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <input
                            type="radio"
                            name="gift-choice"
                            checked={selected === item.id}
                            onChange={() => setSelected(item.id)}
                          />
                          <span className={styles.cardName}>{item.name}</span>
                          <span className={styles.cardKind}>
                            {isInsurance ? "Bảo hiểm" : "Vật phẩm"}
                          </span>
                        </label>
                      );
                    })}
                    <label
                      className={[styles.card, selected === DECLINE && styles.cardActive]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <input
                        type="radio"
                        name="gift-choice"
                        checked={selected === DECLINE}
                        onChange={() => setSelected(DECLINE)}
                      />
                      <span className={styles.cardName}>Từ chối, không lấy gì</span>
                    </label>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
