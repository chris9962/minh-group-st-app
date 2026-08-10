"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SkeletonText } from "@/components/ui/Skeleton";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { InsuranceOrderFormDialog } from "@/components/insurance/InsuranceOrderFormDialog";
import { GIFT_DECLINED, fetchCustomerDetail, markGiftGiven } from "@/lib/api/customers";
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

/**
 * P-43 · Tặng quà — bật lên từ hồ sơ khách (P-42) hoặc bảng khách hàng (P-40).
 * Khách chọn ĐÚNG 1 món trong rổ; món bảo hiểm tự mở form người thụ hưởng và
 * tạo đơn luôn, món vật phẩm đánh dấu đã tặng ngay.
 */
export function GiftGivingDialog({ open, onClose, customerId, customerName }: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string>("");
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

  const markGiven = useMutation({
    mutationFn: (item: string) => markGiftGiven(customerId, item),
    onSuccess: (_data, item) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      onClose();
      toast.ok(
        item === GIFT_DECLINED
          ? `Đã ghi nhận ${customerName} từ chối quà`
          : `Đã tặng ${item} cho ${customerName}`,
      );
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đánh dấu được quà đã tặng.")),
  });

  if (creatingOrder && data) {
    const chosen = data.gift.basket.find((b) => b.id === selected);
    return (
      <InsuranceOrderFormDialog
        open
        customer={data.customer}
        source="gift"
        prefill={{ packageName: chosen?.name ?? "" }}
        onClose={onClose}
        onCreated={() => markGiven.mutate(chosen?.name ?? "Quà tặng")}
      />
    );
  }

  const confirm = () => {
    if (!selected) return;
    // Chốt chặn thứ hai, sau nút bị vô hiệu: không biết món nào là bảo hiểm thì
    // KHÔNG được chốt. Đánh dấu nhầm là mất suất quà của khách vĩnh viễn.
    if (packagesPending || packagesError) return;
    if (selected === DECLINE) {
      markGiven.mutate(GIFT_DECLINED);
      return;
    }
    const item = data?.gift.basket.find((b) => b.id === selected);
    if (!item) return;
    if (packages.some((p) => p.id === item.id)) {
      setCreatingOrder(true);
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
          <Button
            onClick={confirm}
            disabled={!selected || markGiven.isPending || packagesPending || packagesError}
          >
            Xác nhận
          </Button>
        </>
      }
    >
      {isPending && <SkeletonText lines={3} label="Đang tải rổ quà" />}
      {/* Thiếu nhánh này thì tải hỏng ra hộp thoại RỖNG: không chữ, không nút thử lại. */}
      {isError && <ErrorState what="rổ quà của khách" onRetry={refetch} retrying={isFetching} />}
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
                      // Vẫn hiện, nhưng không chọn được: khách đủ điều kiện
                      // nhận món này, chỉ là danh mục đang ngừng cấp. Giấu đi
                      // thì nhân viên tưởng khách không được hưởng.
                      const off = item.status !== "ok";
                      return (
                        <label
                          key={`${item.code}-${i}`}
                          className={[
                            styles.card,
                            selected === item.id && styles.cardActive,
                            off && styles.cardOff,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <input
                            type="radio"
                            name="gift-choice"
                            disabled={off}
                            checked={!off && selected === item.id}
                            onChange={() => item.id && setSelected(item.id)}
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
