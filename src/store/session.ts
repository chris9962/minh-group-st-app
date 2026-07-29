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
  login: (user: User, remember: boolean) => void;
  logout: () => void;
  isValid: () => boolean;
};

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      user: null,
      expiresAt: null,

      login: (user, remember) =>
        set({ user, expiresAt: sessionExpiry(remember) }),

      logout: () => set({ user: null, expiresAt: null }),

      isValid: () => {
        const { user, expiresAt } = get();
        return Boolean(user && expiresAt && expiresAt > Date.now());
      },
    }),
    {
      name: "mgst-session",

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
