import { compact, hasLabel, hasPhrase, splitLines, stripAccents } from "../text";
import {
  DEFAULT_PROFILE,
  ocrImage,
  TPB_HOME_PROFILE,
  TPB_LIGHT_PROFILE,
  TPB_LIGHT_SHARP_PROFILE,
  TPB_LIGHT_UNSCALED_PROFILE,
  TPB_TRANSFER_PROFILE,
  type OcrProfile,
} from "../image";
import { isTpbHomeScreen } from "../screen";
import type { CheckedItem } from "../types";

/**
 * Luật TPBank chốt 2026-09-16: trong bộ ảnh của một tài khoản phải thấy đủ
 * BỐN giá trị, ở ảnh nào cũng được, không cần nhận ra ảnh là màn nào:
 *
 *   1. tên khách                 đúng từng chữ cái sau khi bỏ dấu
 *   2. số tài khoản              đúng từng chữ số, trọn dãy
 *   3. mã giới thiệu             đúng từng ký tự sau khi gộp O/0, I/1, S/5, B/8, Z/2
 *   4. chuyển khoản thành công   có dòng "Chuyển thành công" hoặc "Giao dịch thành công"
 *
 * Bản trước (tới 2026-09-15) nhận từng màn rồi so trường theo màn: 858 dòng,
 * và ảnh chụp lệch màu hay cuộn mất tiêu đề thì không nhận ra màn dù chữ vẫn
 * đọc được. Bản này chỉ KIỂM CHỨNG: giá trị hệ thống có trong chữ OCR không,
 * không trích giá trị ra rồi mới so. Giá trị "đọc được trên ảnh" chỉ để hiện
 * cho người duyệt khi không khớp.
 */
export type TpbCheckContext = {
  /** `referral_codes.code` của mã đã chọn. `''` = mã QR-only, không so được. */
  referralCode: string;
  /** `customers.full_name`. */
  customerName: string;
  /** `bank_accounts.account_number` nhân viên nhập lúc hoàn thành. `''` = chưa có. */
  accountNumber: string;
};

export type TpbFacts = {
  nameFound: boolean;
  accountFound: boolean;
  codeFound: boolean;
  successFound: boolean;
};

const NO_FACTS: TpbFacts = { nameFound: false, accountFound: false, codeFound: false, successFound: false };

const FACT_KEYS = Object.keys(NO_FACTS) as (keyof TpbFacts)[];

const mergeFacts = (a: TpbFacts, b: TpbFacts): TpbFacts =>
  Object.fromEntries(FACT_KEYS.map((k) => [k, a[k] || b[k]])) as TpbFacts;

const allFound = (f: TpbFacts) => FACT_KEYS.every((k) => f[k]);

/** `b` có giá trị nào mà `a` chưa có không. */
const addsTo = (a: TpbFacts, b: TpbFacts) => FACT_KEYS.some((k) => b[k] && !a[k]);

/* ── Phép so ──────────────────────────────────────────────────────────── */

/**
 * Mã giới thiệu so sau khi bỏ dấu, viết hoa, và gộp ký tự dễ nhầm: `O`/`0`,
 * `I`/`1`, `S`/`5`, `B`/`8`, `Z`/`2`. Không cho sai ký tự: `AT105` và `AT106`
 * là hai mã của hai người, sai một ký tự là sai người.
 */
const codeKey = (s: string) =>
  compact(s).replace(/O/g, "0").replace(/I/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");

const digitsOf = (s: string) => s.replace(/\D/g, "");

/**
 * Token chữ-số của một dòng, kèm mỗi cặp token liền nhau ghép lại: Tesseract
 * đọc `AT107` trên ảnh chụp lại thành `ATI 07` (ảnh bui-van-thang), ghép hai
 * token là ra mã, còn `I` thì `codeKey` đã gộp với `1`.
 */
function codeTokens(line: string): string[] {
  const tokens = stripAccents(line).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  return tokens.concat(tokens.slice(1).map((next, i) => tokens[i] + next));
}

/**
 * Dãy số hệ thống có trong chữ OCR không: đúng từng chữ số và TRỌN dãy, trước
 * và sau không còn chữ số. Cho khoảng trắng hay xuống dòng giữa các chữ số vì
 * `--psm 11` tách `1000 5476 110` khỏi số điện thoại hoặc xuống dòng.
 *
 * Không so trên chuỗi chữ số của cả ảnh: nhân viên nhập `1000 5476 1` thiếu
 * hai số vẫn là chuỗi con của `10005476110` trên ảnh (tài khoản 10f75c6d
 * benchmark, đo 2026-09-15).
 */
function hasDigits(text: string, expected: string): boolean {
  if (!expected) return false;
  return new RegExp(`(?<!\\d)${expected.split("").join("\\s*")}(?!\\d)`).test(text);
}

/** Chỉ còn các từ chữ cái viết hoa không dấu, cách nhau một khoảng trắng. */
const letterWords = (s: string): string[] =>
  stripAccents(s).toUpperCase().replace(/[^A-Z]+/g, " ").trim().split(" ").filter(Boolean);

/**
 * Dòng có chứa đúng tên không: chuỗi chữ cái của tên nằm trong chuỗi chữ cái
 * của dòng, đúng từng ký tự, phần dư mỗi đầu tối đa 2 chữ cái. Bỏ khoảng
 * trắng khi so vì OCR hay dính từ: `TO THICAM HON` là `TO THI CAM HON`.
 * `VW NGUYEN THI NHIEU` khớp `NGUYEN THI NHIEU` (logo và biểu tượng bàn tay
 * đọc thành chữ), `NGUYEN THI NHIEU HOA` không khớp vì dư `HOA`.
 *
 * Riêng lời nhắn chuyển khoản app tự điền `<tên chủ tài khoản> chuyen tien`
 * (55/55 ảnh bộ nhãn 2026-09-14), nên tên nối liền `CHUYENTIEN` cũng tính:
 * nhãn "Nội dung:" đứng trước dài hơn 2 chữ cái.
 */
function lineHasName(line: string, expected: string): boolean {
  const letters = letterWords(line).join("");
  if (!expected || letters.length < expected.length) return false;
  if (letters.includes(expected + "CHUYENTIEN")) return true;
  for (let at = letters.indexOf(expected); at >= 0; at = letters.indexOf(expected, at + 1)) {
    if (at <= 2 && letters.length - at - expected.length <= 2) return true;
  }
  return false;
}

const AMOUNT = /\d[\d,.]*\s*VND/i;

/**
 * Chuyển khoản thành công. Cho dung sai ở "Chuyển thành công": ảnh chụp lại
 * đọc "Cuuyển thành công!" (bộ nhãn 2026-09-14). Màn "Lịch sử giao dịch"
 * không in chữ "thành công", số dư "SD:" sau mỗi dòng đã nói giao dịch chốt
 * sổ, nên tab đó kèm số tiền cũng tính (giữ từ bản trước, chốt 2026-09-16).
 */
function hasSuccess(lines: string[]): boolean {
  return (
    lines.some((l) => hasLabel(l, "CHUYENTHANHCONG")) ||
    hasPhrase(lines, "GIAODICHTHANHCONG") ||
    (hasPhrase(lines, "LICHSUGIAODICH") && lines.some((l) => AMOUNT.test(stripAccents(l))))
  );
}

export function tpbFacts(ocrText: string, ctx: TpbCheckContext): TpbFacts {
  const lines = splitLines(ocrText);
  const expectedName = letterWords(ctx.customerName).join("");
  const expectedCode = codeKey(ctx.referralCode);
  return {
    nameFound: lines.some((line) => lineHasName(line, expectedName)),
    accountFound: hasDigits(ocrText, digitsOf(ctx.accountNumber)),
    codeFound: Boolean(expectedCode) && lines.some((line) => codeTokens(line).some((t) => codeKey(t) === expectedCode)),
    successFound: hasSuccess(lines),
  };
}

/* ── Giá trị đọc được, chỉ để hiện cho người duyệt ───────────────────── */

export type TpbHints = {
  /** Dãy số dạng 4-4-3 đầu tiên, đã bỏ khoảng trắng. */
  accountNumber: string;
  /** Cụm 1-3 chữ cái rồi 2-5 chữ số đầu tiên, như `AT107`. */
  referralCode: string;
  /** Dòng chữ hoa ngay trên số tài khoản, hoặc tên trước "chuyen tien" ở lời nhắn. */
  customerName: string;
  /**
   * Số tiền ĐÚNG NHƯ OCR ĐỌC, ví dụ `52,000 VND`. Không đổi sang số: nền màn
   * TPBank có hoa văn sóng sát chữ số, Tesseract đọc nét cong đó thành `9` và
   * ra `952,000` cho ảnh in `52,000` (4/7 ảnh Android 2026-09-11).
   */
  amountText: string;
  /** Giờ chuyển, `YYYY-MM-DD HH:mm`. */
  transferredAt: string;
};

// Ranh giới là "không phải chữ số", không dùng `\b`: OCR hay dính `_` hay
// chữ vào đuôi số (`862_`), mà `_` là ký tự từ nên `\b` không khớp.
const ACCOUNT = /(?<!\d)\d{4} ?\d{4} ?\d{3}(?!\d)/;
const CODE_LIKE = /^[A-Z]{1,3}\d{2,5}$/;
const TRANSFERRED_AT = /(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})/;

export function tpbHints(ocrText: string): TpbHints {
  const lines = splitLines(ocrText);
  const plain = lines.map(stripAccents);
  const first = <T>(pick: (line: string) => T | undefined): T | undefined => {
    for (const line of plain) {
      const v = pick(line);
      if (v) return v;
    }
    return undefined;
  };

  const accountAt = plain.findIndex((l) => ACCOUNT.test(l));
  const accountNumber = accountAt >= 0 ? plain[accountAt].match(ACCOUNT)![0].replace(/\s/g, "") : "";
  const referralCode = first((l) => codeTokens(l).find((t) => CODE_LIKE.test(t))) ?? "";
  const amountText = first((l) => l.match(AMOUNT)?.[0].replace(/\s+/g, " ").toUpperCase()) ?? "";
  const stamp = first((l) => l.match(TRANSFERRED_AT));
  const transferredAt = stamp ? `${stamp[5]}-${stamp[4]}-${stamp[3]} ${stamp[1]}:${stamp[2]}` : "";

  // Tên trên màn hình chính nằm ngay trên số tài khoản; bỏ dòng "Xin chào" và
  // các dòng của thông báo đẩy: `TPBank Mobile`, `bây giờ`, `vừa xong` (đọc
  // thành `VUIA XONG`, tài khoản b937f9ba 2026-09-15).
  let customerName = "";
  for (let i = accountAt - 1; i >= 0 && i >= accountAt - 6 && !customerName; i--) {
    const words = letterWords(lines[i]).filter((word) => word.length >= 2 && !/(.)\1\1/.test(word));
    const joined = words.join("");
    if (/TPBANK|XINCHAO|BAYGI|XONG$/.test(joined)) continue;
    if (words.length >= 2 && joined.length >= 6) customerName = words.join(" ");
  }
  if (!customerName) {
    const m = first((l) => l.match(/^(?:.*?(?:noi dung|loi nhan)\s*:?\s*)?(.+?)\s+chuyen\s*tien\b/i));
    // Bỏ mảnh nhãn OCR đọc lẫn vào đầu tên: `dung Nguyen...`, `A Le Thi...`.
    const words = m ? letterWords(m[1]) : [];
    while (words.length && (words[0].length < 2 || /^(NOI|DUNG|LOI|NHAN)$/.test(words[0]))) words.shift();
    customerName = words.join(" ");
  }

  return { accountNumber, referralCode, customerName, amountText, transferredAt };
}

/* ── OCR ──────────────────────────────────────────────────────────────── */

/**
 * Màn hình chính chữ trắng nền tím, nhận bằng MÀU trước khi OCR để chọn cấu
 * hình đọc; đây là chọn cách đọc, không phải chọn cách chấm. `--psm 11` đọc
 * chữ rời rạc tốt hơn trên 96/112 ảnh so với 82/112 của `--psm 6`, nhưng có
 * screenshot nó tách `1000 5476 377` thành `10!` và `476377` còn `--psm 6`
 * đọc liền (đo 2026-09-14).
 */
const HOME_PROFILES: OcrProfile[] = [TPB_HOME_PROFILE, { ...TPB_HOME_PROFILE, psm: "6" }];

/**
 * Ảnh còn lại, theo thứ tự màn hay gặp: hai màn chữ tối nền sáng nhiều ảnh
 * nhất (`tpbLight`, 0,5 đến 0,7 giây), rồi màn chuyển khoản kênh đỏ (0,6
 * giây). Ba lượt sau là lượt cứu: cỡ gốc cho ảnh chụp sát màn hình có vân
 * lưới, `sharp` cho ảnh chụp mờ, `plain` + `negated` cho màn tím mà bước màu
 * không nhận ra. Số liệu từng lượt ở ghi chú các profile trong `image.ts`.
 */
const OTHER_PROFILES: OcrProfile[] = [
  TPB_LIGHT_PROFILE,
  TPB_TRANSFER_PROFILE,
  TPB_LIGHT_UNSCALED_PROFILE,
  { ...DEFAULT_PROFILE, passes: ["sharp"] },
  TPB_LIGHT_SHARP_PROFILE,
  { ...DEFAULT_PROFILE, passes: ["plain", "negated"] },
];

/**
 * Tờ giấy ghi tay nhân viên hay chụp kèm: mẫu in sẵn "Chủ tài khoản", "Tên
 * đăng nhập", "Số tài khoản", "Mật khẩu", "Mã PIN" cho nhiều ngân hàng. Không
 * màn TPBank nào có "Chủ tài khoản" hay "Mật khẩu" (0/317 ảnh màn app khớp
 * nhầm, đo 2026-09-15). Nhận ra rồi thì dừng sau lượt đầu: tờ giấy chữ nhỏ
 * dày đặc đi hết chuỗi lượt mất 30 giây (tài khoản 32acce88).
 */
const PAPER_LABELS = ["CHUTAIKHOAN", "MATKHAU"];

function looksLikePaperForm(text: string): boolean {
  const lines = splitLines(text);
  return PAPER_LABELS.some((label) => lines.some((line) => hasLabel(line, label)));
}

/**
 * Đọc một ảnh lần lượt theo danh sách profile. Ảnh đã góp được giá trị mà bộ
 * ảnh còn thiếu (`have`) thì đọc tiếp tới lượt đầu tiên không thêm gì rồi
 * dừng; ảnh chưa góp gì thì đi hết danh sách. Không dừng ngay lượt đầu thấy
 * giá trị: màn chuyển khoản qua lượt `tpbLight` đọc ra tên trong lời nhắn,
 * còn dòng "Chuyển thành công" xanh lá chỉ lượt kênh đỏ mới đọc được (3/60
 * tài khoản benchmark tụt mục chuyển khoản, đo 2026-09-16). Chữ các lượt nối
 * lại để phép kiểm và phần gợi ý cùng thấy.
 */
async function ocrTpbImage(image: Buffer, ctx: TpbCheckContext, have: TpbFacts): Promise<string> {
  const profiles = (await isTpbHomeScreen(image)) ? HOME_PROFILES : OTHER_PROFILES;
  let text = "";
  let seen = have;
  for (const profile of profiles) {
    text = `${text}\n${await ocrImage(image, profile)}`.trim();
    const now = mergeFacts(have, tpbFacts(text, ctx));
    if (allFound(now) || looksLikePaperForm(text)) break;
    if (!addsTo(seen, now) && addsTo(have, seen)) break;
    seen = now;
  }
  return text;
}

/**
 * Đọc từng ảnh tới khi bộ ảnh đủ bốn giá trị; ảnh còn lại không đọc, chuỗi
 * rỗng giữ chỗ để `photoIndex` vẫn đúng.
 */
export async function checkTpbankImages(images: Buffer[], ctx: TpbCheckContext): Promise<CheckedItem[]> {
  const texts: string[] = [];
  let have = NO_FACTS;
  for (const image of images) {
    if (allFound(have)) {
      texts.push("");
      continue;
    }
    const text = await ocrTpbImage(image, ctx, have);
    texts.push(text);
    have = mergeFacts(have, tpbFacts(text, ctx));
  }
  return checkTpbank(texts, ctx);
}

/* ── Chấm ─────────────────────────────────────────────────────────────── */

/**
 * Chấm trên chữ đã OCR, mỗi chuỗi một ảnh. Ba mục giữ đúng ba key `open` /
 * `home` / `transfer` mà giao diện và ngân hàng khác đang dùng, chỉ đổi nghĩa:
 * `open` = mã giới thiệu, `home` = tên và số tài khoản, `transfer` = chuyển
 * khoản thành công. Không còn verdict `missing`: không nhận màn thì không có
 * "thiếu ảnh màn X", mọi giá trị không thấy đều là `fail`.
 *
 * Ghi chú luôn kèm cả giá trị trên ảnh lẫn trong hệ thống để người duyệt tự
 * quyết bên nào sai: OCR đọc nhầm hay nhân viên nhập nhầm.
 */
export function checkTpbank(texts: string[], ctx: TpbCheckContext): CheckedItem[] {
  const facts = texts.map((text) => tpbFacts(text, ctx));
  const photoOf = (key: keyof TpbFacts): number | undefined => {
    const at = facts.findIndex((f) => f[key]);
    return at >= 0 ? at : undefined;
  };
  const hints = tpbHints(texts.join("\n"));
  const items: CheckedItem[] = [];

  // 1. Mã giới thiệu.
  {
    const photoIndex = photoOf("codeFound");
    const issues: string[] = [];
    let note = "";
    if (!ctx.referralCode) {
      note = "Mã đã chọn không có mã chữ, không so được.";
    } else if (photoIndex === undefined) {
      if (hints.referralCode) {
        issues.push("Mã giới thiệu không khớp");
        note = `Mã trên ảnh ${hints.referralCode}, mã đã chọn ${ctx.referralCode}.`;
      } else {
        issues.push("Không đọc được mã giới thiệu");
        note = "Không ảnh nào đọc được mã giới thiệu.";
      }
    }
    items.push({
      key: "open",
      verdict: issues.length ? "fail" : "pass",
      label: "Mã giới thiệu",
      issues,
      found: photoIndex !== undefined ? ctx.referralCode : hints.referralCode,
      expected: ctx.referralCode,
      note,
      photoIndex,
    });
  }

  // 2. Tên khách và số tài khoản.
  {
    const nameAt = photoOf("nameFound");
    const accountAt = photoOf("accountFound");
    const issues: string[] = [];
    const notes: string[] = [];
    const seenName = nameAt !== undefined ? letterWords(ctx.customerName).join(" ") : hints.customerName;
    const seenAccount = accountAt !== undefined ? digitsOf(ctx.accountNumber) : hints.accountNumber;
    if (nameAt === undefined) {
      if (hints.customerName) {
        issues.push("Tên khách hàng không khớp");
        notes.push(`Tên trên ảnh ${hints.customerName}, tên khách ${ctx.customerName}.`);
      } else {
        issues.push("Không đọc được tên khách hàng");
        notes.push("Không ảnh nào đọc được tên khách.");
      }
    }
    if (accountAt === undefined) {
      if (hints.accountNumber) {
        issues.push("Số tài khoản không khớp");
        notes.push(`Số tài khoản trên ảnh ${hints.accountNumber}, đã nhập ${ctx.accountNumber}.`);
      } else {
        issues.push("Không đọc được số tài khoản");
        notes.push("Không ảnh nào đọc được số tài khoản.");
      }
    }
    items.push({
      key: "home",
      verdict: issues.length ? "fail" : "pass",
      label: "Tên khách hàng và số tài khoản",
      issues,
      found: [seenName, seenAccount].filter(Boolean).join(" - "),
      expected: [ctx.customerName, ctx.accountNumber].filter(Boolean).join(" - "),
      note: notes.join(" "),
      photoIndex: nameAt ?? accountAt,
    });
  }

  // 3. Chuyển khoản thành công. Số tiền và giờ chỉ hiện, không chấm.
  {
    const photoIndex = photoOf("successFound");
    const issues = photoIndex === undefined ? ["Thiếu ảnh giao dịch thành công"] : [];
    items.push({
      key: "transfer",
      verdict: issues.length ? "fail" : "pass",
      label: "Giao dịch thành công",
      issues,
      found: photoIndex === undefined ? "" : [hints.amountText, hints.transferredAt].filter(Boolean).join(" - "),
      expected: "",
      note: issues.length ? "Không ảnh nào có dòng chuyển khoản thành công." : "",
      photoIndex,
    });
  }

  return items;
}
