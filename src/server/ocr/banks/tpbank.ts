import { compact, hasLabel, hasPhrase, splitLines, stripAccents } from "../text";
import {
  DEFAULT_PROFILE,
  ocrImage,
  TPB_HOME_PROFILE,
  TPB_LIGHT_PROFILE,
  TPB_LIGHT_SHARP_PROFILE,
  TPB_LIGHT_UNSCALED_PROFILE,
  TPB_TRANSFER_PROFILE,
} from "../image";
import { isTpbHomeScreen } from "../screen";
import { indexed, type CheckedItem } from "../types";

/* ── Màn "Mở Tài Khoản Thành Công" ────────────────────────────────────── */

/**
 * Màn cuối luồng mở tài khoản, chữ tối nền sáng, nhãn bên trái giá trị bên phải:
 *
 *   Mở tài khoản thành công!
 *   Tên đăng nhập:            0374949991
 *   Số tài khoản thanh toán:  1000 5465 402
 *   Hạn mức GD:               ...
 *   Email:                    (có máy không in dòng này)
 *   Hiệu lực từ:              11/09/2026
 *   Mã giới thiệu:            AT108
 *
 * Luật (chốt 2026-09-14): mã giới thiệu trên ảnh phải đúng mã đã chọn. Số
 * tài khoản đọc được thì so thêm; không đọc được thì không kết luận, vì màn
 * hình chính đã so số đó. KIỂM CHỨNG như hai màn kia: giá trị hệ thống có
 * trong chữ OCR không, không dung sai. `--psm 11` tách nhãn và giá trị ra hai
 * dòng, nên không tìm giá trị "trên dòng có nhãn" như bản trước.
 *
 * Ảnh chưa bấm "Xem thêm" chỉ có tên đăng nhập và số tài khoản, không có mã:
 * kết luận "không đọc được mã" là đúng, người duyệt phải xem ảnh khác.
 */
export type TpbOpen = {
  /** Có dòng "Mở tài khoản thành công". */
  isOpen: boolean;
  /** Mã hệ thống có trong chữ OCR, đúng từng ký tự sau khi gộp O/0, I/1, S/5, B/8, Z/2. */
  codeFound: boolean;
  /** Số tài khoản hệ thống có trong chữ OCR, đúng từng chữ số. */
  accountFound: boolean;
  /** Mã đọc được trên ảnh, `''` khi không thấy; chỉ để hiện cho người duyệt. */
  referralCode: string;
  /** Dãy số dạng 4-4-3 đọc được, đã bỏ khoảng trắng; chỉ để hiện cho người duyệt. */
  accountNumber: string;
};

/**
 * Nhãn ngắn là `OITHIEU` chứ không phải `THIEU`: rác đầu dòng ghép với chữ
 * kế thành `NHIEU` ở dòng `Ñ Hiệu lực từ 11/09/2026`, sai 1 ký tự so với
 * `THIEU` nên bị nhận nhầm (đo 2026-09-12).
 */
const OPEN_CODE_LABELS = ["MAGIOITHIEU", "OITHIEU"];

export function verifyTpbOpen(
  ocrText: string,
  ctx: Pick<TpbCheckContext, "referralCode" | "accountNumber">,
): TpbOpen {
  const lines = splitLines(ocrText);
  // Nhận cả khi OCR rớt chữ "MỞ": hai cụm còn lại đủ nói đây là màn này.
  // Dùng `hasLabel` chứ không `hasPhrase`: `hasPhrase` so khớp nguyên văn nên
  // ảnh mờ đọc ra "M Tài Khon Thành Công" là trượt (đo 2026-09-13). Tiêu đề
  // xanh lá trên nền sáng tương phản thấp hơn nhãn trường màu tối: ảnh chụp
  // nghiêng có vân lưới mất hẳn tiêu đề mà vẫn đọc được "Tên đăng nhập" và
  // "Số tài khoản thanh toán" (ảnh cao-thi-lac, bộ nhãn 2026-09-14). Hai nhãn
  // đó cùng có chỉ ở màn này, nên đủ để nhận màn.
  const isOpen =
    lines.some((l) => hasLabel(l, "MOTAIKHOANTHANHCONG")) ||
    lines.some((l) => hasLabel(l, "TAIKHOAN") && hasLabel(l, "THANHCONG")) ||
    (lines.some((l) => hasLabel(l, "TENDANGNHAP")) && lines.some((l) => hasLabel(l, "TAIKHOANTHANHTOAN")));
  const expectedCode = codeKey(ctx.referralCode);
  const expectedAccount = digitsOf(ctx.accountNumber);
  const codeFound =
    Boolean(expectedCode) && lines.some((line) => codeTokens(line).some((t) => codeKey(t) === expectedCode));
  const accountFound = hasDigits(ocrText, expectedAccount);

  // Giá trị nằm ngay sau dòng nhãn, nên duyệt từ đó rồi vòng lại đầu ảnh.
  let referralCode = codeFound ? ctx.referralCode : "";
  const labelAt = lines.findIndex((line) => OPEN_CODE_LABELS.some((label) => hasLabel(line, label)));
  const ordered = labelAt >= 0 ? lines.slice(labelAt + 1).concat(lines.slice(0, labelAt + 1)) : lines;
  for (const line of ordered) {
    if (referralCode) break;
    referralCode = codeTokens(line).find((t) => CODE_LIKE.test(t)) ?? "";
  }

  let accountNumber = accountFound ? expectedAccount : "";
  for (const line of lines) {
    if (accountNumber) break;
    accountNumber = stripAccents(line).match(ACCOUNT)?.[0].replace(/\s/g, "") ?? "";
  }

  return { isOpen, codeFound, accountFound, referralCode, accountNumber };
}

/* ── Màn "Nhập thông tin để bắt đầu", bước nhập mã giới thiệu ─────────── */

/**
 * Màn đầu luồng mở tài khoản, chữ tối trên nền sáng; nhân viên chụp nó để
 * chứng minh đã nhập mã (99/260 ảnh benchmark 2026-09-13 là màn này):
 *
 *   Nhập thông tin để bắt đầu nhé!        iPhone in "để bắt đầu Bạn nhé!"
 *   Số điện thoại
 *   0704480084
 *   Email (không bắt buộc)
 *   Mã ưu đãi/giới thiệu (nếu có)
 *   AT107
 *
 * Nhận màn bằng "ưu đãi/giới thiệu" hoặc "(nếu có)" hoặc tiêu đề. KHÔNG dùng
 * "giới thiệu" suông: màn mở tài khoản thành công cũng in "Mã giới thiệu
 * AT107". Tiêu đề chỉ là nhãn phụ: màn đã cuộn hay chữ to thì mất tiêu đề
 * (ảnh le-van-manh, bộ nhãn 2026-09-14).
 *
 * KIỂM CHỨNG như màn hình chính: mã của hệ thống có trong chữ OCR không, so
 * sau `codeKey`, không dung sai. Màn này không có tên khách và số tài khoản,
 * chỉ có số điện thoại mà ctx chưa mang theo. `referralCode` trả về chỉ để
 * hiện cho người duyệt khi không khớp.
 */
export type TpbStart = {
  /** Có nhãn "Mã ưu đãi/giới thiệu (nếu có)" hoặc tiêu đề "Nhập thông tin để bắt đầu". */
  isStart: boolean;
  /** Mã hệ thống có trong chữ OCR, đúng từng ký tự sau khi gộp O/0, I/1, S/5, B/8, Z/2. */
  codeFound: boolean;
  /** Mã đọc được trên ảnh, `''` khi không thấy. */
  referralCode: string;
};

const START_LABELS = ["UUDAIGIOITHIEU", "GIOITHIEUNEUCO", "THONGTINDEBATDAU"];

/** Cụm 1-3 chữ cái rồi 2-5 chữ số, như `AT107`; `T109` đọc thiếu chữ cũng lọt để người duyệt thấy. */
const CODE_LIKE = /^[A-Z]{1,3}\d{2,5}$/;

/**
 * Token chữ-số của một dòng, kèm mỗi cặp token liền nhau ghép lại: Tesseract
 * đọc `AT107` trên ảnh chụp lại thành `ATI 07` (ảnh bui-van-thang), ghép hai
 * token là ra mã, còn `I` thì `codeKey` đã gộp với `1`.
 */
function codeTokens(line: string): string[] {
  const tokens = stripAccents(line).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  return tokens.concat(tokens.slice(1).map((next, i) => tokens[i] + next));
}

export function verifyTpbStart(ocrText: string, ctx: Pick<TpbCheckContext, "referralCode">): TpbStart {
  const lines = splitLines(ocrText);
  const labelAt = lines.findIndex((line) => START_LABELS.some((label) => hasLabel(line, label)));
  const expected = codeKey(ctx.referralCode);
  const codeFound = Boolean(expected) && lines.some((line) => codeTokens(line).some((t) => codeKey(t) === expected));

  // `--psm 11` xếp mã sau dòng nhãn nhưng chen rác ở giữa, có khi 10 dòng
  // (ảnh bui-van-thang), nên ưu tiên token sau nhãn rồi mới tới cả ảnh.
  let referralCode = codeFound ? ctx.referralCode : "";
  const ordered = labelAt >= 0 ? lines.slice(labelAt + 1).concat(lines.slice(0, labelAt + 1)) : lines;
  for (const line of ordered) {
    if (referralCode) break;
    referralCode = codeTokens(line).find((t) => CODE_LIKE.test(t)) ?? "";
  }

  return { isStart: labelAt >= 0, codeFound, referralCode };
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
  const accountFound = hasDigits(ocrText, expectedAccount);

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
  // các dòng của thông báo đẩy: `TPBank Mobile`, `TK: xxxx5514108`, `bây giờ`,
  // `vừa xong` (đọc thành `VUIA XONG`, tài khoản b937f9ba 2026-09-15).
  let customerName = nameLine ? letterWords(ctx.customerName).join(" ") : "";
  for (let i = accountAt - 1; i >= 0 && i >= accountAt - 6 && !customerName; i--) {
    const words = letterWords(lines[i]).filter((word) => word.length >= 2 && !/(.)\1\1/.test(word));
    const joined = words.join("");
    if (/TPBANK|XINCHAO|BAYGI|XONG$/.test(joined)) continue;
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
 *   Nội dung: Bui Van Thang chuyen tien QR    app tự điền TÊN CHỦ TÀI KHOẢN
 *   Chuyển nhanh 247: 19:04 11/09/2026        chuyển nội bộ in "Chuyển tiền ngay"
 *
 * Dòng "Nội dung"/"Lời nhắn" là chỗ duy nhất của biến thể 1 có tên khách:
 * app điền `<tên chủ tài khoản> chuyen tien` (có khi thêm ` QR`), 55/55 ảnh
 * bộ nhãn 2026-09-14 đúng dạng này. `verifyTpbTransferSender` so tên hệ thống
 * với đoạn trước "chuyen tien", đúng từng ký tự. Ảnh đã bấm mở rộng còn in
 * "Người gửi: <tên> <số tài khoản>", chưa dùng.
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
      // Có dung sai: ảnh chụp lại đọc "Cuuyển thành công!" (bộ nhãn 2026-09-14).
      lines.some((l) => hasLabel(l, "CHUYENTHANHCONG")) ||
      hasPhrase(lines, "GIAODICHTHANHCONG") ||
      (historyLayout && !!amountText),
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

/**
 * Tên khách có trong lời nhắn của biến thể 1 không. So chuỗi chữ cái: tên hệ
 * thống nối liền `CHUYENTIEN` phải nằm trong chuỗi chữ cái của một dòng, nên
 * `NGUYEN THI SAU` không khớp `NGUYEN THI SAU HOA chuyen tien`, và nhãn
 * "Nội dung:" đứng trước không cản. `name` là đoạn trước "chuyen tien" để hiện
 * cho người duyệt khi không khớp, `''` khi ảnh không có dòng này.
 */
export function verifyTpbTransferSender(
  ocrText: string,
  ctx: Pick<TpbCheckContext, "customerName">,
): { found: boolean; name: string } {
  const expected = letterWords(ctx.customerName).join("");
  let name = "";
  for (const line of splitLines(ocrText)) {
    const m = stripAccents(line).match(/^(?:.*?(?:noi dung|loi nhan)\s*:?\s*)?(.+?)\s+chuyen\s*tien\b/i);
    if (!m) continue;
    if (expected && letterWords(line).join("").includes(expected + "CHUYENTIEN")) {
      return { found: true, name: letterWords(ctx.customerName).join(" ") };
    }
    // Bỏ mảnh nhãn OCR đọc lẫn vào đầu tên: `dung Nguyen...`, `A Le Thi...`.
    const words = letterWords(m[1]);
    while (words.length && (words[0].length < 2 || /^(NOI|DUNG|LOI|NHAN)$/.test(words[0]))) words.shift();
    if (!name) name = words.join(" ");
  }
  return { found: false, name };
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
 * Dãy số hệ thống có trong chữ OCR không: đúng từng chữ số và TRỌN dãy, trước
 * và sau không còn chữ số. Cho khoảng trắng hay xuống dòng giữa các chữ số vì
 * `--psm 11` tách `1000 5476 110` khỏi số điện thoại hoặc xuống dòng.
 *
 * Không so trên chuỗi chữ số của cả ảnh như bản trước: nhân viên nhập
 * `1000 5476 1` thiếu hai số vẫn là chuỗi con của `10005476110` trên ảnh và
 * đạt nhầm ở cả màn hình chính lẫn màn mở tài khoản (tài khoản 10f75c6d
 * benchmark, đo 2026-09-15).
 */
function hasDigits(text: string, expected: string): boolean {
  if (!expected) return false;
  return new RegExp(`(?<!\\d)${expected.split("").join("\\s*")}(?!\\d)`).test(text);
}

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

/** Màn chuyển khoản đã đọc đủ: có TPBank, có "thành công", có số tiền. */
function transferComplete(text: string): boolean {
  const seen = parseTpbTransfer(text);
  return seen.bank && seen.success && Boolean(seen.amountText);
}

/**
 * Nhãn menu chỉ có ở màn hình chính, viết compact như `hasLabel`. Dùng để
 * nhận màn bằng CHỮ khi bước màu không nhận ra: ảnh chụp qua mặt kính, màu
 * lệch, khối tím không qua ngưỡng (tài khoản STK 10005512250, 2026-09-15).
 *
 * Không dùng "Chuyển tiền" và "Lịch sử GD": lời nhắn `chuyen tien QR` và tab
 * "Lịch sử giao dịch" của màn chuyển khoản khớp hai nhãn đó qua `hasLabel`.
 * Không dùng số tài khoản và số điện thoại: màn mở tài khoản cũng có cả hai.
 * Trên 8 ảnh màn hình chính lệch màu, lượt đầu đọc ra "Xin chào" và "Chatpay"
 * ở 7 ảnh.
 */
const HOME_LABELS = ["XINCHAO", "CHATPAY", "QRCUATOI", "THANHTOANHOADON", "NAPTIEN", "CHUYENTIENDACTHU"];

/**
 * Chữ OCR có từ hai nhãn menu màn hình chính trở lên và không có dòng "thành
 * công" của màn chuyển khoản. Không loại theo chữ "TPBank": thông báo đẩy
 * "TPBank Mobile" và banner "App TPBank" trên màn hình chính cũng có chữ đó.
 */
function looksLikeTpbHome(text: string): boolean {
  const lines = splitLines(text);
  if (parseTpbTransfer(text).success) return false;
  return HOME_LABELS.filter((label) => lines.some((line) => hasLabel(line, label))).length >= 2;
}

/**
 * Ảnh không phải màn hình chính, đọc theo thứ tự màn hay gặp, dừng ngay khi
 * một màn đọc đủ trường:
 *
 * 1. `TPB_LIGHT_PROFILE`, 0,5 đến 0,7 giây, cho hai màn chữ tối nền sáng, là
 *    hai màn nhiều ảnh nhất mà không có đặc điểm màu để nhận trước khi OCR.
 *    Màn "Mở tài khoản thành công" thiếu mã hay số tài khoản thì đọc thêm
 *    lượt cỡ gốc và lấy lượt thấy nhiều trường hơn (đo 2026-09-14 trên 74
 *    ảnh: 72 đủ ngay lượt đầu, lượt cỡ gốc cứu ảnh chụp sát màn hình có vân
 *    lưới mà mọi cỡ phóng đều ra rác). Màn "Nhập thông tin" thấy màn mà thiếu
 *    mã thì đọc lại lượt `sharp` (đo 2026-09-14: cứu 4/94 ảnh chụp mờ).
 * 2. `TPB_TRANSFER_PROFILE` kênh đỏ, 0,6 giây: màn "Chuyển thành công" đủ
 *    trường 50/55; thiếu thì thêm lượt `sharp`, lên 55/55 (đo 2026-09-14).
 * 3. Còn lại đọc nốt `plain` và `negated` rồi nối theo đúng thứ tự của
 *    `DEFAULT_PROFILE`, cho hai biến thể chuyển khoản còn lại; chữ này vẫn
 *    qua các hàm kiểm chứng ở `checkTpbank`, nên màn sáng mà lượt 1 đọc ra
 *    rác vẫn còn một cơ hội.
 */
async function ocrTpbOther(image: Buffer, ctx: TpbCheckContext): Promise<string> {
  const first = await ocrImage(image, TPB_LIGHT_PROFILE);
  const open = verifyTpbOpen(first, ctx);
  if (open.isOpen) {
    if (open.codeFound && (open.accountFound || !ctx.accountNumber)) return first;
    const second = await ocrImage(image, TPB_LIGHT_UNSCALED_PROFILE);
    const again = verifyTpbOpen(second, ctx);
    const score = (r: TpbOpen) => Number(r.codeFound) + Number(r.accountFound);
    return score(again) > score(open) ? second : first;
  }
  const seen = verifyTpbStart(first, ctx);
  if (seen.isStart) {
    if (seen.codeFound) return first;
    const second = await ocrImage(image, TPB_LIGHT_SHARP_PROFILE);
    return verifyTpbStart(second, ctx).codeFound ? second : first;
  }
  // Màn hình chính không qua bước màu: lượt đầu đọc ra nhãn menu ở 7/8 ảnh
  // thử, trả về ngay để `checkTpbankImages` đọc cấu hình màn hình chính,
  // khỏi tốn bốn lượt của nhánh chuyển khoản.
  if (looksLikeTpbHome(first)) return first;
  if (looksLikePaperForm(first)) return first;

  const red = await ocrImage(image, TPB_TRANSFER_PROFILE);
  if (transferComplete(red)) return red;
  const sharp = await ocrImage(image, { ...DEFAULT_PROFILE, passes: ["sharp"] });
  if (transferComplete(`${red}\n${sharp}`)) return `${red}\n${sharp}`;
  const rest = await ocrImage(image, { ...DEFAULT_PROFILE, passes: ["plain", "negated"] });
  return `${rest}\n${red}\n${sharp}`;
}

/**
 * Tờ giấy ghi tay nhân viên hay chụp kèm: mẫu in sẵn "Chủ tài khoản", "Tên
 * đăng nhập", "Số tài khoản", "Mật khẩu", "Mã PIN" cho nhiều ngân hàng, có tờ
 * in cả bảng địa chỉ chi nhánh. Không màn TPBank nào có "Chủ tài khoản" hay
 * "Mật khẩu" (0/317 ảnh màn app khớp nhầm, đo 2026-09-15), còn "Tên đăng
 * nhập", "Số tài khoản", "TPBank" thì có nên không dùng. "Mã PIN" ngắn, khớp
 * nhầm 1/94 màn nhập mã nên bỏ. Nhận ra rồi thì dừng sau lượt đầu: tờ giấy
 * chữ nhỏ dày đặc đi hết chuỗi năm lượt mất 30 giây (tài khoản 32acce88).
 */
const PAPER_LABELS = ["CHUTAIKHOAN", "MATKHAU"];

function looksLikePaperForm(text: string): boolean {
  const lines = splitLines(text);
  return PAPER_LABELS.some((label) => lines.some((line) => hasLabel(line, label)));
}

/** Chữ này đã nhận ra là một trong ba màn còn lại chưa. */
function recognizedOther(text: string, ctx: TpbCheckContext): boolean {
  const transfer = parseTpbTransfer(text);
  return verifyTpbOpen(text, ctx).isOpen || verifyTpbStart(text, ctx).isStart || (transfer.bank && transfer.success);
}

/**
 * Ảnh qua bước màu thì đọc thẳng cấu hình màn hình chính. Ảnh không qua thì
 * đọc các cấu hình kia; không nhận ra màn nào mà chữ có nhãn menu màn hình
 * chính thì đọc thêm một lượt cấu hình màn hình chính và lấy lượt so được
 * nhiều trường hơn. Nhờ vậy ảnh chụp lệch màu vẫn được so tên và số tài khoản,
 * thay vì báo "thiếu ảnh màn hình chính" trong khi ảnh có.
 */
export async function checkTpbankImages(images: Buffer[], ctx: TpbCheckContext): Promise<CheckedItem[]> {
  const isHome = await Promise.all(images.map(isTpbHomeScreen));
  const texts: string[] = [];
  const homeIndexes: number[] = [];
  const score = (text: string) => {
    const seen = verifyTpbHome(text, ctx);
    return Number(seen.nameFound) + Number(seen.accountFound);
  };
  for (let i = 0; i < images.length; i++) {
    if (isHome[i]) {
      texts.push(await ocrTpbHome(images[i], ctx));
      homeIndexes.push(i);
      continue;
    }
    const other = await ocrTpbOther(images[i], ctx);
    if (recognizedOther(other, ctx) || !looksLikeTpbHome(other)) {
      texts.push(other);
      continue;
    }
    const home = await ocrTpbHome(images[i], ctx);
    texts.push(score(home) >= score(other) ? home : other);
    homeIndexes.push(i);
  }
  return checkTpbank(texts, ctx, homeIndexes);
}

/**
 * Chấm trên chữ đã OCR. `homeIndexes` là chỉ số các ảnh đã nhận là màn hình
 * chính và đã đọc bằng `TPB_HOME_PROFILE`; hai parser kia chạy trên ảnh còn
 * lại. Màn mở tài khoản có `success`, chuyển khoản có `bank` và `success`; một
 * ảnh khớp nhiều màn thì ưu tiên màn thiếu ít trường nhất.
 */
export function checkTpbank(texts: string[], ctx: TpbCheckContext, homeIndexes: number[] = []): CheckedItem[] {
  const others = texts.map((text, i) => (homeIndexes.includes(i) ? "" : text));
  const opens = indexed(others, (text) => verifyTpbOpen(text, ctx)).filter((r) => r.isOpen);
  const starts = indexed(others, (text) => verifyTpbStart(text, ctx)).filter((r) => r.isStart);
  const transfers = indexed(others, parseTpbTransfer).filter((r) => r.bank && r.success);
  const homes = homeIndexes.map((photoIndex) => ({ ...verifyTpbHome(texts[photoIndex], ctx), photoIndex }));
  const best = <T extends { missing: unknown[] }>(rs: T[]) =>
    rs.sort((a, b) => a.missing.length - b.missing.length)[0];

  // Chọn ảnh khớp dữ liệu hệ thống nhiều nhất: ảnh của khách KHÁC đọc đủ
  // trường không được thắng ảnh đúng khách.
  const open = opens.sort(
    (a, b) => Number(b.codeFound) + Number(b.accountFound) - Number(a.codeFound) - Number(a.accountFound),
  )[0];
  const start = starts.sort(
    (a, b) => Number(b.codeFound) - Number(a.codeFound) || Number(Boolean(b.referralCode)) - Number(Boolean(a.referralCode)),
  )[0];
  const home = homes.sort(
    (a, b) => Number(b.nameFound) + Number(b.accountFound) - Number(a.nameFound) - Number(a.accountFound),
  )[0];
  const transfer = best(transfers);
  const items: CheckedItem[] = [];

  // 1. Mã giới thiệu và số tài khoản. Mã có ở HAI màn: màn "Nhập thông tin"
  // (chỉ mã) và màn mở tài khoản thành công (mã và số tài khoản); khớp ở màn
  // nào cũng tính. Số tài khoản chỉ so được khi có màn thành công; không có
  // thì màn hình chính ở mục 2 đã so số đó rồi.
  if (!open && !start) {
    items.push({
      key: "open",
      verdict: "missing",
      label: "Mã giới thiệu và số tài khoản",
      issues: ["Thiếu ảnh xác thực mã giới thiệu và số tài khoản"],
      found: "",
      expected: ctx.referralCode,
      note: "Không ảnh nào là màn nhập mã giới thiệu hay màn mở tài khoản thành công.",
    });
  } else {
    const notes: string[] = [];
    const issues: string[] = [];
    const codeFrom = open?.codeFound ? open : start?.codeFound ? start : undefined;
    const seenCode = open?.referralCode || start?.referralCode || "";
    if (!codeFrom) {
      if (!seenCode) {
        notes.push("Không đọc được mã giới thiệu.");
        issues.push("Không đọc được mã giới thiệu");
      } else if (ctx.referralCode) {
        notes.push(`Mã trên ảnh ${seenCode}, mã đã chọn ${ctx.referralCode}.`);
        issues.push("Mã giới thiệu không khớp");
      }
    }
    if (open && !open.accountFound && open.accountNumber && ctx.accountNumber) {
      notes.push(`Số tài khoản trên ảnh ${open.accountNumber}, đã nhập ${ctx.accountNumber}.`);
      issues.push("Số tài khoản không khớp");
    }
    items.push({
      key: "open",
      verdict: notes.length ? "fail" : "pass",
      label: "Mã giới thiệu và số tài khoản",
      issues,
      found: [codeFrom ? ctx.referralCode : seenCode, open?.accountNumber].filter(Boolean).join(" - "),
      expected: [ctx.referralCode, ctx.accountNumber].filter(Boolean).join(" - "),
      note: notes.join(" "),
      photoIndex: (codeFrom ?? open ?? start)?.photoIndex,
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

  // 3. Chuyển khoản: có TPBank, có "thành công", có số tiền (luật chốt
  // 2026-09-14, giữ lại 2026-09-15). Tên trong lời nhắn và tên người gửi chỉ
  // HIỆN, không dùng để kết luận: soi 40 ảnh bị đánh lỗi vì tên ngày
  // 2026-09-15 thì 20 là báo sai (lời nhắn tự gõ không có tên, lời nhắn xuống
  // hai dòng, OCR đọc sai tên trên ảnh chụp), 13 ca lệch thật thì mục màn
  // hình chính đã báo cùng lệch đó, 5 ca người khác chuyển thay chủ dự án
  // chấp nhận. Số tài khoản gửi ở biến thể 2 và 3 vẫn so.
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
    const sender = verifyTpbTransferSender(texts[transfer.photoIndex], ctx);
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
      found: [transfer.amountText, transfer.transferredAt, transfer.fromName || sender.name, transfer.fromAccount]
        .filter(Boolean)
        .join(" - "),
      expected: transfer.fromAccount ? ctx.accountNumber : "",
      note: notes.join(" "),
      photoIndex: transfer.photoIndex,
    });
  }

  return items;
}
