import { capitalizePersonName } from './api/personName';

/**
 * Tách chuỗi QR trên mặt trước thẻ CCCD gắn chip — hàm thuần, chạy được ở cả
 * trình duyệt lẫn máy chủ.
 *
 * Chuỗi không mã hoá, 7 phần cách nhau bằng `|`:
 *
 *   1 số CCCD (12 số) · 2 số CMND cũ (9 số, có thể rỗng) · 3 họ tên có dấu ·
 *   4 ngày sinh `ddmmyyyy` · 5 giới tính `Nam`/`Nữ` · 6 nơi thường trú ·
 *   7 ngày cấp `ddmmyyyy`
 *
 * Chỉ lấy ba phần 1, 3, 4. Phần 6 KHÔNG dùng: địa chỉ của hệ thống chọn từ
 * danh mục ấp/xã, không nhận chuỗi tự do.
 *
 * Trình duyệt đọc để điền sẵn ba ô; máy chủ đọc lại từ ảnh gửi lên và ghi đè,
 * nên giá trị người dùng thấy và giá trị lưu đi qua cùng một hàm.
 */

export type IdCardQr =
  | { ok: true; idNumber: string; fullName: string; dob: string }
  | { ok: false; message: string };

export const ID_CARD_QR_UNREADABLE = 'Không đọc được thông tin từ ảnh.';

/** Viền giữ thêm quanh ô vuông QR khi cắt ảnh, theo tỉ lệ cạnh ô: QR lệch ra mép ô một chút vẫn còn đủ. */
export const ID_CARD_CROP_MARGIN = 0.1;

const NOT_ID_CARD = ID_CARD_QR_UNREADABLE;

/** `ddmmyyyy` → `yyyy-mm-dd`. */
const isoDateOf = (ddmmyyyy: string): string =>
  `${ddmmyyyy.slice(4, 8)}-${ddmmyyyy.slice(2, 4)}-${ddmmyyyy.slice(0, 2)}`;

// Đọc ra là nhận, không kiểm số CCCD, ngày sinh, giới tính (chốt 2026-10-09):
// có thẻ thật mang số lệch năm sinh mà app từ chối.
export function parseIdCardQr(text: string): IdCardQr {
  const [idNumber, , rawName, rawDob] = text.split('|').map((p) => p.trim());
  if (!idNumber || !rawName || !rawDob) return { ok: false, message: NOT_ID_CARD };

  return { ok: true, idNumber, fullName: capitalizePersonName(rawName), dob: isoDateOf(rawDob) };
}
