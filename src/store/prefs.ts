import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Tuỳ chọn hiển thị của từng màn, nhớ lại giữa các lần mở.
 *
 * Nhớ theo MÁY (localStorage), không theo tài khoản: đây là thói quen nhìn của
 * người ngồi trước máy, không phải dữ liệu nghiệp vụ — không đáng một vòng gọi
 * máy chủ, và cũng không nên theo người dùng sang máy khác.
 *
 * Gom một chỗ thay vì mỗi ô tích một store: sắp tới còn thêm nữa, mà mười file
 * store cho mười cái checkbox thì không ai tìm nổi.
 */
type Prefs = {
  /** P-91 — phòng đã ngừng ẩn mặc định, xem `departments/page.tsx`. */
  showStoppedDepartments: boolean;
  setShowStoppedDepartments: (value: boolean) => void;
  /**
   * P-13 — bảng đơn bảo hiểm bỏ bốn cột, còn Mã đơn, Khách hàng, Trạng thái.
   *
   * Dành cho người theo dõi trên điện thoại. Bảy cột không lọt màn hình, và bốn
   * cột bỏ đi là thứ người theo dõi không cần: ngày tạo đơn, người tạo, phòng,
   * người xử lý.
   */
  compactInsuranceTable: boolean;
  setCompactInsuranceTable: (value: boolean) => void;
  /**
   * P-40 — bảng khách hàng bỏ bốn cột: Ngày tạo, Số đơn BH, Kênh,
   * Người tạo - Phòng. Còn Tên khách hàng, Số tài khoản, Thao tác.
   */
  compactCustomerTable: boolean;
  setCompactCustomerTable: (value: boolean) => void;
};

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      showStoppedDepartments: false,
      setShowStoppedDepartments: (showStoppedDepartments) => set({ showStoppedDepartments }),
      compactInsuranceTable: false,
      setCompactInsuranceTable: (compactInsuranceTable) => set({ compactInsuranceTable }),
      compactCustomerTable: false,
      setCompactCustomerTable: (compactCustomerTable) => set({ compactCustomerTable }),
    }),
    { name: 'mgst-prefs' },
  ),
);
