import { nameMatches } from "./tpbank";
import { compact, hasLabel, levenshtein, splitLines, stripAccents } from "../text";
import { indexed, type CheckedItem } from "../types";

/**
 * Bộ nhãn MB khảo sát trên 10 tài khoản hoàn thành trong dữ liệu local.
 * Ảnh thường là bước đăng ký có Mã RM, hồ sơ có User ID, và lịch sử giao dịch
 * có dòng tiền đã ghi nhận. Ảnh có thể nộp sai nhóm hoặc kèm màn không liên
 * quan như hủy Digital OTP, nên mỗi màn tự nhận bằng nội dung.
 */

export type MbCheckContext = {
  referralCode: string;
  referralName: string;
  province: string;
  supportBranch: string;
  customerName: string;
  accountNumber: string;
};

export type MbRegistration = {
  registration: boolean;
  referralCode: string;
  province: string;
  branch: string;
  missing: ("referralCode" | "province" | "branch")[];
};

const REFERRAL_CODE = /(?<![A-Z0-9])(?:[A-Z]{1,2}[0-9OI]{2,4}|[A-Z]{4,5})(?![A-Z0-9])/g;
const BRANCH = /\b(?:PGD|CN|SMB)\s+[\p{L}\s]{3,30}/iu;
const ACCOUNT_NUMBER = /(?<!\d)0\d{8,11}(?!\d)/;

const clean = (value: string): string =>
  value.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N})]+$/u, "").replace(/\s+/g, " ").trim();

const isReferralLabel = (line: string): boolean =>
  hasLabel(line, "MANGUOIGIOITHIEU") && (hasLabel(line, "MARM") || compact(line).includes("MANGUOIGIOITHIEU"));

function referralIn(lines: string[], expected = ""): string {
  const candidates: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isReferralLabel(lines[i])) continue;
    const tail = stripAccents(lines[i]).toUpperCase().split(/RM\s*[)\]}]?/).at(-1) ?? "";
    for (const line of [tail, ...lines.slice(i + 1, i + 4)]) {
      if (hasLabel(line, "HOVATEN") || hasLabel(line, "CHINHANHCHAMSOC")) break;
      for (const candidate of stripAccents(line).toUpperCase().match(REFERRAL_CODE) ?? []) {
        if (!["NHAN", "VIEN", "KHAC"].includes(candidate)) candidates.push(candidate);
      }
    }
  }
  // Mã số-chữ có thể mất nét ở lượt OCR đầu nhưng hiện rõ ở lượt kênh đỏ;
  // ưu tiên mã có chữ số, vẫn giữ mã toàn chữ MGST khi đó là mẫu duy nhất.
  return candidates.find((value) => expected && codeKey(value) === codeKey(expected)) ??
    candidates.find((value) => /\d/.test(value) && (!expected || value.length === expected.length)) ??
    candidates.find((value) => /\d/.test(value)) ?? candidates[0] ?? "";
}

const placeWords = (line: string): string =>
  stripAccents(line).replace(/[^A-Za-z\s]/g, " ").split(/\s+/).filter((word) => word.length >= 2).join(" ");

function provinceIn(lines: string[], expected = ""): string {
  const candidates: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!hasLabel(lines[i], "CHONTINHTHANHPHO")) continue;
    for (const line of lines.slice(i + 1, i + 4)) {
      if (hasLabel(line, "CHONCHINHANHHOTRO")) break;
      const value = placeWords(line.replace(/^\s*(?:Tỉnh|Thành phố)\s+/iu, ""));
      if (compact(value).length >= 5) candidates.push(value);
    }
  }
  // Tesseract đọc ba lượt; lượt đầu có thể thêm rác trước tên tỉnh ("si Đồng
  // Tháp"), còn lượt sau sạch. Giá trị ngắn nhất thường là ô đã chọn.
  return candidates.find((value) => expected && compact(value) === compact(expected)) ??
    candidates.find((value) => expected && placeMatches(value, expected)) ??
    candidates.sort((a, b) => compact(a).length - compact(b).length)[0] ?? "";
}

function branchIn(lines: string[], expected = ""): string {
  const candidates: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!hasLabel(lines[i], "CHONCHINHANHHOTRO") && !hasLabel(lines[i], "CHONTINHTHANHPHO")) continue;
    for (const line of lines.slice(i + 1, i + 8)) {
      const plain = stripAccents(line).replace(/\b(CN|PGD|SMB)(?=[A-Z]{2})/gi, "$1 ");
      const match = plain.match(BRANCH);
      if (match) {
        const value = clean(match[0]);
        if (value.split(" ").length >= 3) candidates.push(value);
      }
      if (hasLabel(line, "TIEPTUC") || hasLabel(line, "DANGKYTAIKHOAN")) break;
    }
  }
  return candidates.find((value) => expected && compact(value) === compact(expected)) ??
    candidates.find((value) => expected && branchMatches(value, expected)) ??
    candidates.sort((a, b) => compact(a).length - compact(b).length)[0] ?? "";
}

export function parseMbRegistration(
  text: string,
  expected: Pick<MbCheckContext, "referralName" | "province" | "supportBranch"> | null = null,
): MbRegistration {
  const lines = splitLines(text);
  const registration =
    lines.some((line) => hasLabel(line, "DANGKYTAIKHOAN")) &&
    lines.some(isReferralLabel) &&
    lines.some((line) => hasLabel(line, "CHONTINHTHANHPHO"));
  const referralCode = registration ? referralIn(lines, expected?.referralName.match(/^[A-Z0-9]{4,6}/i)?.[0]) : "";
  const province = registration ? provinceIn(lines, expected?.province) : "";
  const branch = registration ? branchIn(lines, expected?.supportBranch) : "";
  const out: MbRegistration = { registration, referralCode, province, branch, missing: [] };
  if (!referralCode) out.missing.push("referralCode");
  if (!province) out.missing.push("province");
  if (!branch) out.missing.push("branch");
  return out;
}

export type MbProfile = {
  profile: boolean;
  customerName: string;
  userId: string;
  missing: ("customerName" | "userId")[];
};

/** Tên đứng ngay trên User ID, không lấy chữ ở khu vực chức năng bên dưới. */
function nameBefore(lines: string[], at: number): string {
  for (let i = at - 1; i >= Math.max(0, at - 4); i--) {
    const line = stripAccents(lines[i]);
    const candidate = clean(line.replace(/[^A-Za-z\s]/g, " "));
    if (candidate.split(" ").length < 2 || compact(candidate).length < 6) continue;
    if (hasLabel(candidate, "HOSONGUOIDUNG") || hasLabel(candidate, "GOIHOIVIEN")) continue;
    const letters = candidate.replace(/[^A-Za-z]/g, "");
    const capitals = letters.replace(/[^A-Z]/g, "");
    if (capitals.length * 4 >= letters.length * 3) return candidate;
  }
  return "";
}

export function parseMbProfile(text: string): MbProfile {
  const lines = splitLines(text);
  const profile = lines.some((line) => hasLabel(line, "HOSONGUOIDUNG"));
  let customerName = "";
  let userId = "";
  if (profile) {
    for (let i = 0; i < lines.length; i++) {
      const line = stripAccents(lines[i]);
      if (!hasLabel(line, "USERID")) continue;
      const number = line.match(/USER\s*ID\s*[:：]?\s*(0\d{8,11})/i)?.[1] ??
        lines[i + 1]?.match(ACCOUNT_NUMBER)?.[0] ?? "";
      const name = nameBefore(lines, i);
      if (number && name) { userId = number; customerName = name; break; }
      userId ||= number;
      customerName ||= name;
    }
  }
  const out: MbProfile = { profile, customerName, userId, missing: [] };
  if (!customerName) out.missing.push("customerName");
  if (!userId) out.missing.push("userId");
  return out;
}

export type MbTransfer = {
  kind: "success" | "history" | "balance-notice" | "";
  success: boolean;
  amount: string;
};

/** Chỉ giao dịch tiền đã ghi nhận; "hủy Digital OTP thành công" không đạt. */
export function parseMbTransfer(text: string): MbTransfer {
  const lines = splitLines(text);
  const plain = stripAccents(text).toUpperCase();
  const outgoing = plain.match(/TIEN\s*RA\s*([-~]\s*\d[\d.,]*\s*VND)/)?.[1]?.trim() ?? "";
  const amount = outgoing || plain.match(/(?:[-+]\s*)?\d[\d.,]*\s*VND/)?.[0]?.trim() || "";
  const direct =
    /(?:CHUYEN\s*TIEN|GIAO\s*DICH)\s*THANH\s*CONG/.test(plain) &&
    /\bMB\b|APPMB|MBCT/.test(plain) && Boolean(amount);
  const history =
    (lines.some((line) => hasLabel(line, "TRUYVANGIAODICH") || hasLabel(line, "TRUYVONGIAODICH")) ||
      plain.includes("LICH SU GIAO DICH")) &&
    /TIEN\s*RA\s*[-~]\s*\d[\d.,]*\s*VND/.test(plain);
  const balanceNotice =
    lines.some((line) => hasLabel(line, "THONGBAOBIENDONGSODU")) &&
    /\bTK\s*0\d*x+\d+/i.test(plain) &&
    /\bGD\s*:\s*-\s*\d[\d.,]*\s*VND/.test(plain) &&
    /\bSD\s*:/.test(plain);
  const kind = direct ? "success" : history ? "history" : balanceNotice ? "balance-notice" : "";
  return { kind, success: Boolean(kind), amount: kind ? amount : "" };
}

const expectedReferral = (ctx: MbCheckContext): string =>
  (ctx.referralName || ctx.referralCode).trim().match(/^[A-Z0-9]{4,6}/i)?.[0] ?? "";

/** Chỉ chuẩn hóa O/0 và I/1 — hai ký tự OCR dễ lẫn ở mã MB. */
const codeKey = (value: string): string => compact(value).replace(/O/g, "0").replace(/I/g, "1");

function placeMatches(found: string, expected: string): boolean {
  const a = compact(found);
  const b = compact(expected);
  return Boolean(a && b) && (a === b || (b.length >= 7 && levenshtein(a, b) <= 1));
}

const branchMatches = (found: string, expected: string): boolean =>
  placeMatches(found.replace(/^\s*(?:CHI\s*NHANH|PHONG\s*GIAO\s*DICH)/i, "CN"), expected);

export function checkMb(texts: string[], ctx: MbCheckContext): CheckedItem[] {
  const referral = expectedReferral(ctx);
  const registrations = indexed(texts, (text) => parseMbRegistration(text, ctx)).filter((value) => value.registration);
  const profiles = indexed(texts, parseMbProfile).filter((value) => value.profile);
  const transfers = indexed(texts, parseMbTransfer).filter((value) => value.success);
  const registration = registrations.sort((a, b) => {
    const score = (value: MbRegistration) =>
      Number(Boolean(value.referralCode) && codeKey(value.referralCode) === codeKey(referral)) +
      Number(Boolean(value.province && ctx.province) && placeMatches(value.province, ctx.province)) +
      Number(Boolean(value.branch && ctx.supportBranch) && branchMatches(value.branch, ctx.supportBranch));
    return score(b) - score(a) || a.missing.length - b.missing.length;
  })[0];
  const profile = profiles.sort((a, b) => {
    const score = (value: MbProfile) =>
      Number(Boolean(value.userId && ctx.accountNumber) && value.userId === ctx.accountNumber) +
      Number(Boolean(value.customerName) && nameMatches(value.customerName, ctx.customerName));
    return score(b) - score(a) || a.missing.length - b.missing.length;
  })[0];
  const transfer = transfers[0];
  const items: CheckedItem[] = [];

  if (!registration) {
    items.push({ key: "open", verdict: "missing", label: "Mã giới thiệu, Tỉnh/Thành phố và Chi nhánh hỗ trợ", issues: ["Thiếu ảnh xác thực mã giới thiệu và chi nhánh"], found: "", expected: [referral, ctx.province, ctx.supportBranch].filter(Boolean).join(" - "), note: "Không tìm thấy ảnh đăng ký tài khoản MB có Mã RM và Chi nhánh hỗ trợ." });
  } else {
    const issues: string[] = [];
    const notes: string[] = [];
    if (!registration.referralCode) { issues.push("Không đọc được mã giới thiệu"); notes.push("Không đọc được Mã RM trên ảnh."); }
    else if (referral && codeKey(registration.referralCode) !== codeKey(referral)) { issues.push("Mã giới thiệu không khớp"); notes.push(`Mã trên ảnh ${registration.referralCode}, mã đã ghim ${referral}.`); }
    if (!ctx.province) { issues.push("Mã đã ghim chưa cấu hình Tỉnh/Thành phố"); notes.push("Mã đã ghim chưa có Tỉnh/Thành phố để đối chiếu."); }
    else if (!registration.province) { issues.push("Không đọc được Tỉnh/Thành phố"); notes.push("Không đọc được Tỉnh/Thành phố trên ảnh."); }
    else if (!placeMatches(registration.province, ctx.province)) { issues.push("Tỉnh/Thành phố không khớp"); notes.push(`Tỉnh/Thành phố trên ảnh ${registration.province}, mã đã ghim ${ctx.province}.`); }
    if (!ctx.supportBranch) { issues.push("Mã đã ghim chưa cấu hình Chi nhánh hỗ trợ"); notes.push("Mã đã ghim chưa có Chi nhánh hỗ trợ để đối chiếu."); }
    else if (!registration.branch) { issues.push("Không đọc được Chi nhánh hỗ trợ"); notes.push("Không đọc được Chi nhánh hỗ trợ trên ảnh."); }
    else if (!compact(ctx.supportBranch).includes("TUCHON") && !branchMatches(registration.branch, ctx.supportBranch)) { issues.push("Chi nhánh hỗ trợ không khớp"); notes.push(`Chi nhánh trên ảnh ${registration.branch}, mã đã ghim ${ctx.supportBranch}.`); }
    items.push({ key: "open", verdict: issues.length ? "fail" : "pass", label: "Mã giới thiệu, Tỉnh/Thành phố và Chi nhánh hỗ trợ", issues, found: [registration.referralCode, registration.province, registration.branch].filter(Boolean).join(" - "), expected: [referral, ctx.province, ctx.supportBranch].filter(Boolean).join(" - "), note: notes.join(" "), photoIndex: registration.photoIndex });
  }

  if (!profile) {
    items.push({ key: "home", verdict: "missing", label: "Tên khách hàng và User ID", issues: ["Thiếu ảnh xác thực tên khách hàng và User ID"], found: "", expected: [ctx.customerName, ctx.accountNumber].filter(Boolean).join(" - "), note: "Không tìm thấy hồ sơ người dùng MB có User ID." });
  } else {
    const issues: string[] = [];
    const notes: string[] = [];
    if (!profile.customerName) { issues.push("Không đọc được tên khách hàng"); notes.push("Không đọc được tên khách hàng trên ảnh."); }
    else if (!nameMatches(profile.customerName, ctx.customerName) &&
      !(compact(ctx.customerName).length >= 10 && levenshtein(compact(profile.customerName), compact(ctx.customerName)) <= 1)) {
      issues.push("Tên khách hàng không khớp");
      notes.push(`Tên trên ảnh ${profile.customerName}, tên khách ${ctx.customerName}.`);
    }
    if (!profile.userId) { issues.push("Không đọc được User ID"); notes.push("Không đọc được User ID trên ảnh."); }
    else if (ctx.accountNumber && profile.userId !== ctx.accountNumber) { issues.push("User ID không khớp số tài khoản"); notes.push(`User ID trên ảnh ${profile.userId}, số tài khoản đã nhập ${ctx.accountNumber}.`); }
    items.push({ key: "home", verdict: issues.length ? "fail" : "pass", label: "Tên khách hàng và User ID", issues, found: [profile.customerName, profile.userId].filter(Boolean).join(" - "), expected: [ctx.customerName, ctx.accountNumber].filter(Boolean).join(" - "), note: notes.join(" "), photoIndex: profile.photoIndex });
  }

  items.push(transfer
    ? { key: "transfer", verdict: "pass", label: "Giao dịch thành công", issues: [], found: `${transfer.kind === "success" ? "Chứng từ giao dịch" : transfer.kind === "history" ? "Lịch sử giao dịch" : "Biến động số dư"}${transfer.amount ? ` - ${transfer.amount}` : ""}`, expected: "", note: "", photoIndex: transfer.photoIndex }
    : { key: "transfer", verdict: "missing", label: "Giao dịch thành công", issues: ["Thiếu ảnh giao dịch thành công"], found: "", expected: "", note: "Không tìm thấy chứng từ thành công hoặc giao dịch tiền đã ghi nhận của MB." });

  return items;
}
