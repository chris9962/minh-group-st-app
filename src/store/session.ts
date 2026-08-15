import { create } from "zustand";
import { persist } from "zustand/middleware";
import { User } from "@/lib/types";

/**
 * Phiên đăng nhập.
 *
 * Thời hạn: mặc định 1 tháng; tích "ghi nhớ đăng nhập" thì 1 năm.
 * Bản mock giữ ở localStorage. Khi có backend, đổi sang cookie httpOnly —
 * chỉ sửa file này, component không đụng tới.
 */

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export const sessionExpiry = (remember: boolean): number =>
  Date.now() + (remember ? ONE_YEAR_MS : ONE_MONTH_MS);

type SessionState = {
  user: User | null;
  expiresAt: number | null;
  /**
   * `persist` đọc xong localStorage chưa.
   *
   * Trước mốc đó `user` LUÔN null, kể cả khi phiên còn hạn — ai đọc `user` để
   * quyết định chuyển hướng phải đợi cờ này, không thì tải lại trang nào cũng
   * bị coi như chưa đăng nhập.
   */
  hydrated: boolean;
  login: (user: User, remember: boolean) => void;
  logout: () => void;
  isValid: () => boolean;
  markHydrated: () => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      user: null,
      expiresAt: null,
      hydrated: false,

      login: (user, remember) =>
        set({ user, expiresAt: sessionExpiry(remember) }),

      logout: () => set({ user: null, expiresAt: null }),

      markHydrated: () => set({ hydrated: true }),

      isValid: () => {
        const { user, expiresAt } = get();
        return Boolean(user && expiresAt && expiresAt > Date.now());
      },
    }),
    {
      name: "mgst-session",

      /**
       * Bật cờ kể cả khi đọc hỏng (`state` vẫn là bản mặc định): treo cờ ở
       * `false` thì khung app không bao giờ dựng và người dùng nhận màn trắng.
       */
      onRehydrateStorage: () => (state) => state?.markHydrated(),

      /**
       * Phiên cũ phải khớp schema hiện tại, nếu không thì bỏ.
       *
       * Đổi cấu trúc User mà không kiểm ở đây thì người đang đăng nhập mắc kẹt
       * với dữ liệu cũ: giao diện hiện sai, mà cũng không quay lại trang đăng
       * nhập được vì phiên vẫn còn hạn.
       */
      merge: (persisted, current) => {
        const saved = persisted as Partial<SessionState> | undefined;
        const parsed = User.safeParse(saved?.user);
        if (!parsed.success) return current;
        return {
          ...current,
          user: parsed.data,
          expiresAt: saved?.expiresAt ?? null,
        };
      },
    },
  ),
);
