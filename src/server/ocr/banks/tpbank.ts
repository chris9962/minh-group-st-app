import { compact, hasLabel, hasPhrase, isoDate, pickField, splitLines, stripAccents, type FieldSpec } from "../text";
import { DEFAULT_PROFILE, ocrImage, TPB_HOME_PROFILE } from "../image";
import { isTpbHomeScreen } from "../screen";
import { indexed, type CheckedItem } from "../types";

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
  const candidates: string[] = [];
  for (const label of ["MAGIOITHIEU", "OITHIEU"]) {
    for (const line of lines) {
      if (!hasLabel(line, label)) continue;
      // "(nếu có)" là chú thích CỦA NHÃN, không phải giá trị. Không bỏ nó thì
      // ảnh chưa điền mã đọc ra `NEU` — 45/52 đơn TPB đo 2026-09-13 có hai ảnh
      // cùng màn thành công, ảnh chưa cuộn cho `NEU`, ảnh cuộn rồi cho mã thật.
      const plain = stripAccents(line).replace(/\([^)]*\)/g, " ");
      const after = plain.match(/thieu[^A-Za-z0-9]*([A-Za-z0-9]{3,12})/i);
      if (after) candidates.push(after[1].toUpperCase());
      const last = plain.match(/([A-Za-z0-9]{3,12})[^A-Za-z0-9]*$/);
      if (last) candidates.push(last[1].toUpperCase());
    }
  }
  // Mã TPBank luôn có chữ số (AT105 tới AT109). Cụm toàn chữ là mảnh nhãn đọc
  // lẫn, trả rỗng còn hơn trả mã sai rồi báo "không khớp".
  return candidates.find((value) => /\d/.test(value)) ?? "";
}

export function parseTpbOpenSuccess(ocrText: string): TpbOpenSuccess {
  const lines = splitLines(ocrText);

  const out: TpbOpenSuccess = {
    // Nhận cả khi OCR rớt chữ "MỞ": hai cụm còn lại đủ nói đây là màn này.
    // Dùng `hasLabel` chứ không `hasPhrase`: `hasPhrase` so khớp nguyên văn nên
    // ảnh mờ đọc ra "M Tài Khon Thành Công" là trượt (đo 2026-09-13).
    success:
      lines.some((l) => hasLabel(l, "MOTAIKHOANTHANHCONG")) ||
      lines.some((l) => hasLabel(l, "TAIKHOAN") && hasLabel(l, "THANHCONG")),
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
 * Đầu màn hình chính, chữ trắng trên nền tím:
 *
 *   Xin chào 👋
 *   HUYNH THI NGA                     tên in hoa không dấu
 *   1000 5477 058   034 360 1521      số tài khoản 4-4-3, số điện thoại 3-3-4
 *
 * Ảnh nhận ra bằng MÀU trước khi OCR (`isTpbHomeScreen`), đọc một lượt bằng
 * `TPB_HOME_PROFILE`, rồi KIỂM CHỨNG: tìm tên và số tài khoản của hệ thống
 * trong chữ đọc được, so đúng từng ký tự. Không trích tên ra rồi mới so: bản
 * trước nhặt tên bằng luật bố cục dòng, đổi `--psm` là mất 7/63 tên (đo
 * 2026-09-14). Không cho lệch ký tự nào: nhân viên gõ sai một chữ số cũng phải
 * bị bắt (chốt 2026-09-14).
 *
 * `customerName` và `accountNumber` trả về chỉ để HIỆN cho người duyệt khi
 * không khớp, không dùng để chấm.
 */
export type TpbHome = {
  /** Tên hệ thống có trong chữ OCR, đúng từng ký tự sau khi bỏ dấu. */
  nameFound: boolean;
  /** Số tài khoản hệ thống có trong chữ OCR, đúng từng chữ số. */
  accountFound: boolean;
  /** Dòng giống tên nhất trên ảnh. */
  customerName: string;
  /** Dãy số giống số tài khoản nhất trên ảnh, đã bỏ khoảng trắng. */
  accountNumber: string;
};

// Ranh giới là "không phải chữ số", không dùng `\b`: OCR hay dính `_` hay
// chữ vào đuôi số (`862_`), mà `_` là ký tự từ nên `\b` không khớp.
const ACCOUNT = /(?<!\d)\d{4} ?\d{4} ?\d{3}(?!\d)/;

/** Chỉ còn các từ chữ cái viết hoa không dấu, cách nhau một khoảng trắng. */
const letterWords = (s: string): string[] =>
  stripAccents(s).toUpperCase().replace(/[^A-Z]+/g, " ").trim().split(" ").filter(Boolean);

/**
 * Dòng có chứa đúng tên không: chuỗi chữ cái của tên nằm trong chuỗi chữ cái
 * của dòng, đúng từng ký tự, phần dư mỗi đầu tối đa 2 chữ cái. Bỏ khoảng
 * trắng khi so vì OCR hay dính từ: `TO THICAM HON` là `TO THI CAM HON`.
 * `VW NGUYEN THI NHIEU` khớp `NGUYEN THI NHIEU` (logo và biểu tượng bàn tay
 * đọc thành chữ), `NGUYEN THI NHIEU HOA` không khớp vì dư `HOA`.
 */
function lineHasName(line: string, expected: string): boolean {
  const letters = letterWords(line).join("");
  if (!expected || letters.length < expected.length) return false;
  for (let at = letters.indexOf(expected); at >= 0; at = letters.indexOf(expected, at + 1)) {
    if (at <= 2 && letters.length - at - expected.length <= 2) return true;
  }
  return false;
}

export function verifyTpbHome(
  ocrText: string,
  ctx: Pick<TpbCheckContext, "customerName" | "accountNumber">,
): TpbHome {
  const lines = splitLines(ocrText);
  const expectedName = letterWords(ctx.customerName).join("");
  const expectedAccount = digitsOf(ctx.accountNumber);

  const nameLine = lines.find((line) => lineHasName(line, expectedName));
  // Số tài khoản có thể bị `--psm 11` tách khỏi số điện thoại, nên tìm trên
  // toàn bộ chữ số của ảnh; 11 chữ số liền không trùng ngẫu nhiên.
  const accountFound = Boolean(expectedAccount) && digitsOf(ocrText).includes(expectedAccount);

  let accountNumber = "";
  let accountAt = -1;
  for (let i = 0; i < lines.length && !accountNumber; i++) {
    const m = stripAccents(lines[i]).match(ACCOUNT);
    if (m) {
      accountNumber = m[0].replace(/\s/g, "");
      accountAt = i;
    }
  }
  // Khớp rồi thì hiện tên theo cách viết của hệ thống: chữ cái đã đúng từng
  // ký tự, chỉ khác khoảng trắng và mảnh rác hai đầu. Không khớp thì hiện dòng
  // chữ hoa >= 2 từ gần nhất phía trên số tài khoản, bỏ dòng "Xin chào" và
  // các dòng của thông báo đẩy: `TPBank Mobile`, `TK: xxxx5514108`, `bây giờ`.
  let customerName = nameLine ? letterWords(ctx.customerName).join(" ") : "";
  for (let i = accountAt - 1; i >= 0 && i >= accountAt - 6 && !customerName; i--) {
    const words = letterWords(lines[i]).filter((word) => word.length >= 2 && !/(.)\1\1/.test(word));
    const joined = words.join("");
    if (/TPBANK|XINCHAO|BAYGI/.test(joined)) continue;
    if (words.length >= 2 && joined.length >= 6) customerName = words.join(" ");
  }

  return { nameFound: Boolean(nameLine), accountFound, customerName, accountNumber };
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

/**
 * Nhặt tên ra khỏi dòng có rác: giữ các từ toàn chữ cái, dài từ 2 ký tự, và
 * in hoa ít nhất 3/4 số chữ; từ 2 chữ thì chỉ cần chữ đầu in hoa vì OCR hay
 * đọc `TO` thành `Tô`. `ToNVANPHUC` giữ, `Ba` giữ, `ao` bỏ, `Q` bỏ. Lấy chuỗi
 * từ liên tiếp dài nhất. Dùng cho tên người gửi ở màn chuyển khoản.
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

/** Tên có ít nhất 4 chữ cái; ngắn hơn là rác OCR như `TY`. */
const usableName = (s: string) => compact(s).length >= 4;

/* ── Màn "Chuyển thành công" ──────────────────────────────────────────── */

/**
 * Màn kết quả chuyển khoản, BA biến thể (đo 2026-09-11 và 2026-09-12).
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
 *
 * Biến thể 3, màn danh sách lịch sử giao dịch (đo 2026-09-12):
 *
 *   1000 5490 258                       số tài khoản của khách, đầu màn
 *   Lịch sử giao dịch                   tên tab, dùng để nhận ra màn này
 *   Thông tin tài khoản
 *   12/09/2026 - Thứ Bảy
 *   Tới: LE VAN KHANH                   người kia, KHÔNG phải khách
 *   Nguyen Thi Bich Thuy chuyen tien QR
 *   - 52,000 VND
 *   SD: 2,000 VND
 *   Từ: LE VAN KHANH chuyen tien
 *   FT26255378752305
 *   + 52,000 VND
 *   SD: 54,000 VND
 *
 * Không có chữ "thành công": số dư "SD:" in ngay sau mỗi dòng tự nói giao dịch
 * đã chốt sổ, coi như thành công. Tên người kia ở nhãn "Từ:"/"Tới:" không phải
 * khách nên KHÔNG lấy làm `fromName` — chỉ lấy được `fromAccount` từ số tài
 * khoản in ở đầu màn, và `amountText` từ dòng tiền của giao dịch đầu tiên.
 */
export type TpbTransfer = {
  /**
   * Có chữ "TPBank", bố cục "Chi Tiết Giao Dịch" + "Từ tài khoản", hoặc tên
   * tab "Lịch sử giao dịch" của app TPBank.
   */
  bank: boolean;
  /** Có dòng "Chuyển thành công", "Giao dịch thành công", hoặc là màn lịch sử giao dịch. */
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
  const historyLayout = hasPhrase(lines, "LICHSUGIAODICH");

  // Biến thể 3: số tài khoản của khách in ở đầu màn, trước mọi dòng giao
  // dịch. Không lấy nhầm số tham chiếu `FT...`: đó là chữ cái đứng đầu, còn
  // `ACCOUNT` chỉ khớp cụm toàn chữ số.
  if (historyLayout && !fromAccount) {
    for (const raw of lines) {
      const m = stripAccents(raw).match(ACCOUNT);
      if (m) {
        fromAccount = m[0].replace(/\s/g, "");
        break;
      }
    }
  }

  const out: TpbTransfer = {
    bank: hasPhrase(lines, "TPBANK") || detailLayout || historyLayout,
    success:
      hasPhrase(lines, "CHUYENTHANHCONG") || hasPhrase(lines, "GIAODICHTHANHCONG") || (historyLayout && !!amountText),
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
 * Ảnh của một tài khoản chia hai nhóm TRƯỚC khi OCR: ảnh màn hình chính nhận
 * ra bằng màu (`isTpbHomeScreen`), đọc bằng `TPB_HOME_PROFILE`; ảnh còn lại
 * đọc bằng profile mặc định cho hai parser mở tài khoản và chuyển khoản.
 * Nhân viên nộp ảnh không theo thứ tự nên mỗi nhóm vẫn có thể nhiều ảnh, mỗi
 * phép kiểm lấy ảnh khớp dữ liệu hệ thống nhiều nhất.
 */
/**
 * Một lượt `--psm 11`; chỉ khi chưa thấy đủ tên và số tài khoản mới đọc thêm
 * một lượt `--psm 6` và lấy lượt thấy nhiều hơn. `--psm 11` đọc chữ rời rạc
 * tốt hơn trên 96/112 ảnh so với 82/112 của `--psm 6`, nhưng có screenshot nó
 * tách `1000 5476 377` thành `10!` và `476377` còn `--psm 6` đọc liền (đo
 * 2026-09-14). Ảnh bình thường vẫn chỉ tốn một lượt.
 */
async function ocrTpbHome(image: Buffer, ctx: TpbCheckContext): Promise<string> {
  const first = await ocrImage(image, TPB_HOME_PROFILE);
  const seen = verifyTpbHome(first, ctx);
  if (seen.nameFound && seen.accountFound) return first;
  const second = await ocrImage(image, { ...TPB_HOME_PROFILE, psm: "6" });
  const again = verifyTpbHome(second, ctx);
  const score = (r: TpbHome) => Number(r.nameFound) + Number(r.accountFound);
  return score(again) > score(seen) ? second : first;
}

export async function checkTpbankImages(images: Buffer[], ctx: TpbCheckContext): Promise<CheckedItem[]> {
  const isHome = await Promise.all(images.map(isTpbHomeScreen));
  const texts: string[] = [];
  for (let i = 0; i < images.length; i++) {
    texts.push(isHome[i] ? await ocrTpbHome(images[i], ctx) : await ocrImage(images[i], DEFAULT_PROFILE));
  }
  return checkTpbank(
    texts,
    ctx,
    isHome.flatMap((home, i) => (home ? [i] : [])),
  );
}

/**
 * Chấm trên chữ đã OCR. `homeIndexes` là chỉ số các ảnh đã nhận là màn hình
 * chính và đã đọc bằng `TPB_HOME_PROFILE`; hai parser kia chạy trên ảnh còn
 * lại. Màn mở tài khoản có `success`, chuyển khoản có `bank` và `success`; một
 * ảnh khớp nhiều màn thì ưu tiên màn thiếu ít trường nhất.
 */
export function checkTpbank(texts: string[], ctx: TpbCheckContext, homeIndexes: number[] = []): CheckedItem[] {
  const others = texts.map((text, i) => (homeIndexes.includes(i) ? "" : text));
  const opens = indexed(others, parseTpbOpenSuccess).filter((r) => r.success);
  const transfers = indexed(others, parseTpbTransfer).filter((r) => r.bank && r.success);
  const homes = homeIndexes.map((photoIndex) => ({ ...verifyTpbHome(texts[photoIndex], ctx), photoIndex }));
  const best = <T extends { missing: unknown[] }>(rs: T[]) =>
    rs.sort((a, b) => a.missing.length - b.missing.length)[0];

  /**
   * Chọn theo SỐ TRƯỜNG KHỚP dữ liệu hệ thống trước, rồi mới tới số trường
   * thiếu — giống MB. Bản trước chỉ so số trường thiếu, nên ảnh của khách KHÁC
   * đọc đủ trường vẫn thắng ảnh đúng khách mà thiếu một trường.
   */
  const pick = <T extends { missing: unknown[] }>(rs: T[], score: (value: T) => number): T | undefined =>
    rs.sort((a, b) => score(b) - score(a) || a.missing.length - b.missing.length)[0];

  const open = pick(opens, (r) =>
    Number(Boolean(r.referralCode && ctx.referralCode) && codeKey(r.referralCode) === codeKey(ctx.referralCode)) +
    Number(Boolean(r.accountNumber && ctx.accountNumber) && digitsOf(r.accountNumber) === digitsOf(ctx.accountNumber)));
  const home = homes.sort(
    (a, b) => Number(b.nameFound) + Number(b.accountFound) - Number(a.nameFound) - Number(a.accountFound),
  )[0];
  const transfer = best(transfers);
  const items: CheckedItem[] = [];

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
      photoIndex: open.photoIndex,
    });
  }

  // 2. Màn hình chính: tên khách và số tài khoản phải có đúng trên ảnh. Ghi
  // chú luôn kèm cả giá trị trên ảnh lẫn trong hệ thống để người duyệt tự
  // quyết bên nào sai: OCR đọc nhầm một chữ số hay nhân viên nhập nhầm.
  if (!home) {
    items.push({
      key: "home",
      verdict: "missing",
      label: "Tên khách hàng và số tài khoản",
      issues: ["Thiếu ảnh màn hình chính"],
      found: "",
      expected: [ctx.customerName, ctx.accountNumber].filter(Boolean).join(" - "),
      note: "Không ảnh nào là màn hình chính app TPBank.",
    });
  } else {
    const notes: string[] = [];
    const issues: string[] = [];
    const seen = [home.customerName, home.accountNumber].filter(Boolean).join(" - ");
    const expected = [ctx.customerName, ctx.accountNumber].filter(Boolean).join(" - ");
    if (!home.nameFound && !home.accountFound && home.customerName && home.accountNumber) {
      issues.push("Ảnh của khách khác");
      notes.push(`Ảnh ghi ${seen}; hệ thống ghi ${expected}.`);
    } else {
      if (!home.nameFound) {
        if (home.customerName) {
          issues.push("Tên khách hàng không khớp");
          notes.push(`Tên trên ảnh ${home.customerName}, tên khách ${ctx.customerName}.`);
        } else {
          issues.push("Không đọc được tên khách hàng");
          notes.push("Ảnh màn hình chính không có tên khách, có thể bị thông báo che.");
        }
      }
      if (!home.accountFound) {
        if (home.accountNumber) {
          issues.push("Số tài khoản không khớp");
          notes.push(`Số tài khoản trên ảnh ${home.accountNumber}, đã nhập ${ctx.accountNumber}.`);
        } else {
          issues.push("Không đọc được số tài khoản");
          notes.push("Ảnh màn hình chính không đọc được số tài khoản.");
        }
      }
    }
    items.push({
      key: "home",
      verdict: issues.length ? "fail" : "pass",
      label: "Tên khách hàng và số tài khoản",
      issues,
      found: seen,
      expected,
      note: notes.join(" "),
      photoIndex: home.photoIndex,
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
      photoIndex: transfer.photoIndex,
    });
  }

  return items;
}
