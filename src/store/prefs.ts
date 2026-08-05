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
};

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      showStoppedDepartments: false,
      setShowStoppedDepartments: (showStoppedDepartments) => set({ showStoppedDepartments }),
    }),
    { name: 'mgst-prefs' },
  ),
);
