/**
 * Đường máy nào xử lý một đơn bảo hiểm — cột `insurance_orders.pvi_route`.
 *
 * Module riêng và nhỏ vì cả ba nơi đều cần: hàm tạo đơn, worker API, và route
 * callback. Để trong `insurance.ts` thì worker phải nạp cả tầng nghiệp vụ đơn.
 */

/** `''` là đơn làm tay, và mọi đơn có trước migration 0071. */
export type PviRoute = "" | "bot" | "api";

/** Kênh `NOTIFY` báo có đơn mới cho worker API. Xem `pviNotifyNewOrder`. */
export const PVI_NEW_ORDER_CHANNEL = "pvi_don_moi";
