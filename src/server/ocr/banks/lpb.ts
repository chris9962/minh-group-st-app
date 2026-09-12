import type { PhotoCheckItem } from "@/lib/api/photoCheck";
import { nameMatches } from "./tpbank";
import { compact, hasLabel, isoDate, levenshtein, pickField, splitLines, stripAccents, type FieldSpec } from "../text";

/**
 * Bộ nhãn LPBank đo trên 12 tài khoản hoàn thành trong dữ liệu local
 * 2026-09-12, mỗi tài khoản 7 ảnh. App LPBank không có nhãn "ảnh này là màn
 * gì" nên mỗi màn nhận ra bằng dấu hiệu riêng, không theo thứ tự nộp.
 */

/**
 * Giữ chuỗi tên, bỏ nhãn và rác OCR ở hai đầu — cùng luật với TPB/MSB, cộng
 * thêm nhận cả tên viết Hoa Chữ Đầu Mỗi Từ.
 *
 * Tên người giới thiệu LPBank không chỉ hiện IN HOA (`NGUYEN THỊ BẢO CHÂU`)
 * mà đo 50 tài khoản 2026-09-12 còn thấy dạng "Trần Thị Vân Anh" — tuỳ theo
 * chính tài khoản của người giới thiệu đó nhập tên lúc đăng ký. Nhãn tiếng
 * Việt xung quanh ("Chủ tài khoản", "Người giới thiệu của tôi") chỉ viết hoa
 * CHỮ ĐẦU CỦA CẢ CỤM chứ không viết hoa từng từ, nên lẫn nhiều nhất một từ lạ
 * — `nameMatches` gọi sau đó tự bỏ qua nhờ so khớp kiểu "chứa chuỗi con".
 */
function nameIn(line: string): string {
  const words = stripAccents(line).replace(/[^A-Za-z]+/g, " ").trim().split(" ");
  const kept = words.filter((word) => {
    if (word.length === 1) return /^[A-Z]$/.test(word);
    if (word.length < 2) return false;
    const uppercase = word.replace(/[^A-Z]/g, "").length;
    if (uppercase * 4 >= word.length * 3) return true;
    return /^[A-Z][a-z]+$/.test(word);
  });
  return kept.join(" ").trim();
}

const usableName = (s: string) => compact(s).length >= 4;
const digitsOf = (s: string) => s.replace(/\D/g, "");

/* ── Màn "Thông tin tài khoản" ────────────────────────────────────────── */

/**
 * Đầu màn hình, đo trên 12 tài khoản 2026-09-12:
 *
 *   Thông tin tài khoản
 *   Tài khoản thanh toán
 *   0942854815
 *   Chủ tài khoản SON THI NGOC SANG
 *   Ngày mở tài khoản: 08/09/2026
 *   Chi nhánh PGD LONG PHU
 *   Số dư hiện tại 0VND
 *
 * "Chi nhánh" không dùng để so — mọi mã giới thiệu LPBank trong hệ thống chưa
 * cấu hình chi nhánh cố định (`referral_codes.support_branch` rỗng), khác MSB.
 * Một phiếu ghi tay "Thông tin tài khoản: ..." (Ảnh 7, phiếu thông tin) cũng
 * chứa cụm này nhưng KHÔNG có nhãn "Chủ tài khoản"/"Ngày mở tài khoản", nên
 * dùng hai nhãn đó làm dấu hiệu thay vì cụm tiêu đề.
 */
export type LpbAccountInfo = {
  customerName: string;
  /** Số tài khoản thanh toán, LPBank dùng số điện thoại. */
  accountNumber: string;
  /** YYYY-MM-DD, rỗng khi không đọc được sạch cả 4 số của năm. */
  openedDate: string;
  /**
   * YYYY-MM-DD nhưng CHỮ SỐ CUỐI CỦA NĂM hoặc CẢ NGÀY có thể là `?` — đo trên
   * dữ liệu local 2026-09-12:
   *
   * - Chữ số `6` cuối năm "2026" một số ảnh bị Tesseract đọc thành chữ cái
   *   (`202é`, `202ó`) ở CẢ BA lượt đọc.
   * - Ngày "11" (hai chữ số `1` đứng liền) bị đọc hỏng gần như luôn luôn:
   *   `1/09/2026` (rớt một số), `TI/09/2026`, `M/09/2026` — đo cả lô tài
   *   khoản mở ngày 2026-09-11, không phải ảnh riêng lẻ bị lỗi.
   *
   * Tháng và ba số đầu của năm vẫn đọc đúng nên đủ để đối chiếu lỏng phần
   * hỏng, xem `looseDateMatches`.
   */
  openedDateLoose: string;
  missing: ("customerName" | "openedDate")[];
};

const ACCOUNT_NUMBER = /(?<!\d)0\d{8,10}(?!\d)/;

const OPENED_DATE_LABELS = ["NGAYMOTAIKHOAN", "NGAYMOTK"];

const OPENED_DATE: FieldSpec = {
  labels: OPENED_DATE_LABELS,
  value: /\d{2}\/\d{2}\/\d{4}/,
  clean: isoDate,
};

/**
 * Tháng phải là số thật, ba số đầu của năm phải là số thật. Ngày cho phép 1-2
 * ký tự bất kỳ (số hoặc chữ) — "11" là dãy hay bị đọc hỏng nhất, xem giải
 * thích ở `LpbAccountInfo.openedDateLoose`.
 */
const OPENED_DATE_LOOSE_VALUE = /([0-9A-Za-z]{1,2})\/(\d{2})\/(\d{3}[0-9A-Za-z])/;

function openedDateLooseIn(lines: string[]): string {
  for (const label of OPENED_DATE_LABELS) {
    for (const line of lines) {
      if (!hasLabel(line, label)) continue;
      const m = stripAccents(line).match(OPENED_DATE_LOOSE_VALUE);
      if (!m) continue;
      const [, dd, mm, year] = m;
      const day = /^\d{2}$/.test(dd) ? dd : "??";
      const yearLastDigit = /\d/.test(year[3]) ? year[3] : "?";
      return `${year.slice(0, 3)}${yearLastDigit}-${mm}-${day}`;
    }
  }
  return "";
}

/** So khớp lỏng: `?` trong `loose` khớp bất kỳ ký tự nào ở đúng vị trí đó. */
export function looseDateMatches(loose: string, expected: string): boolean {
  if (!loose || !expected || loose.length !== expected.length) return false;
  for (let i = 0; i < loose.length; i++) {
    if (loose[i] === "?") continue;
    if (loose[i] !== expected[i]) return false;
  }
  return true;
}

/**
 * Bỏ đúng cụm nhãn "Chủ tài khoản" trước khi tách tên.
 *
 * Nhãn này chỉ viết hoa CHỮ ĐẦU CỦA CỤM ("Chủ"), còn "tài"/"khoản" viết
 * thường — nếu tên đứng sau CŨNG viết Hoa Chữ Đầu Mỗi Từ (xem `nameIn`) thì
 * riêng chữ "Chủ" trông giống hệt một từ của tên, `nameIn` không tự phân biệt
 * được. Bỏ nhãn bằng cụm cố định trước, đỡ phải suy đoán qua hoa/thường.
 */
const CHU_TAI_KHOAN_LABEL = /chu\s+tai\s+khoan[.,:]?\s*/i;

function accountInfoNameIn(lines: string[]): string {
  for (const line of lines) {
    if (!hasLabel(line, "CHUTAIKHOAN")) continue;
    const withoutLabel = stripAccents(line).replace(CHU_TAI_KHOAN_LABEL, "");
    const candidate = nameIn(withoutLabel);
    if (usableName(candidate)) return candidate;
  }
  return "";
}

export function parseLpbAccountInfo(ocrText: string): LpbAccountInfo {
  const lines = splitLines(ocrText);

  const customerName = accountInfoNameIn(lines);
  const openedDate = pickField(lines, OPENED_DATE);
  const openedDateLoose = openedDate || openedDateLooseIn(lines);

  let accountNumber = "";
  for (const line of lines) {
    const m = stripAccents(line).match(ACCOUNT_NUMBER);
    if (m) {
      accountNumber = m[0];
      break;
    }
  }

  const out: LpbAccountInfo = { customerName, accountNumber, openedDate, openedDateLoose, missing: [] };
  if (!customerName) out.missing.push("customerName");
  if (!openedDateLoose) out.missing.push("openedDate");
  return out;
}

/* ── Màn "Giới thiệu bạn bè" hoặc bước "Đăng ký dịch vụ" ──────────────── */

/**
 * Hai biến thể đều in số của NGƯỜI GIỚI THIỆU ngay sau một nhãn, đo trên 12
 * tài khoản 2026-09-12:
 *
 * Biến thể 1, tab "Giới thiệu bạn bè" trong app, xem lại được sau khi đã mở
 * tài khoản:
 *
 *   Giới thiệu bạn bè
 *   Mã giới thiệu: 0942854815        mã CỦA CHÍNH khách, không phải mã cần so
 *   Người giới thiệu của tôi
 *   Mã giới thiệu 0777706075         mã người đã giới thiệu — LẤY DÒNG NÀY
 *   LƯƠNG THỊ NGỌC ANH
 *
 * Biến thể 2, bước nhập lúc đăng ký, trước khi hoàn tất:
 *
 *   Đăng ký dịch vụ
 *   Số điện thoại
 *   0942854815
 *   Thông tin người giới thiệu (nếu có)
 *   0777706075
 *   LƯƠNG THỊ NGỌC ANH
 *
 * Cả hai đều có SỐ CỦA CHÍNH KHÁCH đứng trước nhãn — bắt đầu tìm từ SAU nhãn
 * để không lấy nhầm mã tự giới thiệu của chính khách.
 */
export type LpbReferral = {
  /** Có nhận ra một trong hai màn trên không. */
  recognized: boolean;
  referralCode: string;
  referralName: string;
  missing: ("recognized" | "referralCode")[];
};

/**
 * 9-11 số: số điện thoại thật luôn 10 số, nhưng đo 50 tài khoản 2026-09-12
 * thấy Tesseract thỉnh thoảng thêm/rớt một số (`09165835757` cho số thật
 * `0916383757`). Bắt rộng hơn 10 số đúng rồi để phần so khớp ở `checkLpb` tự
 * quyết định đủ gần hay không, không bắt buộc đếm đúng 10 số ở bước đọc.
 */
const PHONE = /(?<!\d)0\d{8,10}(?!\d)/;

export function parseLpbReferral(ocrText: string): LpbReferral {
  const lines = splitLines(ocrText);

  let at = -1;
  for (const label of ["NGUOIGIOITHIEUCUATOI", "THONGTINNGUOIGIOITHIEU"]) {
    at = lines.findIndex((line) => hasLabel(line, label));
    if (at >= 0) break;
  }

  let referralCode = "";
  let referralName = "";
  if (at >= 0) {
    for (let i = at + 1; i < Math.min(lines.length, at + 4); i++) {
      const plain = stripAccents(lines[i]);
      if (!referralCode) {
        const m = plain.match(PHONE);
        if (m) {
          referralCode = m[0];
          continue;
        }
      }
      if (referralCode && !referralName) {
        const candidate = nameIn(lines[i]);
        if (usableName(candidate)) referralName = candidate;
      }
    }
  }

  const out: LpbReferral = { recognized: at >= 0, referralCode, referralName, missing: [] };
  if (!out.recognized) out.missing.push("recognized");
  if (!referralCode) out.missing.push("referralCode");
  return out;
}

/* ── Màn giao dịch thành công ─────────────────────────────────────────── */

/**
 * Hai biến thể, đo trên 12 tài khoản 2026-09-12:
 *
 * Biến thể 1, màn kết quả chuyển khoản:
 *
 *   LPBank
 *   Chuyển tiền thành công
 *   100,000
 *   Tới tài khoản
 *   TRAN THI THU HA
 *   ...
 *   Nội dung
 *   DUONG THI UT chuyen tien
 *
 * Biến thể 2, thông báo đẩy "Biến động số dư" chồng lên màn khác:
 *
 *   Biến động số dư.
 *   Số tiền GD: -100,000 VND
 *   Tài khoản: 0942854815 10:26
 *
 * Không cần đọc số tiền hay người nhận để kiểm — chỉ cần "có thông tin giao
 * dịch thành công" (yêu cầu nghiệp vụ), giống cách MSB đang làm.
 */
export type LpbTransfer = {
  success: boolean;
};

export function parseLpbTransfer(ocrText: string): LpbTransfer {
  const lines = splitLines(ocrText);
  const success =
    lines.some((l) => hasLabel(l, "CHUYENTIENTHANHCONG")) || lines.some((l) => hasLabel(l, "BIENDONGSODU"));
  return { success };
}

/* ── Ba phép kiểm cho một tài khoản ───────────────────────────────────── */

export type LpbCheckContext = {
  /** `referral_codes.code` — LPBank dùng số điện thoại người giới thiệu. */
  referralCode: string;
  /** `referral_codes.display_name` — tên người giới thiệu, dùng để đối chiếu khi số bị OCR đọc lệch. */
  referralName: string;
  /** `customers.full_name`. */
  customerName: string;
  /** `bank_accounts.opened_date`, YYYY-MM-DD. `''` = chưa có. */
  openedDate: string;
};

/**
 * Mã trên ảnh có coi là khớp mã đã chọn không.
 *
 * Khớp CHÍNH XÁC là đủ. Sai vài số chỉ chấp nhận khi TÊN người giới thiệu
 * trên ảnh cũng khớp tên đã cấu hình cho đúng mã đó — hai người giới thiệu
 * khác nhau trùng cả tên lẫn số điện thoại gần giống nhau không xảy ra trong
 * thực tế, nên corroborate bằng tên không vi phạm luật "không so khớp mã quá
 * lỏng" (mục 6). Không có tên để đối chiếu thì giữ nguyên khớp chính xác.
 *
 * Số điện thoại 10 số, đo 50 tài khoản 2026-09-12 thấy Tesseract đọc lẫn tối
 * đa 2-3 số một dãy (`0916585757` cho `0916383757`, có lúc dư hẳn một số).
 * Dùng Levenshtein thay vì so từng vị trí để bắt được cả trường hợp dư/thiếu
 * số, ngưỡng 2 — quá ngưỡng đó độ tin cậy giảm hẳn, để lại cho người duyệt.
 */
function referralCodeMatches(found: string, expected: string, foundName: string, expectedName: string): boolean {
  const foundDigits = digitsOf(found);
  const expectedDigits = digitsOf(expected);
  if (foundDigits === expectedDigits) return true;
  const corroboratedByName = Boolean(foundName) && Boolean(expectedName) && nameMatches(foundName, expectedName);
  return corroboratedByName && levenshtein(foundDigits, expectedDigits) <= 2;
}

/**
 * Chạy cả ba parser trên mọi ảnh, mỗi phép kiểm lấy ảnh nhận ra rõ nhất.
 *
 * Bộ ảnh có thể lẫn ảnh chụp nhầm của khách khác (đủ 7 ảnh không đồng nghĩa
 * đúng cả 7 ảnh của người này) — ưu tiên ảnh có dữ liệu KHỚP với tài khoản
 * đang kiểm, chỉ rơi về "ít trường thiếu nhất" khi không ảnh nào khớp.
 */
export function checkLpb(texts: string[], ctx: LpbCheckContext): PhotoCheckItem[] {
  const best = <T extends { missing: unknown[] }>(rs: T[]): T | undefined =>
    rs.sort((a, b) => a.missing.length - b.missing.length)[0];

  const infos = texts.map(parseLpbAccountInfo).filter((r) => r.customerName || r.openedDateLoose);
  const referrals = texts.map(parseLpbReferral).filter((r) => r.recognized);
  const transfer = texts.map(parseLpbTransfer).find((r) => r.success);

  const info =
    infos.find((r) => r.customerName && nameMatches(r.customerName, ctx.customerName)) ?? best(infos);
  const referral =
    referrals.find(
      (r) => r.referralCode && referralCodeMatches(r.referralCode, ctx.referralCode, r.referralName, ctx.referralName),
    ) ?? best(referrals);

  const items: PhotoCheckItem[] = [];

  // 1. Ảnh "Giới thiệu bạn bè": mã giới thiệu.
  if (!referral) {
    items.push({
      key: "open",
      verdict: "missing",
      label: "Mã giới thiệu",
      issues: ["Thiếu ảnh xác thực mã giới thiệu"],
      found: "",
      expected: ctx.referralCode,
      note: "Không ảnh nào là màn giới thiệu bạn bè hoặc bước nhập mã giới thiệu.",
    });
  } else {
    const notes: string[] = [];
    const issues: string[] = [];
    if (!referral.referralCode) {
      notes.push("Không đọc được mã giới thiệu.");
      issues.push("Không đọc được mã giới thiệu");
    } else if (
      ctx.referralCode &&
      !referralCodeMatches(referral.referralCode, ctx.referralCode, referral.referralName, ctx.referralName)
    ) {
      notes.push(`Mã trên ảnh ${referral.referralCode}, mã đã chọn ${ctx.referralCode}.`);
      issues.push("Mã giới thiệu không khớp");
    }
    items.push({
      key: "open",
      verdict: notes.length ? "fail" : "pass",
      label: "Mã giới thiệu",
      issues,
      found: [referral.referralCode, referral.referralName].filter(Boolean).join(" - "),
      expected: ctx.referralCode,
      note: notes.join(" "),
    });
  }

  // 2. Ảnh "Thông tin tài khoản": tên khách và ngày mở tài khoản.
  if (!info) {
    items.push({
      key: "home",
      verdict: "missing",
      label: "Tên khách hàng và ngày mở tài khoản",
      issues: ["Thiếu ảnh xác thực tên khách hàng và ngày mở tài khoản"],
      found: "",
      expected: [ctx.customerName, ctx.openedDate].filter(Boolean).join(" - "),
      note: "Không ảnh nào là màn thông tin tài khoản.",
    });
  } else {
    const notes: string[] = [];
    const issues: string[] = [];
    if (!info.customerName) {
      notes.push("Không đọc được tên khách.");
      issues.push("Không đọc được tên khách hàng");
    } else if (!nameMatches(info.customerName, ctx.customerName)) {
      notes.push(`Tên trên ảnh ${info.customerName}, tên khách ${ctx.customerName}.`);
      issues.push("Tên khách hàng không khớp");
    }
    if (!info.openedDateLoose) {
      notes.push("Không đọc được ngày mở tài khoản.");
      issues.push("Không đọc được ngày mở tài khoản");
    } else if (ctx.openedDate) {
      const matches = info.openedDate
        ? info.openedDate === ctx.openedDate
        : looseDateMatches(info.openedDateLoose, ctx.openedDate);
      if (!matches) {
        notes.push(`Ngày mở trên ảnh ${info.openedDate || info.openedDateLoose}, hệ thống ghi ${ctx.openedDate}.`);
        issues.push("Ngày mở tài khoản không khớp");
      }
    }
    items.push({
      key: "home",
      verdict: notes.length ? "fail" : "pass",
      label: "Tên khách hàng và ngày mở tài khoản",
      issues,
      found: [info.customerName, info.openedDate || info.openedDateLoose].filter(Boolean).join(" - "),
      expected: [ctx.customerName, ctx.openedDate].filter(Boolean).join(" - "),
      note: notes.join(" "),
    });
  }

  // 3. Ảnh giao dịch thành công: chỉ cần có thông tin giao dịch, không so trường nào.
  items.push(
    transfer
      ? {
          key: "transfer",
          verdict: "pass",
          label: "Giao dịch thành công",
          issues: [],
          found: "Có thông tin giao dịch thành công",
          expected: "",
          note: "",
        }
      : {
          key: "transfer",
          verdict: "missing",
          label: "Giao dịch thành công",
          issues: ["Thiếu ảnh giao dịch thành công"],
          found: "",
          expected: "",
          note: "Không ảnh nào có thông tin giao dịch LPBank thành công.",
        },
  );

  return items;
}
