import type {
  InsuranceOrder,
  InsuranceOrderForm,
  InsuranceOrderStatus,
} from "@/lib/api/insuranceOrders";
import type { Customer } from "@/lib/api/customers";

/**
 * Kho đơn bảo hiểm THẬT tạo qua hộp thoại (tự mua hoặc từ quà tặng), khác với
 * đơn giả lập sinh cho P-51/P-52. `customers.ts` gộp cả hai để P-42 thấy đơn
 * mới ngay sau khi lưu.
 */

let orders: InsuranceOrder[] = [];
let nextId = 1;
let nextOrderCodeSeq = 1;

export const manualOrdersFor = (customerName: string): InsuranceOrder[] =>
  orders.filter((o) => o.customerName === customerName);

/** Toàn bộ đơn thật, không lọc theo khách — dùng cho P-13 (gộp cả công ty). */
export const allManualOrders = (): InsuranceOrder[] => orders;

/** DH-YYMM-NNN (spec P-12) — YYMM theo lúc tạo, số thứ tự tăng dần toàn hệ thống. */
function nextOrderCode(date: string): string {
  const yymm = date.slice(2, 4) + date.slice(5, 7);
  return `DH-${yymm}-${String(nextOrderCodeSeq++).padStart(3, "0")}`;
}

const oneYearLater = (date: string): string => {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * BH tai nạn điện gói 2 năm sinh ra HAI đơn 1 năm nối ngày (spec §4.4 P-43,
 * §5.4) — hãng chỉ phát hành hợp đồng 1 năm, "2 năm" là hai hợp đồng liên
 * tiếp. Áp dụng bất kể mua tự nguyện hay từ quà tặng, nên đặt ở tầng tạo đơn
 * dùng chung, không phải riêng luồng quà.
 */
function packagesToCreate(product: string, packageName: string): string[] {
  if (product === "BH tai nạn điện" && packageName.trim().startsWith("2 năm")) {
    const fee = packageName.match(/(\d+k)/)?.[1] ?? "100k";
    return [`1 năm · ${fee}`, `1 năm · ${fee}`];
  }
  return [packageName];
}

export function createInsuranceOrder(
  form: InsuranceOrderForm,
  customer: Customer,
  actor: { id: string; fullName: string; departmentId: string | null } | null,
): InsuranceOrder[] {
  const packageNames = packagesToCreate(form.product, form.packageName);

  return packageNames.map((packageName, i) => {
    const date = i === 0 ? form.date : oneYearLater(form.date);
    const order: InsuranceOrder = {
      id: `mi-${nextId++}`,
      orderCode: nextOrderCode(date),
      customerId: customer.id,
      customerName: customer.fullName,
      date,
      product: form.product,
      packageName,
      // Đơn mới luôn bắt đầu ở "chờ tạo" — phải được hệ thống pick lên mới
      // chuyển sang "đang tạo", không nhảy thẳng vào đó (spec §3.4 mốc 01).
      status: "queued",
      source: form.source,
      beneficiaryName: form.beneficiaryName,
      beneficiaryDob: form.beneficiaryDob,
      beneficiaryIdNumber: form.beneficiaryIdNumber,
      beneficiaryPhone: form.beneficiaryPhone,
      createdById: actor?.id ?? null,
      createdByName: actor?.fullName ?? null,
      createdByDepartmentId: actor?.departmentId ?? null,
      certificatePhotoUrl: null,
    };
    orders = [...orders, order];
    return order;
  });
}

/**
 * Hai bước chuyển tay duy nhất người dùng được bấm (P-16): nhận đơn từ hàng
 * chờ, rồi đánh dấu hoàn thành. Đường chính (chờ tạo → đang tạo → chờ duyệt →
 * hoàn thành) và lỗi đẩy qua chờ làm tay là việc của hệ thống, không phải nút
 * bấm — chặn ở đây để không ai gọi API nhảy cóc sang trạng thái khác.
 */
const ALLOWED_TRANSITIONS: Partial<Record<InsuranceOrderStatus, InsuranceOrderStatus>> = {
  "manual-queued": "manual-progress",
  "manual-progress": "done",
};

export function setOrderStatus(id: string, next: InsuranceOrderStatus): InsuranceOrder | null {
  const current = orders.find((o) => o.id === id);
  if (!current) return null;
  if (ALLOWED_TRANSITIONS[current.status] !== next) return null;

  const updated = { ...current, status: next };
  orders = orders.map((o) => (o.id === id ? updated : o));
  return updated;
}

/** Đính/thay ảnh chứng nhận — cho phép ở bất kỳ trạng thái nào (P-14). */
export function setOrderPhoto(id: string, photoUrl: string): InsuranceOrder | null {
  const current = orders.find((o) => o.id === id);
  if (!current) return null;

  const updated = { ...current, certificatePhotoUrl: photoUrl };
  orders = orders.map((o) => (o.id === id ? updated : o));
  return updated;
}
