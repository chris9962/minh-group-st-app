import type { PersonAccount } from "@/lib/api/person";

/**
 * Sinh tài khoản ngân hàng cho một nhân viên.
 *
 * Để ở module riêng vì CẢ HAI màn phải đọc cùng một nguồn: P-51 lấy điểm ngân
 * hàng ở đây, P-52 lấy chính danh sách tài khoản đã sinh ra điểm đó. Hai màn
 * tự tính riêng thì tổng điểm ở màn này không khớp phần tách điểm ở màn kia.
 */

export const BANKS = ["MSBa", "VPa", "VPb", "MB", "TPB"];

/** Hệ số điểm mỗi app đã cài. Bản thật do admin cấu hình. */
export const BANK_FACTOR: Record<string, number> = {
  MSBa: 3,
  VPa: 2,
  VPb: 2,
  MB: 1,
  TPB: 1,
};

/** Khớp đúng tên trong danh mục kênh thật (P-70, `channelCatalog.ts`) — dữ
 *  liệu giả lập dùng tên khác đi thì lọc theo kênh và tính quà theo kênh
 *  (spec §5.2 kênh Bệnh viện góp quà) đều không khớp được. */
const CHANNELS = ["Ấp", "Bệnh viện", "ATM", "Định danh", "Tự do"];

/** Đủ dài để mỗi khách chỉ có một hai ngân hàng, giống ngoài đời hơn. */
export const CUSTOMERS = [
  "Nguyễn Thị Bích Trâm",
  "Trần Văn Đức",
  "Lê Thị Hồng",
  "Phạm Minh Tuấn",
  "Võ Thị Mai",
  "Đỗ Văn Bình",
  "Huỳnh Thị Ngọc",
  "Lý Văn Sang",
  "Nguyễn Văn Khoa",
  "Trần Thị Thu",
  "Đặng Minh Hoàng",
  "Bùi Thị Lan",
  "Phan Văn Tài",
  "Ngô Thị Kim",
  "Dương Văn Phúc",
  "Hồ Thị Diệu",
  "Vũ Minh Quân",
  "Trương Thị Nga",
  "Lâm Văn Hậu",
  "Cao Thị Yến",
];

const ACCOUNT_TYPES: PersonAccount["accountType"][] = [
  "none",
  "none",
  "none",
  "CNKD",
  "HKD",
];

/** Số cố định theo tên để dữ liệu không nhảy mỗi lần render. */
export const seed = (s: string, salt: number) =>
  (s.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * 13 + salt * 29) % 97;

/** Tài khoản chưa có ngày — ngày do màn nào cần thì tự gắn theo kỳ đang xem. */
export type AccountSpec = Omit<PersonAccount, "date">;

export function buildAccounts(fullName: string, count: number): AccountSpec[] {
  return Array.from({ length: count }, (_, i) => {
    const bank = BANKS[seed(fullName, i + 11) % BANKS.length];
    // App chưa cài thì tài khoản không tính điểm, không tính quà — đây là lý do
    // bảng có dòng mà điểm vẫn thấp.
    const appInstalled = seed(fullName, i + 53) % 5 !== 0;
    return {
      id: `a${i + 1}`,
      // Rải theo i để mỗi khách chỉ dính một hai dòng; lấy seed thuần thì cả
      // mấy chục tài khoản dồn vào vài khách và mỗi hàng có năm ngân hàng.
      customerName: CUSTOMERS[(i + (seed(fullName, 23) % 3)) % CUSTOMERS.length],
      bankName: bank,
      referralCode: `${bank}-${String(seed(fullName, i + 31) * 7).padStart(4, "0").slice(0, 4)}`,
      channel: CHANNELS[seed(fullName, i + 41) % CHANNELS.length],
      appInstalled,
      accountType: appInstalled
        ? ACCOUNT_TYPES[seed(fullName, i + 59) % ACCOUNT_TYPES.length]
        : "none",
    };
  });
}

/** Số tài khoản một người mở trong tháng. Dải này cho ra điểm quanh mốc 100. */
export const accountCountOf = (fullName: string) => 26 + (seed(fullName, 1) % 46);

/** Điểm ngân hàng = tổng hệ số của các app ĐÃ CÀI. */
export const bankPointsOf = (accounts: AccountSpec[]): number =>
  accounts
    .filter((a) => a.appInstalled)
    .reduce((sum, a) => sum + (BANK_FACTOR[a.bankName] ?? 1), 0);
