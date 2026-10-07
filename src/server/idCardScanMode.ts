import type { IdCardScanSetting } from "@/lib/api/ops";
import type { User } from "@/lib/types";
import { logAudit } from "./audit";

/**
 * Công tắc chụp CCCD khi tạo khách (chốt 2026-10-08), giữ trong bộ nhớ của
 * tiến trình app như `pviRouteMode`. Khởi tạo từ `ID_CARD_SCAN` (`off` là tắt,
 * thiếu hay giá trị khác là bật); màn Vận hành P-99 đổi được lúc app đang chạy.
 * Khởi động lại hoặc deploy thì quay về `ID_CARD_SCAN`: muốn tắt hẳn qua các lần
 * deploy thì đặt `ID_CARD_SCAN=off` trong `.env.local` của máy chủ.
 *
 * Tắt thì form tạo khách bỏ bước chụp thẻ, người dùng gõ tay CCCD, họ tên, ngày
 * sinh như trước 2026-10-07, máy chủ không đòi ảnh. Khoá sửa ba trường đó của
 * vai Nhân viên ở hồ sơ đã có vẫn giữ.
 *
 * Đặt trên `globalThis` cùng lý do với `pviRouteMode`: mỗi bundle route có thể
 * mang bản module riêng.
 */

const store = globalThis as unknown as { mgstIdCardScan?: IdCardScanSetting };

function current(): IdCardScanSetting {
  store.mgstIdCardScan ??= {
    enabled: (process.env.ID_CARD_SCAN ?? "").trim() !== "off",
    updatedAt: "",
    updatedBy: "",
  };
  return store.mgstIdCardScan;
}

export const idCardScanEnabled = (): boolean => current().enabled;

export const idCardScanSetting = (): IdCardScanSetting => ({ ...current() });

const label = (enabled: boolean) => (enabled ? "Bật" : "Tắt");

export async function saveIdCardScan(actor: User, enabled: boolean): Promise<void> {
  const before = current().enabled;
  store.mgstIdCardScan = { enabled, updatedAt: new Date().toISOString(), updatedBy: actor.fullName };

  await logAudit(actor, {
    module: "customer",
    action: "update",
    targetLabel: `Chụp CCCD khi tạo khách: ${label(before)} → ${label(enabled)}`,
  });
}
