import { hasPhrase, isoDate, pickField, splitLines, type FieldSpec } from "../text";

/**
 * TPBank — màn "Mở Tài Khoản Thành Công".
 *
 * Nhãn TPBank cố định ở mọi ảnh, đo trên 6 ảnh 2026-09-11 gồm screenshot
 * iPhone, Android và ảnh chụp màn hình bằng máy khác:
 *
 *   Tên đăng nhập:            0374949991
 *   Số tài khoản thanh toán:  1000 5465 402
 *   Hạn mức GD:               (bỏ, không dùng để kiểm)
 *   Email:                    (bỏ, xuống hai dòng trên iPhone, không dùng để kiểm)
 *   Hiệu lực từ:              11/09/2026
 *   Mã giới thiệu:            AT108
 */
export type TpbOpenSuccess = {
  /** Có dòng "Mở Tài Khoản Thành Công". */
  success: boolean;
  /** Tên đăng nhập, TPBank dùng số điện thoại. */
  username: string;
  /** Số tài khoản thanh toán, đã bỏ khoảng trắng. */
  accountNumber: string;
  /** Hiệu lực từ, YYYY-MM-DD. */
  effectiveFrom: string;
  /** Mã giới thiệu, viết hoa. */
  referralCode: string;
  /** Trường không tìm thấy trong ảnh. */
  missing: (keyof Omit<TpbOpenSuccess, "missing">)[];
};

const FIELDS: Record<Exclude<keyof TpbOpenSuccess, "success" | "missing">, FieldSpec> = {
  username: { labels: ["TENDANGNHAP", "DANGNHAP"], value: /0\d{9}/ },
  accountNumber: {
    labels: ["SOTAIKHOANTHANHTOAN", "THANHTOAN"],
    value: /\d[\d ]{6,}\d/,
    clean: (v) => v.replace(/\s/g, ""),
  },
  effectiveFrom: {
    labels: ["HIEULUCTU", "HIEU"],
    value: /\d{2}\/\d{2}\/\d{4}/,
    clean: isoDate,
  },
  // Mã đứng cuối dòng, sau nhãn.
  referralCode: {
    labels: ["MAGIOITHIEU", "THIEU"],
    value: /[A-Za-z0-9]{3,12}\s*$/,
    clean: (v) => v.trim().toUpperCase(),
  },
};

export function parseTpbOpenSuccess(ocrText: string): TpbOpenSuccess {
  const lines = splitLines(ocrText);

  const out: TpbOpenSuccess = {
    // Nhận cả khi OCR rớt chữ "MỞ": hai cụm còn lại đủ nói đây là màn này.
    success:
      hasPhrase(lines, "MOTAIKHOANTHANHCONG") ||
      lines.some((l) => hasPhrase([l], "TAIKHOAN") && hasPhrase([l], "THANHCONG")),
    username: pickField(lines, FIELDS.username),
    accountNumber: pickField(lines, FIELDS.accountNumber),
    effectiveFrom: pickField(lines, FIELDS.effectiveFrom),
    referralCode: pickField(lines, FIELDS.referralCode),
    missing: [],
  };

  if (!out.success) out.missing.push("success");
  for (const key of Object.keys(FIELDS) as (keyof typeof FIELDS)[]) {
    if (!out[key]) out.missing.push(key);
  }
  return out;
}
