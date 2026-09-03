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

  // Gửi MÃ món lên máy chủ (#74), nhưng toast phải nói TÊN — người dùng không
  // đọc `BH-1N-XEMAY`. Nên mutation nhận cả hai.
  const markGiven = useMutation({
    mutationFn: ({ code, orderIds = [] }: { code: string; label: string; orderIds?: string[] }) =>
      markGiftGiven(customerId, code, orderIds),
    onSuccess: (_data, { code, label }) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      onClose();
      toast.ok(
        code === GIFT_DECLINED
          ? `Đã ghi nhận ${customerName} từ chối quà`
          : `Đã tặng ${label} cho ${customerName}`,
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
      ? (data?.gift.basket.find((b) => b.id === selected)?.cashIfChosen ??
        data?.gift.cashTotal ??
        0)
      : (data?.gift.cashTotal ?? 0);

  const confirm = () => {
    if (!selected) return;
    // Chốt chặn thứ hai, sau nút bị vô hiệu: không biết món nào là bảo hiểm thì
    // KHÔNG được chốt. Đánh dấu nhầm là mất suất quà của khách vĩnh viễn.
    if (packagesPending || packagesError) return;
    if (selected === DECLINE) {
      markGiven.mutate({ code: GIFT_DECLINED, label: "" });
      return;
    }
    const item = data?.gift.basket.find((b) => b.id === selected);
    if (!item) return;
    if (packages.some((p) => p.id === item.id)) {
      setCreatingOrder(true);
    } else {
      markGiven.mutate({ code: item.code, label: item.name });
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
              Khách này đã được tặng quà rồi — mỗi khách chỉ tặng đúng một lần.
            </Alert>
          ) : (
            <>
              {/*
                Số tiền đổi theo món đang chọn: chưa đủ tổ hợp mà lấy Mì hoặc
                Nón là mất 20k của VPa, lấy Loa hay Bảng mica thì giữ. Con số
                từng món do luật trả về (`cashIfChosen`), giao diện không tự
                biết món nào chặn tiền.

                Chưa chọn gì và "Từ chối" đều dùng `cashTotal` — từ chối quà
                không làm mất tiền.
              */}
              <p className={styles.cash}>
                Tiền mặt tự động: <strong>{formatVnd(cashOfChoice)}</strong>
              </p>

              {data.gift.basket.length === 0 ? (
                <p className="text-muted">Khách chưa đủ điều kiện nhận quà.</p>
              ) : (
                <>
                  <p className={styles.hint}>
                    Chọn <strong>đúng 1</strong> món dưới đây:
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
                          className={clsx(
                            styles.card,
                            selected === item.id && styles.cardActive,
                            off && styles.cardOff,
                          )}
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
                      className={clsx(styles.card, selected === DECLINE && styles.cardActive)}
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
