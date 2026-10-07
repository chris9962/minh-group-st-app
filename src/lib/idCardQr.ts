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

export const ID_CARD_QR_UNREADABLE = 'Không đọc được thông tin từ ảnh.';

/** Viền giữ thêm quanh khung thẻ khi cắt ảnh, theo tỉ lệ cạnh khung: thẻ lệch một chút vẫn còn đủ QR. */
export const ID_CARD_CROP_MARGIN = 0.05;

/**
 * Ô chứa QR trong ảnh thẻ đã cắt (gồm cả viền `ID_CARD_CROP_MARGIN`), theo phần
 * của ảnh. Hai mẫu thẻ đều in QR ở góc trên phải, đo trên ảnh thật 2026-10-07:
 * CCCD gắn chip mặt trước QR ở x 0,77-0,91, y 0,09-0,28 của ảnh cắt; thẻ căn
 * cước mẫu mới mặt sau ở x 0,72-0,92, y 0,08-0,40.
 *
 * Trình duyệt quét ô này trên video, máy chủ đọc lại ô này trên ảnh gửi lên.
 * Đọc cả ảnh thẻ thì zxing hay không tìm ra QR giữa nền hoa văn của thẻ.
 */
export const ID_CARD_QR_REGION = { x: 0.62, y: 0, w: 0.38, h: 0.55 };

const NOT_ID_CARD = ID_CARD_QR_UNREADABLE;

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
  // Thẻ căn cước mẫu mới (cấp từ 2024-07-01) thêm 4 phần rỗng sau ngày cấp.
  if (parts.length < 7) return { ok: false, message: NOT_ID_CARD };

  const [idNumber, , rawName, rawDob, gender] = parts;
  if (!/^\d{12}$/.test(idNumber)) return { ok: false, message: NOT_ID_CARD };
  if (!personNameHasLetter(rawName)) return { ok: false, message: NOT_ID_CARD };

  const dob = isoDateOf(rawDob);
  const year = Number(dob.slice(0, 4));
  if (!dob || year < MIN_BIRTH_YEAR || year > new Date().getFullYear())
    return { ok: false, message: 'Ngày sinh trên QR không hợp lệ. Chụp lại.' };

  if (!matchesIdNumber(idNumber, dob, gender))
    return {
      ok: false,
      message: 'Số CCCD không khớp giới tính và năm sinh. Chụp lại.',
    };

  return { ok: true, idNumber, fullName: capitalizePersonName(rawName), dob };
}
