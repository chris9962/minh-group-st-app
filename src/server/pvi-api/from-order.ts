import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { customerPhones, customers, insuranceOrders } from "../db/schema";
import { ElectricOrderInput } from "./electric";
import { MotorbikeOrderInput } from "./motorbike";

/**
 * Dựng payload PVI từ một dòng `insurance_orders`.
 *
 * Tách khỏi worker để đọc đối chiếu với `docs/pvi-field-tao-don-*.md` bằng mắt,
 * và để chạy thử một đơn mà không phải bật cả vòng lặp.
 *
 * ⚠️ ĐỌC CẢ HỒ SƠ KHÁCH, không chỉ cột của đơn. Số điện thoại thì đơn không có
 * cột nào, nó nằm ở bảng `customer_phones`.
 *
 * KHÔNG gửi CCCD lên PVI (chốt 2026-09-07). Đo cùng ngày: PVI khớp `-556 Chủ hộ
 * đã tham gia` theo CCCD, và nhận đơn có CCCD rỗng. Gửi CCCD của hồ sơ khách là
 * tự chặn đơn cấp lại cho khách cũ mà không được gì.
 */

/** Đơn cộng phần hồ sơ khách mà PVI cần. */
export type OrderForPvi = {
  id: string;
  orderCode: string;
  product: string;
  fee: number;
  startDate: string;
  endDate: string;
  beneficiaryName: string;
  beneficiaryDob: string | null;
  beneficiaryAddress: string;
  householdSize: number;
  sumInsured: number;
  licensePlate: string;
  vehicleType: string;
  chassisNumber: string;
  engineNumber: string;
  pviAttempts: number;
  customerName: string;
  customerDob: string | null;
  customerAddress: string;
  customerPhone: string | null;
};

/** Các cột chọn ra, dùng chung cho câu lấy đơn và câu đọc lại một đơn. */
export const orderForPviColumns = {
  id: insuranceOrders.id,
  orderCode: insuranceOrders.orderCode,
  product: insuranceOrders.product,
  fee: insuranceOrders.fee,
  startDate: insuranceOrders.startDate,
  endDate: insuranceOrders.endDate,
  beneficiaryName: insuranceOrders.beneficiaryName,
  beneficiaryDob: insuranceOrders.beneficiaryDob,
  beneficiaryAddress: insuranceOrders.beneficiaryAddress,
  householdSize: insuranceOrders.householdSize,
  sumInsured: insuranceOrders.sumInsured,
  licensePlate: insuranceOrders.licensePlate,
  vehicleType: insuranceOrders.vehicleType,
  chassisNumber: insuranceOrders.chassisNumber,
  engineNumber: insuranceOrders.engineNumber,
  pviAttempts: insuranceOrders.pviAttempts,
  customerName: customers.fullName,
  customerDob: customers.dob,
  customerAddress: customers.address,
  /**
   * Số điện thoại chính của khách.
   *
   * Câu con chạy cho ĐÚNG số dòng của trang, không phải cả bảng — cùng lối
   * `decorate()` của `listCustomers` (AGENTS.md §5.2).
   */
  customerPhone: sql<string | null>`(
    select p.number from ${customerPhones} p
     where p.customer_id = ${customers.id}
     order by p.is_primary desc
     limit 1
  )`.as("customer_phone"),
};

/** Đọc lại một đơn kèm hồ sơ khách. Dùng khi worker cần dữ liệu sau lúc khoá dòng. */
export async function orderForPvi(id: string): Promise<OrderForPvi | null> {
  const [row] = await db
    .select(orderForPviColumns)
    .from(insuranceOrders)
    .innerJoin(customers, eq(customers.id, insuranceOrders.customerId))
    .where(eq(insuranceOrders.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Ngày bắt đầu gửi lên PVI.
 *
 * PVI từ chối ngày bắt đầu nhỏ hơn ngày hiện tại: `-505` với xe máy, `-401` với
 * tai nạn điện. Đơn nằm trong hàng chờ qua đêm là rơi vào đó, nên dịch mốc bắt
 * đầu lên ngày chạy. Mốc kết thúc giữ nguyên: hợp đồng ngắn đi vài giờ còn hơn
 * đơn không tạo được.
 */
export function startDateFor(order: { startDate: string }, now = new Date()): string {
  const today = now.toISOString().slice(0, 10);
  return order.startDate < today ? today : order.startDate;
}

const nonEmpty = (...values: (string | null | undefined)[]): string => {
  for (const v of values) if (v && v.trim()) return v.trim();
  return "";
};

export function motorbikeInputFor(order: OrderForPvi, now = new Date()) {
  return MotorbikeOrderInput.parse({
    maGiaoDich: order.orderCode,
    tenChuXe: nonEmpty(order.beneficiaryName, order.customerName),
    diaChi: nonEmpty(order.beneficiaryAddress, order.customerAddress),
    soDienThoai: order.customerPhone ?? "",
    bienKiemSoat: order.licensePlate,
    soMay: order.engineNumber,
    soKhung: order.chassisNumber,
    loaiXe: order.vehicleType,
    ngayBatDau: startDateFor(order, now),
    ngayKetThuc: order.endDate,
  });
}

export function electricInputFor(order: OrderForPvi, now = new Date()) {
  return ElectricOrderInput.parse({
    maGiaoDich: order.orderCode,
    khachHang: nonEmpty(order.beneficiaryName, order.customerName),
    ngaySinh: nonEmpty(order.beneficiaryDob, order.customerDob),
    diaChi: nonEmpty(order.beneficiaryAddress, order.customerAddress),
    soDienThoai: order.customerPhone ?? "",
    ngayBatDau: startDateFor(order, now),
    ngayKetThuc: order.endDate,
    soTienBh: order.sumInsured,
    tongPhi: order.fee,
    soNguoiHoKhau: order.householdSize,
  });
}
