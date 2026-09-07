import type { InsuranceProduct } from "@/lib/types";
import { pviPost, type PviOrderResult } from "./client";
import { buildElectricPayload } from "./electric";
import { electricInputFor, motorbikeInputFor, type OrderForPvi } from "./from-order";
import { buildMotorbikePayload } from "./motorbike";

/**
 * Một đơn đã dựng xong payload, chỉ còn gửi.
 *
 * Tách `prepare` khỏi `send` để nơi gọi biết PVI đã có thể ghi đơn hay chưa:
 * lỗi lúc dựng (zod, `pviPeriod`) chắc chắn chưa có lệnh gọi nào, còn lỗi ở
 * `send()` thì không chắc. Hai loại lỗi đi hai đường khác nhau ở worker.
 */
export type PreparedPviOrder = {
  endpoint: string;
  send: () => Promise<PviOrderResult>;
};

/**
 * Bảng sản phẩm → API PVI (chốt 2026-09-07).
 *
 * Thêm sản phẩm là thêm một dòng. Thiếu dòng thì `Record<InsuranceProduct, …>`
 * báo lỗi lúc build, không âm thầm rơi vào nhánh `else` như ternary
 * `product === "motorbike" ? … : …` trước đó.
 */
export const PVI_PRODUCTS: Record<
  InsuranceProduct,
  (order: OrderForPvi, now: Date) => PreparedPviOrder
> = {
  motorbike: (order, now) => {
    const payload = buildMotorbikePayload(motorbikeInputFor(order, now), now);
    return { endpoint: "TaoDon_XeMay", send: () => pviPost("TaoDon_XeMay", payload) };
  },
  "electric-accident": (order, now) => {
    const payload = buildElectricPayload(electricInputFor(order, now), now);
    return { endpoint: "TaoDon_HSDD_CP", send: () => pviPost("TaoDon_HSDD_CP", payload) };
  },
};

export const preparePviOrder = (order: OrderForPvi, now = new Date()): PreparedPviOrder =>
  PVI_PRODUCTS[order.product](order, now);
