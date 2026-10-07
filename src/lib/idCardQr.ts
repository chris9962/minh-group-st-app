import { capitalizePersonName, personNameHasLetter } from './api/personName';
import { MIN_BIRTH_YEAR, isRealIsoDate } from './types';

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

export const ID_CARD_QR_UNREADABLE =
  'Không đọc được mã QR trên thẻ. Chụp lại cho rõ, QR ở góc trên bên phải mặt trước.';

const NOT_ID_CARD = 'Mã QR trong ảnh không phải QR của thẻ CCCD gắn chip.';

/** `ddmmyyyy` → `yyyy-mm-dd`, hoặc `''` khi không phải ngày có thật. */
const isoDateOf = (ddmmyyyy: string): string => {
  if (!/^\d{8}$/.test(ddmmyyyy)) return '';
  const iso = `${ddmmyyyy.slice(4, 8)}-${ddmmyyyy.slice(2, 4)}-${ddmmyyyy.slice(0, 2)}`;
  return isRealIsoDate(iso) ? iso : '';
};

/**
 * Số thứ 4 của CCCD mã hoá giới tính và thế kỷ sinh: chẵn là nam, lẻ là nữ;
 * 0-1 sinh 19xx, 2-3 sinh 20xx, 4-5 sinh 21xx. Số thứ 5 và 6 là hai số cuối
 * năm sinh. Lệch với phần 4 và 5 của QR thì đây không phải thẻ thật hoặc QR bị
 * đọc sai một ký tự.
 */
const matchesIdNumber = (idNumber: string, dob: string, gender: string): boolean => {
  const code = Number(idNumber[3]);
  if (code > 5) return false;
  const century = 19 + Math.floor(code / 2);
  const male = code % 2 === 0;
  const year = dob.slice(0, 4);
  if (year !== `${century}${idNumber.slice(4, 6)}`) return false;
  const genderKey = gender.trim().toLowerCase();
  return male ? genderKey === 'nam' : genderKey === 'nữ';
};

export function parseIdCardQr(text: string): IdCardQr {
  const parts = text.split('|').map((p) => p.trim());
  if (parts.length !== 7) return { ok: false, message: NOT_ID_CARD };

  const [idNumber, , rawName, rawDob, gender] = parts;
  if (!/^\d{12}$/.test(idNumber)) return { ok: false, message: NOT_ID_CARD };
  if (!personNameHasLetter(rawName)) return { ok: false, message: NOT_ID_CARD };

  const dob = isoDateOf(rawDob);
  const year = Number(dob.slice(0, 4));
  if (!dob || year < MIN_BIRTH_YEAR || year > new Date().getFullYear())
    return { ok: false, message: 'Ngày sinh trên QR không hợp lệ. Chụp lại mặt trước thẻ.' };

  if (!matchesIdNumber(idNumber, dob, gender))
    return {
      ok: false,
      message: 'Số CCCD không khớp giới tính và năm sinh trên thẻ. Chụp lại mặt trước thẻ.',
    };

  return { ok: true, idNumber, fullName: capitalizePersonName(rawName), dob };
}
