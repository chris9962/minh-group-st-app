import { ocrLines } from "./reader";
import type { CheckedItem } from "./types";

/**
 * Chấm bằng tìm giá trị: trong bộ ảnh của một tài khoản phải thấy đủ các giá
 * trị hệ thống, ở ảnh nào cũng được, không cần biết ảnh là màn nào. TPBank
 * chốt 2026-09-19, các ngân hàng khác theo cùng cách từ 2026-09-21. Mỗi ngân
 * hàng chỉ viết hàm `facts(text, ctx)` trả các boolean; phần đọc ảnh tới khi
 * đủ và ra ba mục kết quả nằm ở đây.
 *
 * Không trích giá trị trên ảnh để hiện: bản trước đoán "dòng chữ hoa gần số
 * tài khoản nhất" là tên, gặp màn mở tài khoản thì lấy nhầm nhãn "Số tài khoản
 * thanh toán" và người duyệt đọc thấy "TAI KHOAN THANH TODN" (tài khoản
 * 5e237733, 2026-09-18). Không thấy thì chỉ nói "không tìm thấy X trong ảnh",
 * người duyệt mở ảnh xem. Không dung sai: nhân viên gõ sai một chữ số cũng
 * phải bị bắt (chốt 2026-09-14).
 */

export type Facts = {
  nameFound: boolean;
  accountFound: boolean;
  codeFound: boolean;
  successFound: boolean;
  /** Chỉ ngân hàng có cấu hình Tỉnh/Thành phố và Chi nhánh hỗ trợ theo mã (MB). */
  provinceFound?: boolean;
  branchFound?: boolean;
  /** Chỉ ngân hàng so ngày mở tài khoản (LPB). */
  openedDateFound?: boolean;
  /** Chỉ VPBank: ô "Mã giới thiệu" cố định của công ty, tách với mã DAO. */
  programFound?: boolean;
  /** Chỉ VPBank cá nhân: có giao dịch nạp tiền vào tài khoản chứng khoán. */
  securitiesFound?: boolean;
  /** Chỉ VPBank CNKD: ô "Mục đích sử dụng tài khoản" chọn "Cá nhân kinh doanh". */
  purposeFound?: boolean;
  /** Chỉ VPBank CNKD, HKD: màn liên kết tài khoản trên eTax có số tài khoản. */
  etaxFound?: boolean;
};

/** Giá trị hệ thống để người duyệt biết phải tìm gì khi mở ảnh. Rỗng = không so. */
export type FactValues = {
  /** Mã hiện trên ảnh. `''` = mã QR-only, không so được. */
  code: string;
  /** Tên gọi của `code` trong thông báo, mặc định "mã giới thiệu"; VPBank gọi "mã DAO". */
  codeLabel?: string;
  customerName: string;
  accountNumber: string;
  province?: string;
  supportBranch?: string;
  /** `dd/mm/yyyy` như in trên ảnh. */
  openedDate?: string;
  /** Mã giới thiệu cố định phải thấy cùng `code` (VPBank: `MINHAP`). */
  program?: string;
  /** Đòi thêm giao dịch nạp chứng khoán trong mục giao dịch. */
  securities?: boolean;
  /** Mục đích sử dụng tài khoản phải thấy trên ảnh (VPBank CNKD: "Cá nhân kinh doanh"). */
  purpose?: string;
  /** Đòi màn liên kết eTax có số tài khoản. */
  etax?: boolean;
  /** Mục thứ ba không phải chuyển khoản (VPBank HKD: QR nhận tiền). */
  transfer?: { label: string; issue: string; note: string };
};

export const mergeFacts = (a: Facts, b: Facts): Facts => {
  const out = { ...a };
  for (const key of Object.keys(b) as (keyof Facts)[]) out[key] = Boolean(a[key] || b[key]);
  return out;
};

export const allFound = (f: Facts | null): boolean => f !== null && Object.values(f).every(Boolean);

/**
 * Đọc từng ảnh cho tới khi cả bộ đủ mọi giá trị; ảnh còn lại không đọc,
 * chuỗi rỗng giữ chỗ để `photoIndex` vẫn đúng.
 */
export async function readUntilFound(images: Buffer[], facts: (text: string) => Facts): Promise<string[]> {
  const texts: string[] = [];
  let have: Facts | null = null;
  for (const image of images) {
    if (allFound(have)) {
      texts.push("");
      continue;
    }
    const text = (await ocrLines(image)).join("\n");
    texts.push(text);
    const found = facts(text);
    have = have ? mergeFacts(have, found) : found;
  }
  return texts;
}

/**
 * Ba mục kết quả từ các giá trị của từng ảnh. Ba key `open` / `home` /
 * `transfer` là key giao diện đang dùng: `open` = mã giới thiệu (kèm Tỉnh và
 * Chi nhánh hỗ trợ nếu mã có cấu hình), `home` = tên và số tài khoản (kèm
 * ngày mở nếu so), `transfer` = chuyển khoản thành công. `found` luôn rỗng:
 * không đoán giá trị trên ảnh.
 */
export function itemsFromFacts(facts: Facts[], values: FactValues): CheckedItem[] {
  const photoOf = (key: keyof Facts): number | undefined => {
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
  const programAt = photoOf("programFound");
  const provinceAt = photoOf("provinceFound");
  const branchAt = photoOf("branchFound");
  const nameAt = photoOf("nameFound");
  const accountAt = photoOf("accountFound");
  const dateAt = photoOf("openedDateFound");
  const successAt = photoOf("successFound");
  const securitiesAt = photoOf("securitiesFound");
  const purposeAt = photoOf("purposeFound");
  const etaxAt = photoOf("etaxFound");

  const codeLabel = values.codeLabel ?? "mã giới thiệu";
  const openIssues: string[] = [];
  const openNotes: string[] = [];
  if (values.code && codeAt === undefined) {
    openIssues.push(`Không tìm thấy ${codeLabel}`);
    openNotes.push(`Không tìm thấy ${codeLabel} ${values.code} trong ảnh.`);
  }
  if (values.program && programAt === undefined) {
    openIssues.push("Không tìm thấy mã giới thiệu");
    openNotes.push(`Không tìm thấy mã giới thiệu ${values.program} trong ảnh.`);
  }
  if (values.province && provinceAt === undefined) {
    openIssues.push("Không tìm thấy Tỉnh/Thành phố");
    openNotes.push(`Không tìm thấy Tỉnh/Thành phố ${values.province} trong ảnh.`);
  }
  if (values.supportBranch && branchAt === undefined) {
    openIssues.push("Không tìm thấy Chi nhánh hỗ trợ");
    openNotes.push(`Không tìm thấy Chi nhánh hỗ trợ ${values.supportBranch} trong ảnh.`);
  }
  if (values.purpose && purposeAt === undefined) {
    openIssues.push("Không tìm thấy mục đích sử dụng tài khoản");
    openNotes.push(`Không tìm thấy mục đích sử dụng "${values.purpose}" trong ảnh.`);
  }
  const openLabel = values.program
    ? values.purpose
      ? "Mã DAO, mã giới thiệu và mục đích sử dụng"
      : "Mã DAO và mã giới thiệu"
    : values.province || values.supportBranch
      ? "Mã giới thiệu, Tỉnh/Thành phố và Chi nhánh hỗ trợ"
      : "Mã giới thiệu";
  const openExpected = [values.code, values.program, values.province, values.supportBranch, values.purpose]
    .filter(Boolean)
    .join(" - ");

  const homeIssues: string[] = [];
  const homeNotes: string[] = [];
  if (nameAt === undefined) {
    homeIssues.push("Không tìm thấy tên khách hàng");
    homeNotes.push(`Không tìm thấy tên ${values.customerName} trong ảnh.`);
  }
  if (values.accountNumber && accountAt === undefined) {
    homeIssues.push("Không tìm thấy số tài khoản");
    homeNotes.push(`Không tìm thấy số tài khoản ${values.accountNumber} trong ảnh.`);
  }
  if (values.openedDate && dateAt === undefined) {
    homeIssues.push("Không tìm thấy ngày mở tài khoản");
    homeNotes.push(`Không tìm thấy ngày mở ${values.openedDate} trong ảnh.`);
  }
  if (values.etax && etaxAt === undefined) {
    homeIssues.push("Không tìm thấy màn liên kết eTax");
    homeNotes.push(
      values.accountNumber
        ? "Không ảnh nào là màn liên kết tài khoản trên eTax có số tài khoản."
        : "Không ảnh nào là màn liên kết tài khoản trên eTax.",
    );
  }
  const homeLabel = [
    "Tên khách hàng",
    values.accountNumber ? "số tài khoản" : "",
    values.openedDate ? "ngày mở" : "",
    values.etax ? "liên kết eTax" : "",
  ]
    .filter(Boolean)
    .join(", ")
    .replace(/, ([^,]+)$/, " và $1");
  const homeExpected = [values.customerName, values.accountNumber, values.openedDate].filter(Boolean).join(" - ");

  const transferIssues: string[] = [];
  const transferNotes: string[] = [];
  if (successAt === undefined) {
    transferIssues.push(values.transfer?.issue ?? "Thiếu ảnh giao dịch thành công");
    transferNotes.push(values.transfer?.note ?? "Không ảnh nào có dòng chuyển khoản thành công.");
  }
  if (values.securities && securitiesAt === undefined) {
    transferIssues.push("Không tìm thấy giao dịch nạp chứng khoán");
    transferNotes.push("Không ảnh nào có giao dịch nạp tiền vào tài khoản chứng khoán.");
  }

  return [
    !openExpected
      ? item("open", "Mã giới thiệu", "", undefined, [], "Mã đã chọn không có mã chữ, không so được.")
      : item(
          "open",
          openLabel,
          openExpected,
          codeAt ?? programAt ?? provinceAt ?? branchAt ?? purposeAt,
          openIssues,
          openNotes.join(" "),
        ),
    item(
      "home",
      homeLabel,
      homeExpected,
      nameAt ?? (values.accountNumber ? accountAt : undefined) ?? dateAt ?? etaxAt,
      homeIssues,
      homeNotes.join(" "),
    ),
    item(
      "transfer",
      values.transfer?.label ?? (values.securities ? "Giao dịch thành công và nạp chứng khoán" : "Giao dịch thành công"),
      "",
      successAt ?? securitiesAt,
      transferIssues,
      transferNotes.join(" "),
    ),
  ];
}
