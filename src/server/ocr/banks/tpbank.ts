import type { PhotoCheckItem } from "@/lib/api/photoCheck";
import { compact, hasLabel, hasPhrase, isoDate, pickField, splitLines, stripAccents, type FieldSpec } from "../text";

/* ── Màn "Mở Tài Khoản Thành Công" ────────────────────────────────────── */

/**
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

const OPEN_FIELDS: Record<Exclude<keyof TpbOpenSuccess, "success" | "missing">, FieldSpec> = {
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
    username: pickField(lines, OPEN_FIELDS.username),
    accountNumber: pickField(lines, OPEN_FIELDS.accountNumber),
    effectiveFrom: pickField(lines, OPEN_FIELDS.effectiveFrom),
    referralCode: pickField(lines, OPEN_FIELDS.referralCode),
    missing: [],
  };

  if (!out.success) out.missing.push("success");
  for (const key of Object.keys(OPEN_FIELDS) as (keyof typeof OPEN_FIELDS)[]) {
    if (!out[key]) out.missing.push(key);
  }
  return out;
}

/* ── Màn hình chính sau đăng nhập ─────────────────────────────────────── */

/**
 * Đầu màn hình chính, chữ trắng trên nền tím, đo trên 10 ảnh 2026-09-11:
 *
 *   Xin chào
 *   HUYNH THI NGA                     tên in hoa không dấu, OCR hay tự thêm dấu
 *   1000 5477 058   034 360 1521      số tài khoản 4-4-3, số điện thoại 3-3-4
 *   2,000 VND                         (bỏ, không dùng để kiểm)
 *
 * Không có nhãn cho tên: tên là dòng NGAY SAU "Xin chào", kèm rác OCR hai đầu
 * (`^Ấ ToNVANPHUC Ao 4`). Số tài khoản và số điện thoại cũng không nhãn, nhận
 * bằng hình dạng số.
 */
export type TpbHome = {
  /** Có dòng "Xin chào". */
  greeted: boolean;
  /** Tên khách in hoa không dấu, có thể mất khoảng trắng giữa các từ. */
  customerName: string;
  /** Số tài khoản 11 số, đã bỏ khoảng trắng. */
  accountNumber: string;
  /** Số điện thoại 10 số, đã bỏ khoảng trắng. */
  phone: string;
  missing: (keyof Omit<TpbHome, "missing">)[];
};

/**
 * Nhặt tên ra khỏi dòng có rác: giữ các từ toàn chữ cái, dài từ 2 ký tự, và
 * in hoa ít nhất 3/4 số chữ. `ToNVANPHUC` giữ, `Ao` và `Ba` bỏ, `Q` bỏ. Lấy
 * chuỗi từ liên tiếp dài nhất.
 */
function nameIn(line: string): string {
  const tokens = stripAccents(line).replace(/[^A-Za-z]+/g, " ").trim().split(" ");
  let best: string[] = [];
  let cur: string[] = [];
  for (const t of tokens) {
    const upper = t.replace(/[^A-Z]/g, "").length;
    if (t.length >= 2 && upper * 4 >= t.length * 3) cur.push(t.toUpperCase());
    else {
      if (cur.length > best.length) best = cur;
      cur = [];
    }
  }
  if (cur.length > best.length) best = cur;
  return best.join(" ");
}

// Ranh giới là "không phải chữ số", không dùng `\b`: OCR hay dính `_` hay
// chữ vào đuôi số (`862_`), mà `_` là ký tự từ nên `\b` không khớp.
const ACCOUNT = /(?<!\d)\d{4} ?\d{4} ?\d{3}(?!\d)/;
const PHONE = /(?<!\d)0\d{2} ?\d{3} ?\d{4}(?!\d)/;

export function parseTpbHome(ocrText: string): TpbHome {
  const lines = splitLines(ocrText);

  let customerName = "";
  for (let i = 0; i < lines.length && !customerName; i++) {
    if (!hasLabel(lines[i], "XINCHAO")) continue;
    // Tên có thể dính cùng dòng "Xin chào" hoặc nằm dòng kế.
    const same = nameIn(lines[i].replace(/xin\s*ch[aà]o/i, ""));
    customerName = same.length >= 4 ? same : (nameIn(lines[i + 1] ?? ""));
  }

  const digits = (re: RegExp): string => {
    for (const l of lines) {
      const m = stripAccents(l).match(re);
      if (m) return m[0].replace(/\s/g, "");
    }
    return "";
  };

  const out: TpbHome = {
    greeted: lines.some((l) => hasLabel(l, "XINCHAO")),
    customerName,
    accountNumber: digits(ACCOUNT),
    phone: digits(PHONE),
    missing: [],
  };
  for (const key of ["greeted", "customerName", "accountNumber", "phone"] as const) {
    if (!out[key]) out.missing.push(key);
  }
  return out;
}

/**
 * Tên OCR có khớp tên trong hệ thống không.
 *
 * So sau khi bỏ dấu, bỏ khoảng trắng, viết hoa: OCR hay mất khoảng trắng
 * giữa các từ và tự thêm dấu. Chấp nhận sai 1 ký tự mỗi 8 ký tự.
 */
export function nameMatches(ocrName: string, expected: string): boolean {
  const a = compact(ocrName);
  const b = compact(expected);
  if (!a || !b) return false;
  if (a.includes(b)) return true;
  const tolerance = Math.max(1, Math.floor(b.length / 8));
  for (let i = 0; i + b.length <= a.length; i++) {
    let diff = 0;
    for (let j = 0; j < b.length && diff <= tolerance; j++) if (a[i + j] !== b[j]) diff++;
    if (diff <= tolerance) return true;
  }
  return false;
}

/* ── Màn "Chuyển thành công" ──────────────────────────────────────────── */

/**
 * Màn kết quả chuyển khoản, đo trên 7 ảnh 2026-09-11, iPhone và Android:
 *
 *   TPBank                              logo, OCR đọc ra chữ
 *   Chuyển thành công!
 *   52,000 VND
 *   HO HOANG DAC                        người nhận (bỏ)
 *   MB BANK  0907 8386 71               ngân hàng nhận (bỏ)
 *   Lời nhắn: ...                       (bỏ, không dùng để kiểm)
 *   Chuyển nhanh 247: 19:04 11/09/2026
 */
export type TpbTransfer = {
  /** Có chữ "TPBank" trên màn. */
  bank: boolean;
  /** Có dòng "Chuyển thành công". */
  success: boolean;
  /**
   * Số tiền ĐÚNG NHƯ OCR ĐỌC, ví dụ `52,000 VND`. Rỗng khi không thấy.
   *
   * Không đổi sang số: nền màn TPBank có hoa văn sóng sát chữ số, Tesseract
   * đọc nét cong đó thành `9` và ra `952,000` cho ảnh in `52,000` (4/7 ảnh
   * Android 2026-09-11, ngưỡng trắng đen không sửa được ổn định). Phép kiểm
   * chỉ cần "có số tiền", con số để người duyệt tự đối chiếu với ảnh.
   */
  amountText: string;
  /** Giờ chuyển, `YYYY-MM-DD HH:mm`, rỗng khi không thấy. */
  transferredAt: string;
  missing: ("bank" | "success" | "amountText")[];
};

const AMOUNT = /\d[\d,.]*\s*VND/i;
const TRANSFERRED_AT = /(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})/;

export function parseTpbTransfer(ocrText: string): TpbTransfer {
  const lines = splitLines(ocrText);

  let amountText = "";
  let transferredAt = "";
  for (const raw of lines) {
    const l = stripAccents(raw);
    if (!amountText) {
      const m = l.match(AMOUNT);
      if (m) amountText = m[0].replace(/\s+/g, " ").toUpperCase();
    }
    if (!transferredAt) {
      const m = l.match(TRANSFERRED_AT);
      if (m) transferredAt = `${m[5]}-${m[4]}-${m[3]} ${m[1]}:${m[2]}`;
    }
  }

  const out: TpbTransfer = {
    bank: hasPhrase(lines, "TPBANK"),
    success: hasPhrase(lines, "CHUYENTHANHCONG"),
    amountText,
    transferredAt,
    missing: [],
  };
  if (!out.bank) out.missing.push("bank");
  if (!out.success) out.missing.push("success");
  if (!out.amountText) out.missing.push("amountText");
  return out;
}

/* ── Ba phép kiểm cho một tài khoản ───────────────────────────────────── */

export type TpbCheckContext = {
  /** `referral_codes.code` của mã đã chọn. `''` = mã QR-only, không so được. */
  referralCode: string;
  /** `customers.full_name`. */
  customerName: string;
  /** `bank_accounts.account_number` nhân viên nhập lúc hoàn thành. `''` = chưa có. */
  accountNumber: string;
};

/**
 * Mã giới thiệu so sau khi bỏ dấu, viết hoa, và gộp ký tự dễ nhầm: `O`/`0`,
 * `I`/`1`, `S`/`5`, `B`/`8`, `Z`/`2`. Không cho sai ký tự: `AT105` và `AT106`
 * là hai mã của hai người, sai một ký tự là sai người.
 */
const codeKey = (s: string) =>
  compact(s).replace(/O/g, "0").replace(/I/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");

const digitsOf = (s: string) => s.replace(/\D/g, "");

/**
 * Chạy cả ba parser trên mọi ảnh, mỗi phép kiểm lấy ảnh nhận ra rõ nhất.
 *
 * Không có nhãn "ảnh này là màn gì": nhân viên nộp 3 ảnh `opening` không theo
 * thứ tự. Màn nào có dấu hiệu riêng: mở tài khoản có `success`, màn hình chính
 * có `greeted`, chuyển khoản có `bank` và `success`. Một ảnh khớp nhiều màn
 * thì ưu tiên màn thiếu ít trường nhất.
 */
export function checkTpbank(texts: string[], ctx: TpbCheckContext): PhotoCheckItem[] {
  const opens = texts.map(parseTpbOpenSuccess).filter((r) => r.success);
  const homes = texts.map(parseTpbHome).filter((r) => r.greeted);
  const transfers = texts.map(parseTpbTransfer).filter((r) => r.bank && r.success);
  const best = <T extends { missing: unknown[] }>(rs: T[]) =>
    rs.sort((a, b) => a.missing.length - b.missing.length)[0];

  const open = best(opens);
  const home = best(homes);
  const transfer = best(transfers);
  const items: PhotoCheckItem[] = [];

  // 1. Mở tài khoản: mã giới thiệu, và số tài khoản khớp số nhân viên nhập.
  if (!open) {
    items.push({ key: "open", verdict: "missing", found: "", expected: ctx.referralCode, note: "Không ảnh nào là màn mở tài khoản thành công." });
  } else {
    const notes: string[] = [];
    if (!open.referralCode) notes.push("Không đọc được mã giới thiệu.");
    else if (ctx.referralCode && codeKey(open.referralCode) !== codeKey(ctx.referralCode))
      notes.push(`Mã trên ảnh ${open.referralCode}, mã đã chọn ${ctx.referralCode}.`);
    if (open.accountNumber && ctx.accountNumber && digitsOf(open.accountNumber) !== digitsOf(ctx.accountNumber))
      notes.push(`Số tài khoản trên ảnh ${open.accountNumber}, đã nhập ${ctx.accountNumber}.`);
    items.push({
      key: "open",
      verdict: notes.length ? "fail" : "pass",
      found: [open.referralCode, open.accountNumber].filter(Boolean).join(" - "),
      expected: [ctx.referralCode, ctx.accountNumber].filter(Boolean).join(" - "),
      note: notes.join(" "),
    });
  }

  // 2. Màn hình chính: tên khách, và số tài khoản khớp số đã nhập.
  if (!home) {
    items.push({ key: "home", verdict: "missing", found: "", expected: ctx.customerName, note: "Không ảnh nào là màn hình chính app." });
  } else {
    const notes: string[] = [];
    if (!home.customerName) notes.push("Không đọc được tên khách.");
    else if (!nameMatches(home.customerName, ctx.customerName))
      notes.push(`Tên trên ảnh ${home.customerName}, tên khách ${ctx.customerName}.`);
    if (home.accountNumber && ctx.accountNumber && home.accountNumber !== digitsOf(ctx.accountNumber))
      notes.push(`Số tài khoản trên ảnh ${home.accountNumber}, đã nhập ${ctx.accountNumber}.`);
    items.push({
      key: "home",
      verdict: notes.length ? "fail" : "pass",
      found: [home.customerName, home.accountNumber].filter(Boolean).join(" - "),
      expected: [ctx.customerName, ctx.accountNumber].filter(Boolean).join(" - "),
      note: notes.join(" "),
    });
  }

  // 3. Chuyển khoản: có TPBank, có "thành công", có số tiền.
  if (!transfer) {
    items.push({ key: "transfer", verdict: "missing", found: "", expected: "", note: "Không ảnh nào là màn chuyển khoản thành công." });
  } else {
    items.push({
      key: "transfer",
      verdict: transfer.amountText ? "pass" : "fail",
      found: [transfer.amountText, transfer.transferredAt].filter(Boolean).join(" - "),
      expected: "",
      note: transfer.amountText ? "" : "Không đọc được số tiền.",
    });
  }

  return items;
}
