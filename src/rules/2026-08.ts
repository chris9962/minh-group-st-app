import type { ScoringAccount } from "./index";

/**
 * Thể lệ kỳ **2026-08** — phần TÍNH ĐIỂM.
 *
 * Nguồn: `../../../mgst-the-le/2026-08.md`, mục 1 (phân hạng ngân hàng), mục 2
 * (bảng điểm theo tổ hợp) và mục 4 lưu ý 1. Quà tặng (mục 3) chưa viết ở đây —
 * còn ba câu chưa chốt: 7.5, 7.6, 7.10.
 *
 * File của một kỳ ĐÓNG BĂNG VĨNH VIỄN (spec §5.3). Tháng sau thể lệ đổi thì
 * thêm `2026-09.ts`, không sửa file này: sửa nó là đổi điểm của một kỳ đã trả
 * lương xong.
 *
 * Chạy thử: `bun run test:rules` (`scripts/test-rules.ts`).
 */

/** Ba hạng ở mục 1. Ngân hàng ngoài thể lệ KHÔNG mang hạng nào — xem `TIER_OF`. */
type Tier = "priority" | "other" | "restricted";

/**
 * Hạng của từng mã ngân hàng (chốt 07/08, câu 7.1).
 *
 * `TCB`, `CNKD`, `HKD` cố ý vắng mặt: thể lệ không nhắc tới chúng nên chúng
 * không tham gia chương trình — mở vẫn ghi nhận, nhưng không vào combo và không
 * ra điểm (câu 7.2).
 *
 * Đừng lấy `banks.coefficient` ra làm hạng. Cột đó thuộc công thức cũ và ngược
 * chiều với thể lệ: `VPa` là bank ưu tiên mà hệ số 1, `VPb` là bank hạn chế mà
 * hệ số 1.4.
 */
const TIER_OF: Record<string, Tier> = {
  MB: "priority",
  VPa: "priority",
  MSBa: "priority",
  LBP: "other",
  MSBb: "other",
  BIDV: "other",
  TPB: "other",
  VIB: "other",
  SHB: "other",
  VPb: "restricted",
};

/**
 * Hai ngân hàng DUY NHẤT đòi cài app mới được tính vào combo (chốt 07/08, câu
 * 7.8). Chưa cài thì coi như khách không mở ngân hàng đó.
 *
 * Ngân hàng ngoài hai mã này tính bất kể đã cài app hay chưa — khác hẳn công
 * thức cũ (chỉ cộng điểm tài khoản đã cài app), nên đừng đọc code cũ ra luật.
 */
const REQUIRES_APP = new Set(["VPa", "MSBa"]);

/**
 * Hai ngân hàng không triển khai cho khách tham gia Combo 2 (mục 4, lưu ý 1).
 *
 * Hệ quả: khách mở đúng hai tài khoản `MB` + `MSBa` thì chỉ còn `MB` đứng một
 * mình, tức 0 điểm. Combo 3 vẫn nhận cả hai mã này bình thường.
 */
const OUT_OF_COMBO_2 = new Set(["MSBa", "VPb"]);

/** Ký hiệu tra bảng điểm; `rank` để chữ ký không đổi theo thứ tự tài khoản nhập vào. */
const SIGNATURE_OF: Record<Tier, { letter: string; rank: number }> = {
  priority: { letter: "P", rank: 0 },
  other: { letter: "O", rank: 1 },
  restricted: { letter: "R", rank: 2 },
};

/**
 * Bảng điểm mục 2, ghi bằng ĐƠN VỊ 1/10 ĐIỂM.
 *
 * Cộng số thực nhị phân thì `0.7 + 0.5` ra `1.2000000000000002`; một nhân viên
 * vài chục khách là sai số trồi lên chữ số thứ hai, mà đây là số dính tới lương.
 * Cộng bằng số nguyên rồi chia đúng MỘT lần ở cuối thì không có chuyện đó.
 */
const COMBO_2_TENTHS: Record<string, number> = { PP: 7, PO: 5, OO: 4 };
const COMBO_3_TENTHS: Record<string, number> = {
  PPP: 12,
  PPO: 10,
  PPR: 9,
  POO: 8,
  POR: 7,
  OOO: 7,
  OOR: 5,
};

/** Chỉ gọi được với mã ĐÃ lọc qua `TIER_OF` — mã lạ sẽ cho ra chữ ký rác. */
const signatureOf = (bankCodes: string[]): string =>
  bankCodes
    .map((code) => SIGNATURE_OF[TIER_OF[code]])
    .sort((a, b) => a.rank - b.rank)
    .map((s) => s.letter)
    .join("");

/**
 * Điểm của MỘT khách, đơn vị 1/10 điểm.
 *
 * Lấy tổ hợp CHO ĐIỂM CAO NHẤT, không lấy theo số tài khoản (chốt 07/08, câu
 * 7.4): dữ liệu có dư 4 tài khoản thì bỏ bớt cái kéo điểm xuống.
 *
 * Duyệt cả tổ hợp 2 lẫn tổ hợp 3 rồi lấy max. Duyệt tổ hợp 2 KHÔNG phải để hạ
 * điểm khách có 3 tài khoản: mọi dòng combo 3 đều cao hơn tổ hợp 2 nằm trong
 * nó (thấp nhất 0.5 so với 0.4), nên khi tổ hợp 3 hợp lệ thì nó luôn thắng.
 * Nhánh combo 2 chỉ đỡ ca bảng không có dòng nào khớp.
 *
 * Số tổ hợp phải duyệt chỉ hàng chục — mỗi khách tối đa 3 tài khoản theo luật
 * ngoài đời, và danh mục có 10 mã ngân hàng tham gia. Không đáng tối ưu.
 */
function comboTenths(bankCodes: string[]): number {
  // Trùng mã chỉ tính một lần: "02 Bank ưu tiên" nghĩa là hai NGÂN HÀNG khác
  // nhau, hai tài khoản cùng một ngân hàng không thành combo.
  const codes = [...new Set(bankCodes)].filter((code) => code in TIER_OF);

  let best = 0;
  for (let i = 0; i < codes.length; i += 1)
    for (let j = i + 1; j < codes.length; j += 1) {
      for (let k = j + 1; k < codes.length; k += 1)
        best = Math.max(best, COMBO_3_TENTHS[signatureOf([codes[i], codes[j], codes[k]])] ?? 0);

      if (!OUT_OF_COMBO_2.has(codes[i]) && !OUT_OF_COMBO_2.has(codes[j]))
        best = Math.max(best, COMBO_2_TENTHS[signatureOf([codes[i], codes[j]])] ?? 0);
    }

  return best;
}

/** Hạng của một mã ngân hàng; `null` nghĩa là ngân hàng đó không nằm trong thể lệ kỳ này. */
export const bankTierOf = (bankCode: string): Tier | null => TIER_OF[bankCode] ?? null;

/**
 * Điểm của MỘT khách theo danh sách mã ngân hàng khách đó mở trong kỳ.
 *
 * Danh sách đưa vào phải ĐÃ lọc điều kiện cài app — hàm này không thấy trường
 * đó. Dùng `bankingPoints` cho đường tính điểm thật; hàm này để dựng ca thử và
 * để module quà dùng lại phép gom combo.
 */
export const comboPointsFor = (bankCodes: string[]): number => comboTenths(bankCodes) / 10;

/**
 * Điểm ngân hàng của MỘT người trong kỳ.
 *
 * Hai việc lọc đã làm trước khi tới đây: `src/rules/index.ts` cắt còn tài khoản
 * mở trong đúng tháng đang tính (câu 7.13), tầng gọi cắt còn tài khoản `done`
 * của những khách do NGƯỜI NÀY lập hồ sơ (câu 7.11).
 */
export function bankingPoints(accounts: ScoringAccount[]): number {
  const codesByCustomer = new Map<string, string[]>();

  for (const account of accounts) {
    if (REQUIRES_APP.has(account.bankCode) && !account.appInstalled) continue;
    const codes = codesByCustomer.get(account.customerId);
    if (codes) codes.push(account.bankCode);
    else codesByCustomer.set(account.customerId, [account.bankCode]);
  }

  let tenths = 0;
  for (const codes of codesByCustomer.values()) tenths += comboTenths(codes);
  return tenths / 10;
}
