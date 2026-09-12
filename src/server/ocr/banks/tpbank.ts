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

const OPEN_FIELDS: Record<Exclude<keyof TpbOpenSuccess, "success" | "missing" | "referralCode">, FieldSpec> = {
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
};

/**
 * Mã giới thiệu: cụm chữ số ngay SAU chữ "thiệu", vì OCR hay dính rác vào đuôi
 * dòng (`Mã giới thiệu AT107 " \``) nên không lấy "cụm cuối dòng" được.
 *
 * Nhãn ngắn là `OITHIEU` chứ không phải `THIEU`: rác đầu dòng ghép với chữ
 * kế thành `NHIEU` ở dòng `Ñ Hiệu lực từ 11/09/2026`, sai 1 ký tự so với
 * `THIEU` nên bị nhận nhầm và mã đọc ra `2026` (đo 2026-09-12).
 */
function referralCodeIn(lines: string[]): string {
  for (const label of ["MAGIOITHIEU", "OITHIEU"]) {
    for (const line of lines) {
      if (!hasLabel(line, label)) continue;
      const plain = stripAccents(line);
      const after = plain.match(/thieu[^A-Za-z0-9]*([A-Za-z0-9]{3,12})/i);
      if (after) return after[1].toUpperCase();
      const last = plain.match(/([A-Za-z0-9]{3,12})[^A-Za-z0-9]*$/);
      if (last) return last[1].toUpperCase();
    }
  }
  return "";
}

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
    referralCode: referralCodeIn(lines),
    missing: [],
  };

  if (!out.success) out.missing.push("success");
  for (const key of [...(Object.keys(OPEN_FIELDS) as (keyof typeof OPEN_FIELDS)[]), "referralCode"] as const) {
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
 * in hoa ít nhất 3/4 số chữ; từ 2 chữ thì chỉ cần chữ đầu in hoa vì OCR hay
 * đọc `TO` thành `Tô`. `ToNVANPHUC` giữ, `Ba` giữ, `ao` bỏ, `Q` bỏ. Lấy chuỗi
 * từ liên tiếp dài nhất.
 */
function nameIn(line: string): string {
  const tokens = stripAccents(line).replace(/[^A-Za-z]+/g, " ").trim().split(" ");
  let best: string[] = [];
  let cur: string[] = [];
  for (const t of tokens) {
    const upper = t.replace(/[^A-Z]/g, "").length;
    const keep = t.length === 2 ? /^[A-Z]/.test(t) : t.length >= 3 && upper * 4 >= t.length * 3;
    if (keep) cur.push(t.toUpperCase());
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

/** Dòng "số tài khoản  số điện thoại" ngay dưới tên trên màn hình chính. */
const isAccountLine = (l: string) => ACCOUNT.test(stripAccents(l)) && PHONE.test(stripAccents(l));

/** Tên có ít nhất 4 chữ cái; ngắn hơn là rác OCR như `TY`. */
const usableName = (s: string) => compact(s).length >= 4;

export function parseTpbHome(ocrText: string): TpbHome {
  const lines = splitLines(ocrText);
  const greetedAt = lines.findIndex((l) => hasLabel(l, "XINCHAO"));
  const accountAt = lines.findIndex(isAccountLine);

  /**
   * Tên có thể dính cùng dòng "Xin chào", hoặc nằm 1 tới 2 dòng dưới: OCR hay
   * chen một dòng rác giữa hai dòng đó (`lê 2 TỶ = @`). Ảnh bị cắt mất "Xin
   * chào" thì lấy dòng ngay trên dòng số tài khoản.
   */
  let customerName = "";
  for (let i = 0; i < lines.length && !customerName; i++) {
    if (!hasLabel(lines[i], "XINCHAO")) continue;
    for (const candidate of [
      nameIn(lines[i].replace(/xin\s*ch[aà]o/i, "")),
      nameIn(lines[i + 1] ?? ""),
      nameIn(lines[i + 2] ?? ""),
    ]) {
      if (usableName(candidate)) {
        customerName = candidate;
        break;
      }
    }
  }
  if (!customerName && accountAt > 0) {
    const above = nameIn(lines[accountAt - 1]);
    if (usableName(above)) customerName = above;
  }

  const digits = (re: RegExp): string => {
    for (const l of lines) {
      const m = stripAccents(l).match(re);
      if (m) return m[0].replace(/\s/g, "");
    }
    return "";
  };

  const out: TpbHome = {
    // Hai dấu hiệu: dòng "Xin chào", hoặc dòng số tài khoản đi cùng số điện
    // thoại. Ảnh chụp cắt mất mép trên vẫn còn dấu hiệu thứ hai.
    greeted: greetedAt >= 0 || accountAt >= 0,
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
 * Màn kết quả chuyển khoản, HAI biến thể (đo 2026-09-11 và 2026-09-12).
 *
 * Biến thể 1, ngay sau khi chuyển:
 *
 *   TPBank                              logo, OCR đọc ra chữ
 *   Chuyển thành công!
 *   52,000 VND
 *   HO HOANG DAC                        người nhận (bỏ)
 *   MB BANK  0907 8386 71               ngân hàng nhận (bỏ)
 *   Lời nhắn: ...                       (bỏ, không dùng để kiểm)
 *   Chuyển nhanh 247: 19:04 11/09/2026
 *
 * Biến thể 2, mở lại từ lịch sử giao dịch:
 *
 *   Chi Tiết Giao Dịch
 *   Giao dịch thành công
 *   -50,000 VND
 *   Từ tài khoản
 *   LE QUANG VINH                       người gửi = khách, so được với hệ thống
 *   1000 5477 068                       số tài khoản người gửi
 *   Tới tài khoản ...
 *   Thời gian thực hiện: 19:08 11/09/2026
 *
 * Biến thể 2 KHÔNG có chữ TPBank, chỉ có logo. Nhận ra bằng bố cục riêng của
 * app TPBank: tiêu đề "Chi Tiết Giao Dịch" cộng nhãn "Từ tài khoản".
 */
export type TpbTransfer = {
  /** Có chữ "TPBank", hoặc bố cục "Chi Tiết Giao Dịch" + "Từ tài khoản" của app TPBank. */
  bank: boolean;
  /** Có dòng "Chuyển thành công" hoặc "Giao dịch thành công". */
  success: boolean;
  /** Tên người gửi, chỉ biến thể 2. In hoa không dấu, có thể mất khoảng trắng. */
  fromName: string;
  /** Số tài khoản người gửi, chỉ biến thể 2, đã bỏ khoảng trắng. */
  fromAccount: string;
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

  // Biến thể 2: tên và số tài khoản người gửi nằm 1 tới 3 dòng dưới nhãn
  // "Từ tài khoản". Dừng ở nhãn "Tới tài khoản" để không lấy nhầm người nhận.
  let fromName = "";
  let fromAccount = "";
  const fromAt = lines.findIndex((l) => hasLabel(l, "TUTAIKHOAN"));
  if (fromAt >= 0) {
    for (let i = fromAt + 1; i < Math.min(lines.length, fromAt + 4); i++) {
      if (hasLabel(lines[i], "TOITAIKHOAN")) break;
      const plain = stripAccents(lines[i]);
      const acct = plain.match(ACCOUNT);
      if (acct && !fromAccount) fromAccount = acct[0].replace(/\s/g, "");
      else if (!fromName) {
        const name = nameIn(plain);
        if (usableName(name)) fromName = name;
      }
    }
  }

  const detailLayout = hasPhrase(lines, "CHITIETGIAODICH") && fromAt >= 0;

  const out: TpbTransfer = {
    bank: hasPhrase(lines, "TPBANK") || detailLayout,
    success: hasPhrase(lines, "CHUYENTHANHCONG") || hasPhrase(lines, "GIAODICHTHANHCONG"),
    fromName,
    fromAccount,
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
 * Hai dãy số cùng độ dài, khác nhau tối đa MỘT chữ số. Dùng cho số tài khoản
 * trên màn hình chính: chữ trắng nền tím, Tesseract đọc `1000` thành `4000`
 * (đo 2026-09-12). Số của người khác lệch nhiều hơn một chữ số, và số nhân
 * viên gõ sai đã bị màn mở tài khoản bắt bằng phép so đúng từng chữ số.
 */
function digitsClose(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length && diff <= 1; i++) if (a[i] !== b[i]) diff++;
  return diff <= 1;
}

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
    items.push({
      key: "open",
      verdict: "missing",
      label: "Mã giới thiệu và số tài khoản",
      issues: ["Thiếu ảnh xác thực mã giới thiệu và số tài khoản"],
      found: "",
      expected: ctx.referralCode,
      note: "Không ảnh nào là màn mở tài khoản thành công.",
    });
  } else {
    const notes: string[] = [];
    const issues: string[] = [];
    if (!open.referralCode) {
      notes.push("Không đọc được mã giới thiệu.");
      issues.push("Không đọc được mã giới thiệu");
    } else if (ctx.referralCode && codeKey(open.referralCode) !== codeKey(ctx.referralCode)) {
      notes.push(`Mã trên ảnh ${open.referralCode}, mã đã chọn ${ctx.referralCode}.`);
      issues.push("Mã giới thiệu không khớp");
    }
    if (
      open.accountNumber &&
      ctx.accountNumber &&
      digitsOf(open.accountNumber) !== digitsOf(ctx.accountNumber)
    ) {
      notes.push(`Số tài khoản trên ảnh ${open.accountNumber}, đã nhập ${ctx.accountNumber}.`);
      issues.push("Số tài khoản không khớp");
    }
    items.push({
      key: "open",
      verdict: notes.length ? "fail" : "pass",
      label: "Mã giới thiệu và số tài khoản",
      issues,
      found: [open.referralCode, open.accountNumber].filter(Boolean).join(" - "),
      expected: [ctx.referralCode, ctx.accountNumber].filter(Boolean).join(" - "),
      note: notes.join(" "),
    });
  }

  // 2. Màn hình chính: tên khách, và số tài khoản khớp số đã nhập.
  if (!home) {
    items.push({
      key: "home",
      verdict: "missing",
      label: "Tên khách hàng và số tài khoản",
      issues: ["Thiếu ảnh xác thực tên khách hàng và số tài khoản"],
      found: "",
      expected: ctx.customerName,
      note: "Không ảnh nào là màn hình chính app.",
    });
  } else {
    const notes: string[] = [];
    const issues: string[] = [];
    if (!home.customerName) {
      notes.push("Không đọc được tên khách.");
      issues.push("Không đọc được tên khách hàng");
    } else if (!nameMatches(home.customerName, ctx.customerName)) {
      notes.push(`Tên trên ảnh ${home.customerName}, tên khách ${ctx.customerName}.`);
      issues.push("Tên khách hàng không khớp");
    }
    if (
      home.accountNumber &&
      ctx.accountNumber &&
      !digitsClose(home.accountNumber, digitsOf(ctx.accountNumber))
    ) {
      notes.push(`Số tài khoản trên ảnh ${home.accountNumber}, đã nhập ${ctx.accountNumber}.`);
      issues.push("Số tài khoản không khớp");
    }
    items.push({
      key: "home",
      verdict: notes.length ? "fail" : "pass",
      label: "Tên khách hàng và số tài khoản",
      issues,
      found: [home.customerName, home.accountNumber].filter(Boolean).join(" - "),
      expected: [ctx.customerName, ctx.accountNumber].filter(Boolean).join(" - "),
      note: notes.join(" "),
    });
  }

  // 3. Chuyển khoản: có TPBank, có "thành công", có số tiền. Biến thể 2 in
  // thêm người gửi, có thì so với khách và số đã nhập.
  if (!transfer) {
    items.push({
      key: "transfer",
      verdict: "missing",
      label: "Giao dịch thành công",
      issues: ["Thiếu ảnh giao dịch thành công"],
      found: "",
      expected: "",
      note: "Không ảnh nào là màn chuyển khoản thành công.",
    });
  } else {
    const notes: string[] = [];
    const issues: string[] = [];
    if (!transfer.amountText) {
      notes.push("Không đọc được số tiền.");
      issues.push("Không đọc được số tiền giao dịch");
    }
    if (transfer.fromName && !nameMatches(transfer.fromName, ctx.customerName)) {
      notes.push(`Người gửi trên ảnh ${transfer.fromName}, tên khách ${ctx.customerName}.`);
      issues.push("Tên người gửi không khớp");
    }
    if (
      transfer.fromAccount &&
      ctx.accountNumber &&
      !digitsClose(transfer.fromAccount, digitsOf(ctx.accountNumber))
    ) {
      notes.push(`Tài khoản gửi trên ảnh ${transfer.fromAccount}, đã nhập ${ctx.accountNumber}.`);
      issues.push("Tài khoản gửi không khớp");
    }
    items.push({
      key: "transfer",
      verdict: notes.length ? "fail" : "pass",
      label: "Giao dịch thành công",
      issues,
      found: [transfer.amountText, transfer.transferredAt, transfer.fromName, transfer.fromAccount]
        .filter(Boolean)
        .join(" - "),
      expected:
        transfer.fromName || transfer.fromAccount
          ? [ctx.customerName, ctx.accountNumber].filter(Boolean).join(" - ")
          : "",
      note: notes.join(" "),
    });
  }

  return items;
}
