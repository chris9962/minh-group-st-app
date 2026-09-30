import type {
  GiftCash,
  GiftChoice,
  GiftInput,
  GiftResult,
  GrantedGifts,
  ScoringAccount,
} from "./index";

/**
 * Thể lệ kỳ **2026-10-01**: điểm KPI và quà tặng, áp từ 01/10/2026.
 *
 * Nguồn: `../../../mgst-the-le/2026-10-01.md`. Hồ sơ có ngày hồ sơ 28/9 tới
 * 30/9 vẫn chạy `2026-09-28.ts`, luật chọn theo ngày hồ sơ (`ruleDateOf`).
 *
 * Chép từ `2026-09-28.ts` rồi sửa, KHÔNG import lại file đó: mỗi kỳ một file
 * đứng riêng và đóng băng vĩnh viễn (spec §5.3).
 *
 * Khác kỳ 2026-09-28, xem mục 5 của thể lệ:
 *
 *   A. `VPb` sang Bank khác, `VIB` sang Bank hạn chế
 *   B. `MSBa` vào Combo 1 và Combo 2; bỏ dòng Combo 1 "hạn chế 0,1" và ngoại
 *      lệ `VPb` kèm CNKD
 *   C. Bảng quà mới, mã TH đánh lại theo từng combo; Combo 1, Combo 2 tiền
 *      THAY bảo hiểm, Combo 3 tiền CỘNG 01 năm bảo hiểm — `caseOf`
 *   D. Không xét cài app khi tính quà; quản lý đánh lỗi sau (chốt 2026-09-30)
 *   E. Bỏ hạn chi tiền của `VPa`, `MSBa`
 *   F. Phòng Y quy đổi quà chỉ ở TH8
 *   G. HKD mở ở mọi ngân hàng, MỖI tài khoản HKD cộng 3,0; CNKD và HKD cộng
 *      dồn thay vì lấy mức cao hơn
 *
 * Giữ nguyên kỳ 2026-09-28: bảng điểm Combo 2, Combo 3; tổ hợp bằng điểm thì
 * tổ hợp nhiều ngân hàng hơn thắng; tối đa hai bank hạn chế mỗi hồ sơ; CNKD
 * 1,0 kèm ngân hàng nào cũng được; `VPa` + `VPb` là dữ liệu sai; dòng HKD
 * không vào combo; rổ quà thêm Loa, Bảng mica.
 *
 * `extraBanks` nói dòng HKD nào được quà thêm; máy chủ gắn tài khoản và lưu
 * mỗi dòng một món ở `gift_grant_extras` (migration 0110).
 *
 * Chạy thử: `bun run test:rules` (`scripts/test-rules-2026-10-01.ts`).
 */

/** Ba hạng ở mục 1. Ngân hàng ngoài thể lệ KHÔNG mang hạng nào — xem `TIER_OF`. */
export type Tier = "priority" | "other" | "restricted";

/**
 * Hạng của từng mã ngân hàng (mục 1).
 *
 * `VPb` sang Bank khác và `VIB` sang Bank hạn chế từ bảng 2026-09-29. Kỳ
 * 2026-09-28 để `VPb` ở hạn chế và `VIB` ở khác, đừng chép bảng cũ.
 *
 * `CNKD`, `HKD` vẫn cố ý vắng mặt: chúng không phải ngân hàng, không vào combo
 * và không đếm vào số ngân hàng khách mở. Điểm riêng của chúng ở mục 4b.
 *
 * Đừng lấy `banks.coefficient` ra làm hạng. Cột đó thuộc công thức cũ và ngược
 * chiều với thể lệ: `VPa` là bank ưu tiên mà hệ số 1, `VPb` là bank khác mà
 * hệ số 1.4.
 */
const TIER_OF: Record<string, Tier> = {
  MB: "priority",
  VPa: "priority",
  MSBa: "priority",
  VPb: "other",
  MSBb: "other",
  TCB: "other",
  TPB: "other",
  SHB: "other",
  BIDV: "restricted",
  LPB: "restricted",
  MBV: "restricted",
  VIB: "restricted",
};

/**
 * Mỗi hồ sơ tối đa HAI ngân hàng hạng hạn chế — chủ dự án chốt 2026-09-27 khi
 * thêm hai dòng Combo 3 có hai hạn chế. Kế toán 2026-09-15 vẫn cấm ba:
 * *"không có triển khai cùng lúc 3 bank hạn chế"*. Kỳ 2026-09-16 chặn từ ngân
 * hàng hạn chế thứ hai.
 *
 * Là luật CHẶN LÚC MỞ, không phải luật tính điểm: bảng mục 2 không có dòng ba
 * hạn chế, nên hồ sơ lỡ có ba vẫn tính ra 0. Hồ sơ đang có hai hạn chế vẫn mở
 * thêm được một bank ưu tiên hoặc bank khác để thành Combo 3.
 *
 * Xét theo HỒ SƠ, không theo mọi lần của khách: mỗi hồ sơ là một combo (chốt
 * 2026-09-05). Dòng HKD không phải ngân hàng, nơi gọi phải bỏ nó khỏi
 * `existing` trước. `candidate` trùng mã đang có thì do `slotConflict` xử, ở
 * đây chỉ so với mã KHÁC.
 */
const MAX_RESTRICTED_PER_PROFILE = 2;

/**
 * Luật chọn tổ hợp, viết cho nhân viên đọc ở hộp thoại mở tài khoản. Mỗi dòng
 * một câu, không giải thích. Đổi luật thì đổi câu ở đây, không viết cứng ở giao
 * diện, để ngày thêm kỳ mới chỉ sửa một chỗ. Hạng từng ngân hàng và bảng điểm
 * giao diện tự tra từ `bankTierOf` và `comboPointsFor`, không lặp ở đây.
 */
export const OPEN_NOTES: string[] = [
  "Mỗi hồ sơ mở tối đa 3 ngân hàng. Dòng HKD không tính vào 3.",
  "Mỗi hồ sơ mở tối đa HAI bank hạn chế.",
  "Bank hạn chế không vào Combo 1: đứng một mình thì 0 điểm, không quà.",
  "Combo 2 có bank hạn chế: chỉ 1 ưu tiên + 1 hạn chế. Bank khác + bank hạn chế tính Combo 1 của bank khác.",
  "Combo 3 có 1 bank hạn chế: 2 ưu tiên + 1 hạn chế, 1 ưu tiên + 1 khác + 1 hạn chế, hoặc 2 khác + 1 hạn chế.",
  "Combo 3 có 2 bank hạn chế: 1 ưu tiên + 2 hạn chế, hoặc 1 khác + 2 hạn chế.",
  "Không mở cả VPa lẫn VPb cho cùng một khách. Hồ sơ đó 0 điểm.",
  "CNKD kèm ngân hàng nào cũng cộng 1,0. Mỗi tài khoản HKD cộng 3,0, ngân hàng nào cũng được.",
];

export function openBlockReason(existingBankCodes: string[], candidate: string): string | null {
  if (TIER_OF[candidate] !== "restricted") return null;
  const others = [
    ...new Set(
      existingBankCodes.filter((code) => code !== candidate && TIER_OF[code] === "restricted"),
    ),
  ];
  return others.length >= MAX_RESTRICTED_PER_PROFILE
    ? `Hồ sơ đã có ${others.join(" và ")} thuộc nhóm hạn chế. Mỗi hồ sơ mở tối đa hai ngân hàng hạn chế.`
    : null;
}

/**
 * Kỳ 2026-09-28 có `REQUIRES_APP`, `OUT_OF_COMBO_1`, `OUT_OF_COMBO_2` và ngoại
 * lệ `VPb` kèm CNKD. Kỳ này bỏ cả bốn: quà không xét cài app (chủ dự án chốt
 * 2026-09-30, quản lý đánh lỗi sau), `MSBa` vào cả ba combo, `VPb` là bank khác.
 */

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
 *
 * Combo 1 không có dòng hạng hạn chế: bảng 2026-09-29 bỏ dòng 0,1 vì `VPb` đã
 * sang Bank khác. Hạn chế đứng một mình không thành tổ hợp, xem `bestComboOf`.
 */
const COMBO_1_TENTHS: Record<string, number> = { P: 3, O: 2 };
const COMBO_2_TENTHS: Record<string, number> = { PP: 7, PO: 5, OO: 4, PR: 3 };
const COMBO_3_TENTHS: Record<string, number> = {
  PPP: 12,
  PPO: 10,
  PPR: 9,
  POO: 8,
  POR: 7,
  OOO: 7,
  OOR: 5,
  PRR: 5,
  ORR: 4,
};

/**
 * Bảng tổ hợp cho hộp thoại "Luật chọn tổ hợp" đọc, theo thứ tự bảng mục 2.
 *
 * Kỳ này tự khai vì có dòng bằng điểm tổ hợp nhỏ hơn: bảng chung của hộp
 * thoại tra điểm cao nhất, nên dòng "1 ưu tiên + 2 hạn chế" hiện ra 0,3 ở kỳ
 * 2026-09-16 dù kỳ đó chặn hai hạn chế.
 */
export const COMBO_ROWS: { label: string; tiers: Tier[] }[] = [
  { label: "1 ưu tiên", tiers: ["priority"] },
  { label: "1 khác", tiers: ["other"] },
  { label: "2 ưu tiên", tiers: ["priority", "priority"] },
  { label: "1 ưu tiên + 1 khác", tiers: ["priority", "other"] },
  { label: "2 khác", tiers: ["other", "other"] },
  { label: "1 ưu tiên + 1 hạn chế", tiers: ["priority", "restricted"] },
  { label: "3 ưu tiên", tiers: ["priority", "priority", "priority"] },
  { label: "2 ưu tiên + 1 khác", tiers: ["priority", "priority", "other"] },
  { label: "2 ưu tiên + 1 hạn chế", tiers: ["priority", "priority", "restricted"] },
  { label: "1 ưu tiên + 2 khác", tiers: ["priority", "other", "other"] },
  { label: "1 ưu tiên + 1 khác + 1 hạn chế", tiers: ["priority", "other", "restricted"] },
  { label: "3 khác", tiers: ["other", "other", "other"] },
  { label: "2 khác + 1 hạn chế", tiers: ["other", "other", "restricted"] },
  { label: "1 ưu tiên + 2 hạn chế", tiers: ["priority", "restricted", "restricted"] },
  { label: "1 khác + 2 hạn chế", tiers: ["other", "restricted", "restricted"] },
];

/** Chỉ gọi được với mã ĐÃ lọc qua `TIER_OF` — mã lạ sẽ cho ra chữ ký rác. */
const signatureOf = (bankCodes: string[]): string =>
  bankCodes
    .map((code) => SIGNATURE_OF[TIER_OF[code]])
    .sort((a, b) => a.rank - b.rank)
    .map((s) => s.letter)
    .join("");

/** Tổ hợp thắng của một khách. `size` 0 nghĩa là không thành combo nào. */
type Combo = { tenths: number; size: 0 | 1 | 2 | 3; codes: string[] };

const NO_COMBO: Combo = { tenths: 0, size: 0, codes: [] };

/**
 * Tổ hợp CHO ĐIỂM CAO NHẤT của một khách — dùng chung cho cả điểm lẫn quà.
 *
 * Lấy theo điểm chứ không theo số tài khoản (chốt 07/08, câu 7.4).
 *
 * Duyệt cả ba cỡ tổ hợp rồi lấy max. Hai tổ hợp BẰNG ĐIỂM thì tổ hợp nhiều
 * ngân hàng hơn thắng. Ca hoà duy nhất là dòng PR mới 0,3 với Combo 1 của bank
 * ưu tiên trong nó, cũng 0,3. Không xử ca hoà thì tổ hợp thắng đi theo thứ tự
 * tài khoản nhập vào: `VPa` + `LPB` lúc ra Combo 2, lúc ra Combo 1.
 *
 * `MSBa` vào cả ba combo từ kỳ này; hạng hạn chế vẫn ngoài Combo 1 (mục 1).
 */
function bestComboOf(bankCodes: string[]): Combo {
  // Trùng mã chỉ tính một lần: "02 Bank ưu tiên" nghĩa là hai NGÂN HÀNG khác
  // nhau, hai tài khoản cùng một ngân hàng không thành combo.
  const codes = [...new Set(bankCodes)].filter((code) => code in TIER_OF);

  let best = NO_COMBO;
  const keep = (tenths: number, size: 1 | 2 | 3, picked: string[]) => {
    const wins = tenths > best.tenths || (tenths > 0 && tenths === best.tenths && size > best.size);
    if (wins) best = { tenths, size, codes: picked };
  };

  for (let i = 0; i < codes.length; i += 1) {
    // Hạng hạn chế không vào Combo 1: `COMBO_1_TENTHS` không có chữ R nên tự ra 0.
    keep(COMBO_1_TENTHS[signatureOf([codes[i]])] ?? 0, 1, [codes[i]]);

    for (let j = i + 1; j < codes.length; j += 1) {
      for (let k = j + 1; k < codes.length; k += 1) {
        const three = [codes[i], codes[j], codes[k]];
        keep(COMBO_3_TENTHS[signatureOf(three)] ?? 0, 3, three);
      }

      const two = [codes[i], codes[j]];
      keep(COMBO_2_TENTHS[signatureOf(two)] ?? 0, 2, two);
    }
  }

  return best;
}

/** Hạng của một mã ngân hàng; `null` nghĩa là ngân hàng đó không nằm trong thể lệ kỳ này. */
export const bankTierOf = (bankCode: string): Tier | null => TIER_OF[bankCode] ?? null;

/**
 * Điểm của MỘT khách theo danh sách mã ngân hàng khách đó mở trong kỳ.
 *
 * KHÔNG cộng điểm CNKD/HKD — hàm này chỉ trả điểm TỔ HỢP, dùng cho cột
 * `ĐIỂM COMBO` của báo cáo Kế toán và cho ca thử. Đường tính điểm thật đi qua
 * `bankingPoints`.
 */
export const comboPointsFor = (bankCodes: string[]): number => {
  const accounts = bankCodes.map((bankCode) => ({ bankCode }) as ScoringAccount);
  if (hasBothVpModes(accounts)) return 0;
  return bestComboOf(bankCodes).tenths / 10;
};

/* ── Mục 4c và 4d · điểm CNKD và HKD ─────────────────────────────────── */

/**
 * Điểm CNKD — MỘT MỨC DUY NHẤT 1,0, Kế toán chốt 2026-09-02.
 *
 * Nguyên văn: *"vẫn giữ quy tắc +1 điểm đối với các trường hợp phát sinh CNKD,
 * bao gồm CNKD VPBa trong combo 2"*. "Các trường hợp" là mọi trường hợp.
 *
 * ⚠️ Kỳ 2026-08 có BA mức — 1,5 khi kèm `VPa` mở đúng 1 ngân hàng, 0,7 khi
 * khách đó đã nhận Mì hoặc Nón, 1,0 cho phần còn lại. Kỳ này bỏ cả 1,5 lẫn 0,7.
 * Đừng chép bảng cũ sang.
 *
 * Kỳ này CNKD đi một mình là `VPb` ra 1,2 (0,2 của Combo 1 hạng khác + 1,0),
 * là `VPa` ra 1,3 (0,3 của Combo 1 hạng ưu tiên + 1,0).
 */
const CNKD_TENTHS = 10;

/** Điểm MỖI tài khoản HKD (thể lệ mục 4b, chủ dự án chốt 2026-09-30). */
const HKD_TENTHS = 30;

/**
 * CNKD kèm BẤT KỲ ngân hàng nào trong thể lệ (chủ dự án chốt 2026-09-15). Đọc
 * cả hai cách ghi (câu 7.16): ô chọn trên dòng ngân hàng, và tài khoản riêng
 * mang mã `CNKD`. Khách có CNKD ở hai ngân hàng vẫn 1,0 mỗi hồ sơ: ca chưa xảy
 * ra, thể lệ mục 6 G17.
 */
const hasCnkd = (accounts: ScoringAccount[]): boolean =>
  accounts.some((a) => a.bankCode === "CNKD" || a.household === "CNKD") &&
  accounts.some((a) => a.bankCode in TIER_OF);

/**
 * Ngân hàng của từng dòng HKD được tính, mỗi ngân hàng một (khoá
 * `bank_accounts_root_bank_slot` cũng chỉ cho một dòng HKD mỗi ngân hàng).
 * Mỗi phần tử là một suất: 3,0 điểm và một món quà thêm.
 *
 * Kỳ 2026-09-28 chỉ nhận HKD kèm `VPa` và tính 3,0 mỗi hồ sơ. Kỳ này HKD mở
 * được ở mọi ngân hàng trong thể lệ và MỖI tài khoản cộng 3,0. Dòng riêng mang
 * mã `HKD` (cách ghi cũ, câu 7.16) đếm là một khi khách có ngân hàng trong thể
 * lệ, như kỳ trước.
 */
function hkdBanksOf(accounts: ScoringAccount[]): string[] {
  const banks = new Set<string>();
  for (const a of accounts) if (a.household === "HKD" && a.bankCode in TIER_OF) banks.add(a.bankCode);
  if (accounts.some((a) => a.bankCode === "HKD") && accounts.some((a) => a.bankCode in TIER_OF))
    banks.add("HKD");
  return [...banks];
}

const hkdAccountCountOf = (accounts: ScoringAccount[]): number => hkdBanksOf(accounts).length;

/**
 * Những dòng ĐƯỢC TÍNH là ngân hàng — bỏ dòng HKD (chủ dự án chốt 2026-09-06).
 *
 * Dòng HKD là một tài khoản riêng của ngân hàng đó, nằm cạnh tài khoản chính;
 * kỳ này mở được ở mọi ngân hàng trong thể lệ. Nó chỉ mang điểm HKD và món Loa,
 * Bảng mica (mục 4b); nó KHÔNG vào combo và KHÔNG đếm vào số ngân hàng. Khách
 * chỉ có dòng HKD thì không có combo nào, còn khách có dòng HKD kèm `TPB` thì
 * là Combo 1 của `TPB`, không phải Combo 2. Một ngân hàng chỉ là ngân hàng khi
 * khách có dòng chính, loại thường hoặc CNKD.
 *
 * `hasBothVpModes` và `hkdAccountCountOf` cố ý đọc CẢ dòng HKD: dòng đó vẫn là
 * VPa khi xét "VPa cùng VPb là dữ liệu sai".
 */
const comboRowsOf = (accounts: ScoringAccount[]): ScoringAccount[] =>
  accounts.filter((a) => a.household !== "HKD");

/**
 * Khách mở CẢ `VPa` LẪN `VPb` — dữ liệu sai, khách đó KHÔNG góp điểm nào.
 *
 * `VPa` và `VPb` là hai cách đăng ký của CÙNG MỘT ngân hàng, nên một khách
 * không thể có cả hai (Kế toán chốt 2026-09-02):
 *
 * > *"VPa và VPb không thể xảy ra cùng 1 combo được, bản chất nó là 1 ngân
 * > hàng, chỉ khác cách đăng ký thôi"*
 *
 * ⚠️ CHỈ chặn ở đường ĐIỂM. Màn mở tài khoản vẫn cho nhân viên nhập cả hai —
 * unique index `bank_accounts_root_bank_slot` khoá theo từng mã ngân hàng, mà
 * `VPa` với `VPb` là hai mã. Kế toán chốt để nguyên: *"việc mở tài khoản nhân
 * viên làm sai nhân viên chịu, nếu nhân viên mở sai VPa VPb cho khách, cứ cho
 * 0 điểm"*.
 *
 * Không dòng nào của bảng mục 2 chết theo luật này: dòng có bank khác vẫn đạt
 * được bằng `MSBb`, `TCB`, `TPB`, `SHB`.
 */
const hasBothVpModes = (accounts: ScoringAccount[]): boolean =>
  accounts.some((a) => a.bankCode === "VPa") && accounts.some((a) => a.bankCode === "VPb");

/**
 * Phần điểm hộ kinh doanh của MỘT khách: CNKD (mục 4b) cộng 3,0 cho MỖI tài
 * khoản HKD. Không xét số ngân hàng, không xét tổ hợp thắng, không xét món
 * khách đã nhận.
 *
 * CỘNG DỒN, chủ dự án chốt 2026-09-30: CNKD ở `MB` kèm HKD ở `VPa` ra 4,0. Kỳ
 * 2026-09-28 lấy mức cao hơn (giả định G2), kỳ này bỏ. CNKD và HKD cùng một
 * ngân hàng vẫn bị `slotConflict` chặn lúc mở, luật không cần xét.
 */
function householdTenths(accounts: ScoringAccount[]): number {
  if (hasBothVpModes(accounts)) return 0;
  return hkdAccountCountOf(accounts) * HKD_TENTHS + (hasCnkd(accounts) ? CNKD_TENTHS : 0);
}

/**
 * Điểm ngân hàng của MỘT người trong kỳ.
 *
 * Hai việc lọc đã làm trước khi tới đây: `src/rules/index.ts` cắt còn tài khoản
 * mở trong đúng tháng đang tính (câu 7.13), tầng gọi cắt còn tài khoản `done`
 * của những khách do NGƯỜI NÀY lập hồ sơ (câu 7.11).
 *
 * Điểm mỗi khách gồm HAI phần cộng lại: điểm tổ hợp (mục 2) và điểm hộ kinh
 * doanh (mục 4c, 4d).
 *
 * Không xét cài app, ở cả điểm lẫn quà từ kỳ này.
 *
 * `_granted` không dùng ở kỳ này: món khách đã nhận KHÔNG còn đổi điểm nào từ
 * chốt 2026-09-02. Tham số giữ lại vì `PeriodRules` dùng chung với kỳ 2026-08,
 * và kỳ đó thì món đã nhận có hạ điểm CNKD.
 */
export function bankingPoints(accounts: ScoringAccount[], _granted: GrantedGifts): number {
  const byCustomer = new Map<string, ScoringAccount[]>();
  for (const account of accounts) {
    const rows = byCustomer.get(account.customerId);
    if (rows) rows.push(account);
    else byCustomer.set(account.customerId, [account]);
  }

  let tenths = 0;
  for (const rows of byCustomer.values()) {
    // Khách mở cả VPa lẫn VPb là dữ liệu sai — bỏ TRỌN khách đó, kể cả phần
    // điểm hộ kinh doanh. Xem `hasBothVpModes`.
    if (hasBothVpModes(rows)) continue;

    const combo = bestComboOf(comboRowsOf(rows).map((a) => a.bankCode));
    tenths += combo.tenths + householdTenths(rows);
  }
  return tenths / 10;
}

/**
 * Phần điểm hộ kinh doanh của một khách, tính bằng ĐIỂM chứ không phải phần mười.
 *
 * `_grantedItem` không dùng ở kỳ này — xem `bankingPoints`. Tham số giữ lại cho
 * khớp `PeriodRules`.
 */
export const householdPointsOf = (
  accounts: ScoringAccount[],
  _grantedItem: string | null,
): number => householdTenths(accounts) / 10;

/* ── Mục 3 · quà tặng ────────────────────────────────────────────────── */

/**
 * Tiền mặt của từng ngân hàng (mục 1, cột Ghi chú).
 *
 * Không còn `withinDays`: bảng 2026-09-29 bỏ hạn chi "05 ngày" của `VPa` và
 * "10 ngày" của `MSBa`, chủ dự án chốt 2026-09-30. Việc chi tiền vẫn nằm
 * ngoài hệ thống (chốt 07/08).
 *
 * ⚠️ `VPb` cố ý VẮNG MẶT, đội chốt 2026-09-03, xem thể lệ mục 3c kỳ 2026-09-16.
 * Câu "VPB tặng KH 10k" mới ở cột ghi chú cũng bỏ qua (chốt 2026-09-30).
 */
const CASH_OF: Record<string, Omit<GiftCash, "reason">> = {
  VPa: { bankCode: "VPa", amount: 20_000 },
  MSBa: { bankCode: "MSBa", amount: 50_000 },
};

/**
 * Rổ bảo hiểm theo bậc quà.
 *
 * Thể lệ chỉ ghi "01 năm BH" / "02 năm BH" mà không nói gói nào — danh sách gói
 * lấy từ spec §5.2 bước 1.
 *
 * Mức 0 là của TH2, TH3, TH4 ở Combo 1 và Combo 2: tiền THAY gói bảo hiểm,
 * chủ dự án chốt 2026-09-30. Combo 3 thì tiền CỘNG 01 năm bảo hiểm (TH5, TH6,
 * TH7), bảng ghi rõ "01 năm BH + tiền".
 *
 * `BH-2N-XEMAY-2XE` là hai đơn xe máy 1 năm cho hai xe khác nhau (chủ dự án
 * chốt 2026-09-06): tổng vẫn hai năm bảo hiểm nên đứng cùng mức với gói 2 năm
 * một xe. Gói chèn bằng migration 0068 để mã cố định khớp chuỗi ở đây.
 */
const INSURANCE_BASKET: Record<0 | 1 | 2, string[]> = {
  0: [],
  1: ["BH-1N-XEMAY", "BH-1N-DIEN"],
  2: ["BH-COMBO-1N", "BH-2N-XEMAY", "BH-2N-XEMAY-2XE", "BH-2N-DIEN-100K", "BH-1N-DIEN-200K"],
};

/**
 * Rổ quà thêm của khách có HKD — Kế toán chốt 2026-09-02, tách rổ 2026-09-17.
 *
 * ⚠️ CHỈ `HKD`, ngân hàng nào cũng được. Mỗi tài khoản HKD chọn MỘT món ở đây
 * (chủ dự án chốt 2026-09-30); rổ trả về vẫn là một danh sách, số món khách
 * được chọn xem `hkdAccountCountOf`.
 *
 * Nằm ở `extraBasket`, KHÔNG nằm chung `basket`: khách lấy món ở đây CỘNG gói
 * bảo hiểm của combo.
 */
const ITEMS_HKD = ["QUA-LOA", "QUA-MICA"];

/**
 * Lưu ý 1 mục 4: nhóm Phòng Y quy đổi quà sang vật phẩm.
 *
 * ⚠️ CHỈ BẬC TH8, bảng 2026-09-29: Combo 3 không có `VPa` lẫn `MSBa`. Kỳ
 * 2026-09-28 cho cả TH5 và TH6 cũ (Combo 3 có `VPa`); kỳ này khách Combo 3 có
 * `VPa` (TH7) không quy đổi được nữa.
 */
const ITEMS_HOSPITAL = ["QUA-MI", "QUA-BH-SUC-KHOE", "QUA-NON-BH"];

/** Bậc DUY NHẤT cho phép quy đổi quà sang vật phẩm (lưu ý 1 mục 4). */
const GIFT_ITEM_CASES = new Set(["TH8"]);

/**
 * Món riêng của PHÒNG Y, không áp cho phòng Dự án và kênh Bệnh viện.
 *
 * Lưu ý 2 viết *"nón bảo hiểm, thùng mì hoặc một số quà tặng khác"* — danh sách
 * để mở, và nó chỉ gọi tên Phòng Y.
 */
const ITEMS_PHONG_Y = ["QUA-MICA"];
const PHONG_Y = "PHONG-Y";

const HOSPITAL_CHANNEL = "KENH-BENH-VIEN";
/** Ba vế của cùng MỘT nhóm khách — thoả một vế là đủ (thể lệ mục 4b). */
const GIFT_ITEM_DEPARTMENTS = new Set(["PHONG-Y", "PHONG-DU-AN"]);

/**
 * Bậc thang mục 3, đọc bằng LOẠI TRỪ (chủ dự án hướng dẫn 2026-09-30): xét TH
 * có bank đặc biệt (`VPa`, `MSBa`) trước, khớp dòng đầu thì dừng, không khớp
 * thì nhận TH còn lại của combo.
 *
 * Mã TH đánh lại theo từng combo từ bảng 2026-09-29; Combo 1 và Combo 2 dùng
 * chung TH1 tới TH3. Đừng so với mã TH của kỳ trước: TH5 cũ là 02 năm BH + 20k,
 * TH5 mới là 01 năm BH + 70k.
 *
 * Không xét cài app: quản lý kiểm tra và đánh lỗi sau (chốt 2026-09-30).
 */
function caseOf(combo: Combo): { code: string; years: 0 | 1 | 2; cashBanks: string[] } | null {
  const has = (bankCode: string) => combo.codes.includes(bankCode);

  if (combo.size === 1) {
    if (has("VPa")) return { code: "TH2", years: 0, cashBanks: ["VPa"] };
    if (has("MSBa")) return { code: "TH3", years: 0, cashBanks: ["MSBa"] };
    return { code: "TH1", years: 1, cashBanks: [] };
  }

  if (combo.size === 2) {
    if (has("VPa") && has("MSBa")) return { code: "TH4", years: 0, cashBanks: ["VPa", "MSBa"] };
    if (has("VPa")) return { code: "TH2", years: 0, cashBanks: ["VPa"] };
    if (has("MSBa")) return { code: "TH3", years: 0, cashBanks: ["MSBa"] };
    return { code: "TH1", years: 1, cashBanks: [] };
  }

  if (combo.size === 3) {
    if (has("MSBa") && has("VPa")) return { code: "TH5", years: 1, cashBanks: ["VPa", "MSBa"] };
    if (has("MSBa")) return { code: "TH6", years: 1, cashBanks: ["MSBa"] };
    if (has("VPa")) return { code: "TH7", years: 1, cashBanks: ["VPa"] };
    return { code: "TH8", years: 2, cashBanks: [] };
  }

  return null;
}

/**
 * Ghi chú 20k của `VPb`, CHỈ ĐỂ ĐỌC. Nó không sinh món chọn được và không cộng
 * vào `cashTotal`. Đội chốt 2026-09-03, xem thể lệ mục 3c.
 *
 * Khoản này đòi tra soát khách có phát sinh giao dịch trong 07 ngày hay không,
 * mà việc tra soát nằm ngoài hệ thống. Nhân viên vẫn phải biết để nói với
 * khách, nên câu này hiện dưới phần quà.
 *
 * Xét trên TỔ HỢP THẮNG, không xét mọi tài khoản khách có. Kỳ này `VPb` là
 * bank khác nên vào được cả ba combo; khách dư tài khoản mà `VPb` nằm ngoài tổ
 * hợp thắng thì không có câu này.
 */
const VPB_NOTE =
  "Khách mở VPb được tặng 20.000đ nếu phát sinh giao dịch trong 07 ngày. Khoản này ngoài hệ thống, không nằm trong tiền mặt ở trên.";

const giftNoteOf = (combo: Combo): string | undefined =>
  combo.codes.includes("VPb") ? VPB_NOTE : undefined;

/**
 * Gắn vào TỪNG món số tiền khách nhận nếu lấy đúng món đó.
 *
 * Kỳ này MỌI món cùng một số: tiền và quà cộng dồn, khách chọn gì cũng giữ
 * nguyên tiền. Kế toán bỏ luật "chọn Mì hoặc Nón thì mất 20k" ngày 2026-09-02.
 *
 * Trường `cashIfChosen` vẫn giữ vì hộp thoại phát quà đọc nó, và vì ngày Kế
 * toán dựng lại một món chặn tiền thì chỉ phải sửa đúng hàm này.
 */
const withCashIfChosen = (basket: GiftChoice[], cashTotal: number): GiftChoice[] =>
  basket.map((item) => ({ ...item, cashIfChosen: cashTotal }));

/**
 * Quà của MỘT khách.
 *
 * Ba bước, đúng thứ tự spec §5.2: tiền mặt cộng dồn (khách không phải chọn) →
 * rổ quà gộp lại → khách lấy đúng một món hoặc từ chối.
 *
 * ⚠️ Xét trên TỔ HỢP THẮNG, không phải trên mọi tài khoản khách có. Khách dư
 * tài khoản mà `VPa` không nằm trong tổ hợp thắng thì không tính 20k của `VPa`.
 */
export function gift(input: GiftInput): GiftResult {
  // Tổ hợp đếm TRỌN tài khoản khách đã mở, y hệt đường tính điểm. Không xét
  // cài app ở bất kỳ bước nào (chốt 2026-09-30).
  const bankRows = comboRowsOf(input.accounts);
  const combo = bestComboOf(bankRows.map((a) => a.bankCode));
  const matched = caseOf(combo);
  const explain: string[] = [];

  /**
   * Hai nhóm món thêm, hai luật khác hẳn nhau về điều kiện bậc VÀ về rổ:
   *
   *   Loa · Bảng mica  — chỉ cần khách có `HKD`, KHÔNG đòi bậc, vào RỔ QUÀ THÊM
   *   Mì · BH sức khoẻ · Nón — đòi bậc TH8, vào rổ chính thay gói BH
   *
   * Vì thế nhóm hai phải xét SAU khi biết `matched`. Kỳ 2026-08 xét cả hai
   * nhóm trước combo, đừng chép thứ tự cũ sang.
   */
  const extras: GiftChoice[] = [];
  const extraBasket: GiftChoice[] = [];
  const addItems = (into: GiftChoice[], codes: string[], reason: string) => {
    for (const code of codes) {
      if (into.some((b) => b.code === code)) continue;
      // `cashIfChosen` điền ở cuối, lúc đã biết tổng tiền — xem `withCashIfChosen`.
      into.push({ kind: "gift-item", code, reason, cashIfChosen: 0 });
    }
  };

  /**
   * Loa và Bảng mica: chỉ cần khách có `HKD` (Kế toán chốt 2026-09-02).
   *
   * Kỳ 2026-08 đòi hai vế — khách mở `VPa`, và khách có `CNKD` hoặc `HKD`. Kỳ
   * này bỏ cả hai: khách `CNKD` KHÔNG còn hai món này, và khách `HKD` nhận bất
   * kể mở ngân hàng nào.
   */
  const hkdBanks = hkdBanksOf(input.accounts);
  const hkdCount = hkdBanks.length;
  if (hkdCount > 0) {
    addItems(extraBasket, ITEMS_HKD, "Khách có HKD");
    explain.push(
      hkdCount === 1
        ? "Khách có 1 tài khoản HKD nên được quà thêm: chọn Loa hoặc Bảng mica, cộng với quà chính."
        : `Khách có ${hkdCount} tài khoản HKD nên được ${hkdCount} món quà thêm, mỗi tài khoản chọn Loa hoặc Bảng mica, cộng với quà chính.`,
    );
  }

  /**
   * Phòng Y, phòng Dự án và kênh Bệnh viện là MỘT nhóm khách. Thoả một trong ba
   * vế là đủ.
   *
   * ⚠️ CHỈ BẬC TH8, bảng 2026-09-29 lưu ý 1. Khách Combo 3 có `VPa` hoặc
   * `MSBa`, Combo 1, Combo 2 và khách chưa đủ bậc đều không quy đổi được.
   */
  const inGiftItemGroup =
    (input.departmentCode !== null && GIFT_ITEM_DEPARTMENTS.has(input.departmentCode)) ||
    input.channelCodes.includes(HOSPITAL_CHANNEL);
  const canSwapGift = inGiftItemGroup && matched !== null && GIFT_ITEM_CASES.has(matched.code);
  if (canSwapGift) {
    addItems(extras, ITEMS_HOSPITAL, "Phòng Y, phòng Dự án hoặc kênh Bệnh viện, bậc TH8");
    explain.push(
      "Khách thuộc Phòng Y, phòng Dự án hoặc kênh Bệnh viện và đạt bậc TH8 nên rổ có thêm Mì, BH sức khoẻ và Nón bảo hiểm.",
    );

    if (input.departmentCode === PHONG_Y) {
      addItems(extras, ITEMS_PHONG_Y, "Phòng Y quy đổi sang quà tặng khác");
      explain.push("Khách thuộc Phòng Y nên rổ có thêm Bảng mica.");
    }
  }

  if (!matched) {
    explain.push(
      bankRows.some((a) => a.bankCode in TIER_OF)
        ? "Khách chưa có tài khoản nào vào được tổ hợp theo thể lệ."
        : "Khách chưa mở tài khoản nào tính được vào thể lệ.",
    );

    return {
      caseCode: null,
      insuranceYears: 0,
      comboPoints: combo.tenths / 10,
      cash: [],
      cashTotal: 0,
      // Chưa đạt bậc nào thì không có gói bảo hiểm, nhưng món thêm vẫn phát.
      basket: withCashIfChosen(extras, 0),
      extraBasket: withCashIfChosen(extraBasket, 0),
      extraBanks: hkdBanks,
      explain,
      giftNote: giftNoteOf(combo),
    };
  }

  explain.unshift(
    `Tổ hợp ${combo.size} ngân hàng: ${combo.codes.join(" + ")} — trường hợp ${matched.code}.`,
  );

  /**
   * Tiền mặt KHÔNG phụ thuộc món khách chọn — Kế toán bỏ luật chặn 2026-09-02.
   *
   * Kỳ 2026-08 khách CNKD mở đúng một `VPa` mà nhận Mì hoặc Nón thì mất 20k.
   * Kỳ này không còn ca nào mất tiền, nên `input.grantedItem` không vào phép
   * tính quà nữa. Nó vẫn nằm trong `GiftInput` vì đường tính ĐIỂM còn dùng.
   */
  const cash: GiftCash[] = matched.cashBanks.map((bankCode) => ({
    ...CASH_OF[bankCode],
    reason: `Mở ${bankCode} trong tổ hợp ${matched.code}`,
  }));
  for (const c of cash) explain.push(`Tặng ${c.amount.toLocaleString("vi-VN")}đ vào ${c.bankCode}.`);

  const insuranceBasket = INSURANCE_BASKET[matched.years];
  const cashTotal = cash.reduce((sum, c) => sum + c.amount, 0);
  const basket: GiftChoice[] = insuranceBasket.map((code) => ({
    kind: "insurance-package" as const,
    code,
    reason: `${matched.years} năm bảo hiểm của ${matched.code}`,
    cashIfChosen: cashTotal,
  }));
  if (matched.years === 0)
    explain.push("Khách nhận tiền thay cho gói bảo hiểm, thể lệ không cho cả hai.");
  else explain.push(`Được ${matched.years} năm bảo hiểm, chọn 1 gói trong rổ.`);

  // Gói bảo hiểm đứng TRƯỚC món thêm trong rổ. Rổ trộn món giá trị rất khác
  // nhau, và khách đọc từ trên xuống.
  basket.push(...extras);

  return {
    caseCode: matched.code,
    insuranceYears: matched.years,
    comboPoints: combo.tenths / 10,
    cash,
    cashTotal,
    basket: withCashIfChosen(basket, cashTotal),
    extraBasket: withCashIfChosen(extraBasket, cashTotal),
    extraBanks: hkdBanks,
    explain,
    giftNote: giftNoteOf(combo),
  };
}
