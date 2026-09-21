import { compact, hasLabel, hasPhrase, splitLines, stripAccents } from "../text";
import { ocrLines } from "../reader";
import type { CheckedItem } from "../types";

/**
 * Kiểm ảnh TPBank, chốt 2026-09-19: trong bộ ảnh của một tài khoản phải thấy
 * đủ BỐN giá trị, ở ảnh nào cũng được, không cần biết ảnh là màn nào:
 *
 *   1. tên khách                 đúng từng chữ cái sau khi bỏ dấu
 *   2. số tài khoản              đúng từng chữ số, trọn dãy
 *   3. mã giới thiệu             đúng từng ký tự sau khi gộp O/0, I/1, S/5, B/8, Z/2
 *   4. chuyển khoản thành công   có dòng "Chuyển thành công" hoặc "Giao dịch thành công"
 *
 * Không trích giá trị trên ảnh để hiện: bản trước đoán "dòng chữ hoa gần số
 * tài khoản nhất" là tên, gặp màn mở tài khoản thì lấy nhầm nhãn "Số tài khoản
 * thanh toán" và người duyệt đọc thấy "TAI KHOAN THANH TODN" (tài khoản
 * 5e237733, 2026-09-18). Không thấy thì chỉ nói "không tìm thấy X trong ảnh",
 * người duyệt mở ảnh xem. Không dung sai: nhân viên gõ sai một chữ số cũng
 * phải bị bắt (chốt 2026-09-14).
 *
 * Chữ do `reader.ts` đọc một lượt, không tiền xử lý, không nhận màn. Bản
 * trước chọn cấu hình Tesseract theo màn; ảnh chụp lại đọc rác ở lượt đầu thì
 * rẽ nhầm nhánh và không bao giờ chạy lượt đọc được mã (tài khoản 43aebf7e,
 * 2026-09-17).
 */

export type TpbCheckContext = {
  /** `referral_codes.code` của mã đã chọn. `''` = mã QR-only, không so được. */
  referralCode: string;
  /** `customers.full_name`. */
  customerName: string;
  /** `bank_accounts.account_number` nhân viên nhập lúc hoàn thành. `''` = chưa có. */
  accountNumber: string;
};

/* ── Bốn phép tìm ─────────────────────────────────────────────────────── */

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
 * Lời nhắn chuyển khoản do app tự điền `<tên chủ tài khoản> chuyen tien`
 * (55/55 ảnh bộ nhãn 2026-09-14), nên tên nối liền `CHUYENTIEN` cũng tính;
 * nhãn "Nội dung:" đứng trước dài hơn 2 chữ cái nên phải so riêng.
 */
function lineHasName(line: string, expected: string): boolean {
  if (!expected) return false;
  const letters = letterWords(line).join("");
  if (letters.includes(expected + "CHUYENTIEN")) return true;
  if (letters.length < expected.length) return false;
  for (let at = letters.indexOf(expected); at >= 0; at = letters.indexOf(expected, at + 1)) {
    if (at <= 2 && letters.length - at - expected.length <= 2) return true;
  }
  return false;
}

/**
 * Dãy số hệ thống có trong chữ OCR không: đúng từng chữ số và TRỌN dãy, trước
 * và sau không còn chữ số. Cho khoảng trắng hay xuống dòng giữa các chữ số vì
 * màn hình chính in `1000 5476 110`.
 *
 * Không so trên chuỗi chữ số của cả ảnh: nhân viên nhập `1000 5476 1` thiếu
 * hai số vẫn là chuỗi con của `10005476110` trên ảnh và đạt nhầm (tài khoản
 * 10f75c6d, đo 2026-09-15).
 */
function hasDigits(text: string, expected: string): boolean {
  if (!expected) return false;
  return new RegExp(`(?<!\\d)${expected.split("").join("\\s*")}(?!\\d)`).test(text);
}

/**
 * Mã giới thiệu so sau khi bỏ dấu, viết hoa, và gộp ký tự dễ nhầm: `O`/`0`,
 * `I`/`1`, `S`/`5`, `B`/`8`, `Z`/`2`. Không cho sai ký tự: `AT105` và `AT106`
 * là hai mã của hai người, sai một ký tự là sai người.
 */
const codeKey = (s: string) =>
  compact(s).replace(/O/g, "0").replace(/I/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");

/**
 * Token chữ-số của một dòng, kèm mỗi cặp token liền nhau ghép lại: OCR đọc
 * `AT107` trên ảnh chụp lại thành `ATI 07`, ghép hai token là ra mã, còn `I`
 * thì `codeKey` đã gộp với `1`.
 */
function codeTokens(line: string): string[] {
  const tokens = stripAccents(line).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  return tokens.concat(tokens.slice(1).map((next, i) => tokens[i] + next));
}

const AMOUNT = /\d[\d,.]*\s*VND/i;

/**
 * Chuyển khoản thành công. `hasLabel` có dung sai vì ảnh chụp lại đọc
 * "Cuuyển thành công". So cả hai dòng liền nhau ghép lại: bộ dò vùng có khi
 * tách tiêu đề thành "Chuyển" và "thành công" (tài khoản 1df07195, 2026-09-19).
 * Màn "Lịch sử giao dịch" không in chữ "thành công", số dư "SD:" sau mỗi dòng
 * đã nói giao dịch chốt sổ, nên tab đó kèm dòng tiền cũng tính (chốt 2026-09-16).
 */
function hasSuccess(lines: string[]): boolean {
  const joined = lines.concat(lines.slice(1).map((next, i) => `${lines[i]} ${next}`));
  if (joined.some((l) => hasLabel(l, "CHUYENTHANHCONG"))) return true;
  if (hasPhrase(joined, "GIAODICHTHANHCONG")) return true;
  return hasPhrase(lines, "LICHSUGIAODICH") && lines.some((l) => AMOUNT.test(stripAccents(l)));
}

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

/** Bốn giá trị hệ thống có trong chữ của MỘT ảnh không. */
export function tpbFacts(ocrText: string, ctx: TpbCheckContext): TpbFacts {
  const lines = splitLines(ocrText);
  const expectedName = letterWords(ctx.customerName).join("");
  const expectedCode = codeKey(ctx.referralCode);
  return {
    nameFound: lines.some((line) => lineHasName(line, expectedName)),
    accountFound: hasDigits(ocrText, ctx.accountNumber.replace(/\D/g, "")),
    codeFound: Boolean(expectedCode) && lines.some((line) => codeTokens(line).some((t) => codeKey(t) === expectedCode)),
    successFound: hasSuccess(lines),
  };
}

/* ── Đọc rồi chấm ─────────────────────────────────────────────────────── */

/**
 * Đọc từng ảnh cho tới khi cả bộ đủ bốn giá trị; ảnh còn lại không đọc,
 * chuỗi rỗng giữ chỗ để `photoIndex` vẫn đúng.
 */
export async function checkTpbankImages(images: Buffer[], ctx: TpbCheckContext): Promise<CheckedItem[]> {
  const texts: string[] = [];
  let have = NO_FACTS;
  for (const image of images) {
    if (allFound(have)) {
      texts.push("");
      continue;
    }
    const text = (await ocrLines(image)).join("\n");
    texts.push(text);
    have = mergeFacts(have, tpbFacts(text, ctx));
  }
  return checkTpbank(texts, ctx);
}

/**
 * Chấm trên chữ đã OCR, mỗi chuỗi một ảnh; hàm thuần để benchmark chạy trên
 * chữ cache. Ba mục giữ ba key `open` / `home` / `transfer` mà giao diện và
 * ngân hàng khác đang dùng: `open` = mã giới thiệu, `home` = tên và số tài
 * khoản, `transfer` = chuyển khoản thành công. `found` luôn rỗng: không đoán
 * giá trị trên ảnh. `expected` là giá trị hệ thống để người duyệt biết phải
 * tìm gì khi mở ảnh.
 */
export function checkTpbank(texts: string[], ctx: TpbCheckContext): CheckedItem[] {
  const facts = texts.map((text) => tpbFacts(text, ctx));
  const photoOf = (key: keyof TpbFacts): number | undefined => {
    const at = facts.findIndex((f) => f[key]);
    return at >= 0 ? at : undefined;
  };
  const item = (
    key: CheckedItem["key"],
    label: string,
    expected: string,
    photoIndex: number | undefined,
    issues: string[],
    note: string,
  ): CheckedItem => ({
    key,
    verdict: issues.length ? "fail" : "pass",
    label,
    issues,
    found: "",
    expected,
    note,
    photoIndex,
  });

  const codeAt = photoOf("codeFound");
  const nameAt = photoOf("nameFound");
  const accountAt = photoOf("accountFound");
  const successAt = photoOf("successFound");

  const homeIssues: string[] = [];
  const homeNotes: string[] = [];
  if (nameAt === undefined) {
    homeIssues.push("Không tìm thấy tên khách hàng");
    homeNotes.push(`Không tìm thấy tên ${ctx.customerName} trong ảnh.`);
  }
  if (accountAt === undefined) {
    homeIssues.push("Không tìm thấy số tài khoản");
    homeNotes.push(`Không tìm thấy số tài khoản ${ctx.accountNumber} trong ảnh.`);
  }

  return [
    !ctx.referralCode
      ? item("open", "Mã giới thiệu", "", undefined, [], "Mã đã chọn không có mã chữ, không so được.")
      : item(
          "open",
          "Mã giới thiệu",
          ctx.referralCode,
          codeAt,
          codeAt === undefined ? ["Không tìm thấy mã giới thiệu"] : [],
          codeAt === undefined ? `Không tìm thấy mã ${ctx.referralCode} trong ảnh.` : "",
        ),
    item(
      "home",
      "Tên khách hàng và số tài khoản",
      [ctx.customerName, ctx.accountNumber].filter(Boolean).join(" - "),
      nameAt ?? accountAt,
      homeIssues,
      homeNotes.join(" "),
    ),
    item(
      "transfer",
      "Giao dịch thành công",
      "",
      successAt,
      successAt === undefined ? ["Thiếu ảnh giao dịch thành công"] : [],
      successAt === undefined ? "Không ảnh nào có dòng chuyển khoản thành công." : "",
    ),
  ];
}
