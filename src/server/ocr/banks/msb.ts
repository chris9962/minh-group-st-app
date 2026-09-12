import type { PhotoCheckItem } from "@/lib/api/photoCheck";
import { nameMatches } from "./tpbank";
import { compact, hasLabel, hasPhrase, levenshtein, splitLines, stripAccents } from "../text";

/**
 * Bộ nhãn MSB đo trên 10 tài khoản hoàn thành trong dữ liệu local 2026-09-12.
 * Có cả ảnh chụp màn hình thẳng và ảnh chụp lại điện thoại bằng máy khác.
 */

const ACCOUNT_NUMBER = /(?<!\d)\d{11,14}(?!\d)/;

const cleanOption = (value: string): string =>
  value
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+[xX*›⁄]+\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();

/** Giữ chuỗi tên in hoa, bỏ nhãn và rác OCR ở hai đầu. */
function nameIn(line: string): string {
  const words = stripAccents(line).replace(/[^A-Za-z]+/g, " ").trim().split(" ");
  const kept = words.filter((word) => {
    // Tên thật có thể chỉ một chữ cái ở một thành phần (`LÊ VĂN O`). Vị trí
    // này đã được kẹp sau nhãn hoặc ngay trước số tài khoản nên giữ lại an toàn.
    if (word.length === 1) return /^[A-Z]$/.test(word);
    if (word.length < 2) return false;
    const uppercase = word.replace(/[^A-Z]/g, "").length;
    return uppercase * 4 >= word.length * 3;
  });
  return kept.join(" ").trim();
}

const isNameLabel = (line: string): boolean =>
  hasLabel(line, "CHUTAIKHOAN") ||
  hasLabel(line, "SOTAIKHOAN") ||
  hasLabel(line, "TENDANGNHAP") ||
  hasLabel(line, "NGAYHIEULUC") ||
  hasLabel(line, "HANMUCGIAODICH");

/** Giá trị ở một trong ba dòng ngay sau nhãn. */
function afterLabel(
  lines: string[],
  label: string,
  usable: (line: string) => boolean,
): string {
  const at = lines.findIndex((line) => hasLabel(line, label));
  if (at < 0) return "";
  for (let i = at + 1; i < Math.min(lines.length, at + 4); i++) {
    if (usable(lines[i])) return cleanOption(lines[i]);
  }
  return "";
}

/* ── Màn “Đăng ký dịch vụ MSB Digibank thành công” ─────────────────── */

export type MsbOpenSuccess = {
  success: boolean;
  customerName: string;
  accountNumber: string;
  missing: ("success" | "customerName")[];
};

export function parseMsbOpenSuccess(ocrText: string): MsbOpenSuccess {
  const lines = splitLines(ocrText);
  const whole = compact(ocrText);
  const success =
    whole.includes("DANGKYDICHVUMSBDIGIBANKTHANHCONG") ||
    (whole.includes("MSBDIGIBANK") && whole.includes("THANHCONG"));

  let customerName = afterLabel(
    lines,
    "CHUTAIKHOAN",
    (line) => !isNameLabel(line) && nameIn(line).replace(/\s/g, "").length >= 4,
  );
  customerName = nameIn(customerName);

  let accountNumber = "";
  let accountAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = stripAccents(lines[i]).match(ACCOUNT_NUMBER);
    if (!match) continue;
    accountNumber = match[0];
    accountAt = i;
    break;
  }

  // Ảnh chụp lại màn hình thường rớt toàn bộ nhãn. Khi đó tên vẫn nằm ngay
  // trước số tài khoản; bỏ qua các dòng nhãn nếu Tesseract chỉ rớt một phần.
  if (!customerName && accountAt >= 0) {
    for (let i = accountAt - 1; i >= Math.max(0, accountAt - 4); i--) {
      if (isNameLabel(lines[i]) || /\d/.test(lines[i])) continue;
      const candidate = nameIn(lines[i]);
      if (candidate.replace(/\s/g, "").length >= 4) {
        customerName = candidate;
        break;
      }
    }
  }

  const out: MsbOpenSuccess = { success, customerName, accountNumber, missing: [] };
  if (!success) out.missing.push("success");
  if (!customerName) out.missing.push("customerName");
  return out;
}

/* ── Bước “2.3 Bổ sung thông tin” ──────────────────────────────────── */

export type MsbSupplement = {
  supplement: boolean;
  branch: string;
  referralCode: string;
  missing: ("supplement" | "branch" | "referralCode")[];
};

/**
 * Lấy đúng token mã, không giữ rác OCR phía sau (`YPHPDVC-5 | THE`). Dừng ở
 * nhãn mã chương trình để ảnh bỏ trống mã giới thiệu không bị đọc nhầm `CTV1`.
 * `XPTVRAC` là mã thật không có chữ số; các mã toàn chữ phải dài ít nhất 7.
 */
function referralCodeIn(lines: string[]): string {
  const at = lines.findIndex((line) => hasLabel(line, "MAGIOITHIEU"));
  if (at < 0) return "";
  for (let i = at + 1; i < Math.min(lines.length, at + 4); i++) {
    if (hasLabel(lines[i], "MACHUONGTRINH")) break;
    const plain = stripAccents(lines[i]);
    const candidates = plain.match(/[A-Z0-9]{4,16}(?:-\d{1,2})?/g) ?? [];
    const code = candidates.find((value) => /\d/.test(value) || value.length >= 7);
    if (code) return code.toUpperCase();
  }
  return "";
}

export function parseMsbSupplement(ocrText: string): MsbSupplement {
  const lines = splitLines(ocrText);
  const supplement =
    hasPhrase(lines, "BOSUNGTHONGTIN") &&
    (lines.some((line) => hasLabel(line, "CHINHANHPGD")) ||
      lines.some((line) => hasLabel(line, "MAGIOITHIEU")));

  const branch = afterLabel(
    lines,
    "CHINHANHPGD",
    (line) =>
      !hasLabel(line, "DIACHIHIENTAI") &&
      !hasLabel(line, "THONGTINBOSUNG") &&
      compact(line).length >= 4,
  );
  const referralCode = referralCodeIn(lines);

  const out: MsbSupplement = { supplement, branch, referralCode, missing: [] };
  if (!supplement) out.missing.push("supplement");
  if (!branch) out.missing.push("branch");
  if (!referralCode) out.missing.push("referralCode");
  return out;
}

/* ── Màn giao dịch thành công ───────────────────────────────────────── */

export type MsbTransfer = {
  bank: boolean;
  /** Màn có dấu tick xanh, hoặc màn chi tiết mở lại từ lịch sử. */
  kind: "success" | "detail" | "";
  success: boolean;
  /** Chỉ màn chi tiết có mã giao dịch. */
  transactionCode: string;
  missing: ("bank" | "success")[];
};

export function parseMsbTransfer(ocrText: string): MsbTransfer {
  const lines = splitLines(ocrText);
  const phraseSuccess =
    hasPhrase(lines, "CHUYENTIENTHANHCONG") ||
    hasPhrase(lines, "GIAODICHTHANHCONG");
  const transactionCode = afterLabel(
    lines,
    "MAGIAODICH",
    (line) => {
      const value = compact(line);
      return value.length >= 8 && /[A-Z]/.test(value) && /\d/.test(value);
    },
  );
  // Màn mở lại từ lịch sử không in chữ “thành công”. Bốn nhãn này cộng mã
  // giao dịch là bằng chứng giao dịch đã phát sinh; form đang nhập không có
  // “Kênh giao dịch” và “Mã giao dịch”.
  const detailLayout =
    hasPhrase(lines, "DENTAIKHOAN") &&
    hasPhrase(lines, "TUTAIKHOAN") &&
    hasPhrase(lines, "KENHGIAODICH") &&
    Boolean(transactionCode);
  const out: MsbTransfer = {
    bank: hasPhrase(lines, "MSB") || hasPhrase(lines, "MSBDIGIBANK"),
    kind: phraseSuccess ? "success" : detailLayout ? "detail" : "",
    success: phraseSuccess || detailLayout,
    transactionCode,
    missing: [],
  };
  if (!out.bank) out.missing.push("bank");
  if (!out.success) out.missing.push("success");
  return out;
}

/* ── Ba phép kiểm cho một tài khoản ────────────────────────────────── */

export type MsbCheckContext = {
  /** Chuỗi đầy đủ ở `referral_codes.code`, có thể kèm “MCT: …”. */
  referralCode: string;
  /** Mã ngắn hiện trên ảnh, lấy từ `referral_codes.display_name`. */
  referralName: string;
  /** Chi nhánh/PGD đã cấu hình cho mã. “Tự chọn” không có giá trị cố định. */
  supportBranch: string;
  customerName: string;
  accountNumber: string;
};

const codeKey = (value: string): string =>
  compact(value)
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/Z/g, "2");

/** Bản nhập cũ lưu “MÃ - MCT: …” trong `code`; chỉ lấy phần hiện trên ảnh. */
function expectedReferral(ctx: MsbCheckContext): string {
  // `display_name` của vài mã MSBa có chú thích phòng ở sau mã. Trên ảnh chỉ
  // hiện token đầu (`MGST2026`), nên không mang phần chú thích vào phép so.
  for (const source of [ctx.referralName, ctx.referralCode]) {
    const token = source.trim().match(/^[A-Z0-9]+(?:-\d+)?/i)?.[0];
    if (token) return token;
  }
  return "";
}

const flexibleBranch = (value: string): boolean => compact(value).includes("TUCHON");

function branchKey(value: string): string {
  return compact(value.split("(")[0]).replace(/^CHINHANH/, "");
}

function branchMatches(found: string, expected: string): boolean {
  const a = branchKey(found);
  const b = branchKey(expected);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  return levenshtein(a, b) <= Math.max(1, Math.floor(b.length / 10));
}

export function checkMsb(texts: string[], ctx: MsbCheckContext): PhotoCheckItem[] {
  const best = <T extends { missing: unknown[] }>(values: T[]): T | undefined =>
    values.sort((a, b) => a.missing.length - b.missing.length)[0];

  const opens = texts.map(parseMsbOpenSuccess).filter((value) => value.success);
  const supplements = texts.map(parseMsbSupplement).filter((value) => value.supplement);
  // Một tài khoản nhập cũ có thể chứa cả ảnh chụp nhầm của khách kế tiếp. Nếu
  // trong bộ vẫn có ảnh đúng, ưu tiên chính giá trị cần đối chiếu thay vì thứ tự.
  const open =
    opens.find(
      (value) =>
        value.customerName && nameMatches(value.customerName, ctx.customerName),
    ) ?? best(opens);
  const supplement =
    supplements.find(
      (value) =>
        value.referralCode &&
        codeKey(value.referralCode) === codeKey(expectedReferral(ctx)) &&
        value.branch &&
        (flexibleBranch(ctx.supportBranch) ||
          !ctx.supportBranch ||
          branchMatches(value.branch, ctx.supportBranch)),
    ) ?? best(supplements);
  const transfer = best(
    texts.map(parseMsbTransfer).filter((value) => value.bank && value.success),
  );
  const referral = expectedReferral(ctx);
  const items: PhotoCheckItem[] = [];

  if (!open) {
    items.push({
      key: "open",
      verdict: "missing",
      label: "Tên khách hàng",
      issues: ["Thiếu ảnh xác thực tên khách hàng"],
      found: "",
      expected: ctx.customerName,
      note: "Không ảnh nào là màn đăng ký MSB Digibank thành công.",
    });
  } else {
    const notes: string[] = [];
    const issues: string[] = [];
    if (!open.customerName) {
      notes.push("Không đọc được tên chủ tài khoản.");
      issues.push("Không đọc được tên khách hàng");
    } else if (!nameMatches(open.customerName, ctx.customerName)) {
      notes.push(`Tên trên ảnh ${open.customerName}, tên khách ${ctx.customerName}.`);
      issues.push("Tên khách hàng không khớp");
    }
    items.push({
      key: "open",
      verdict: notes.length ? "fail" : "pass",
      label: "Tên khách hàng",
      issues,
      found: [open.customerName, open.accountNumber].filter(Boolean).join(" - "),
      expected: ctx.customerName,
      note: notes.join(" "),
    });
  }

  if (!supplement) {
    items.push({
      key: "home",
      verdict: "missing",
      label: "Mã giới thiệu và Chi nhánh/PGD",
      issues: ["Thiếu ảnh xác thực mã giới thiệu và Chi nhánh/PGD"],
      found: "",
      expected: [referral, ctx.supportBranch].filter(Boolean).join(" - "),
      note: "Không ảnh nào là bước bổ sung thông tin MSB.",
    });
  } else {
    const notes: string[] = [];
    const issues: string[] = [];
    if (!supplement.referralCode) {
      notes.push("Không đọc được mã giới thiệu.");
      issues.push("Không đọc được mã giới thiệu");
    } else if (referral && codeKey(supplement.referralCode) !== codeKey(referral)) {
      notes.push(`Mã trên ảnh ${supplement.referralCode}, mã đã chọn ${referral}.`);
      issues.push("Mã giới thiệu không khớp");
    }
    if (!supplement.branch) {
      notes.push("Không đọc được chi nhánh/PGD.");
      issues.push("Không đọc được Chi nhánh/PGD");
    } else if (
      ctx.supportBranch &&
      !flexibleBranch(ctx.supportBranch) &&
      !branchMatches(supplement.branch, ctx.supportBranch)
    ) {
      notes.push(
        `Chi nhánh/PGD trên ảnh ${supplement.branch}, đã chọn ${ctx.supportBranch}.`,
      );
      issues.push("Chi nhánh/PGD không khớp");
    }
    items.push({
      key: "home",
      verdict: notes.length ? "fail" : "pass",
      label: "Mã giới thiệu và Chi nhánh/PGD",
      issues,
      found: [supplement.referralCode, supplement.branch].filter(Boolean).join(" - "),
      expected: [referral, ctx.supportBranch].filter(Boolean).join(" - "),
      note: notes.join(" "),
    });
  }

  items.push(
    transfer
      ? {
          key: "transfer",
          verdict: "pass",
          label: "Giao dịch thành công",
          issues: [],
          found:
            transfer.kind === "detail"
              ? ["Chi tiết giao dịch", transfer.transactionCode].filter(Boolean).join(" - ")
              : "Chuyển tiền thành công",
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
          note: "Không ảnh nào có thông tin giao dịch MSB thành công.",
        },
  );

  return items;
}
