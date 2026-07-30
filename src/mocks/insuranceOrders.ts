import type { InsuranceOrder, InsuranceOrderForm } from "@/lib/api/insuranceOrders";
import type { Customer } from "@/lib/api/customers";

/**
 * Kho đơn bảo hiểm THẬT tạo qua hộp thoại (tự mua hoặc từ quà tặng), khác với
 * đơn giả lập sinh cho P-51/P-52. `customers.ts` gộp cả hai để P-42 thấy đơn
 * mới ngay sau khi lưu.
 */

let orders: InsuranceOrder[] = [];
let nextId = 1;

export const manualOrdersFor = (customerName: string): InsuranceOrder[] =>
  orders.filter((o) => o.customerName === customerName);

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
  actorDepartmentId: string | null,
): InsuranceOrder[] {
  const packageNames = packagesToCreate(form.product, form.packageName);

  return packageNames.map((packageName, i) => {
    const order: InsuranceOrder = {
      id: `mi-${nextId++}`,
      customerId: customer.id,
      customerName: customer.fullName,
      date: i === 0 ? form.date : oneYearLater(form.date),
      product: form.product,
      packageName,
      // Đơn tự tạo ở đây luôn "đang chạy" — chưa có luồng ký/duyệt riêng.
      status: "running",
      source: form.source,
      beneficiaryName: form.beneficiaryName,
      createdByDepartmentId: actorDepartmentId,
    };
    orders = [...orders, order];
    return order;
  });
}
