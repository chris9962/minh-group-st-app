import type {
  GiftCash,
  GiftChoice,
  GiftInput,
  GiftResult,
  GrantedGifts,
  HouseholdKind,
  ScoringAccount,
} from "./index";

/**
 * Thể lệ kỳ **2026-09-16** — điểm KPI và quà tặng, áp từ 16/9/2026.
 *
 * Nguồn: `../../../mgst-the-le/2026-09-16.md`. Kỳ đầu tiên bắt đầu GIỮA
 * THÁNG: khách mở tài khoản 1–15/9 vẫn chạy `2026-09.ts`, luật chọn theo ngày
 * mở của khách (`ruleDateOf` ở `index.ts`).
 *
 * Chép từ `2026-09.ts` rồi sửa, KHÔNG import lại file đó: mỗi kỳ một file đứng
 * riêng và đóng băng vĩnh viễn (spec §5.3). Dùng chung hàm nghĩa là ngày sửa kỳ
 * này sẽ đổi luôn điểm của kỳ đã trả lương xong.
 *
 * Bốn chỗ khác kỳ 2026-09-01, xem mục 5 của thể lệ:
 *
 *   a. `LPB` từ Bank khác sang Bank hạn chế, không vào Combo 1 và Combo 2
 *   b. `MBV` mới, Bank hạn chế (production thêm vào danh mục qua P-71 ngày
 *      2026-09-15, mã khớp chuỗi ở đây)
 *   c. Dòng Combo 1 hạng hạn chế ghi 0,1: `VPb` kèm CNKD ra 1,1 thay vì 1,0
 *      (giả định G9); hạn chế đứng một mình vẫn không có tổ hợp (G10)
 *   d. CNKD kèm BẤT KỲ ngân hàng nào trong thể lệ đều cộng 1,0 (chủ dự án
 *      chốt 2026-09-15); kỳ trước chỉ `VPa`, `VPb`
 *   e. `BIDV` từ Bank khác sang Bank hạn chế (Kế toán bổ sung 2026-09-15)
 *   f. Mỗi hồ sơ chỉ một ngân hàng hạn chế, chặn lúc mở — `openBlockReason`
 *
 * Mười hai chỗ khác kỳ 2026-08 giữ nguyên từ `2026-09.ts`:
 *
 *   1. `TCB` vào nhóm Bank khác
 *   2. Combo 1 có điểm: ưu tiên 0,3 · khác 0,2 · hạn chế 0; `MSBa` và `VPb`
 *      không vào Combo 1
 *   3. Combo 1 có quà: TH7 một năm bảo hiểm, TH8 thêm 20k khi có `VPa`
 *   4. CNKD đi kèm `VPa` HOẶC `VPb`; HKD chỉ đi kèm `VPa`
 *   5. HKD được 3,0 điểm, CNKD còn MỘT mức 1,0
 *   6. Món thêm Loa · Bảng mica chỉ dành cho `HKD`
 *   7. Quy đổi quà của Phòng Y đòi bậc TH5 hoặc TH6
 *   8. Bỏ luật "chọn Mì hoặc Nón thì mất 20k"
 *   9. `VPa` hoặc `MSBa` chưa cài app, đứng một mình thì KHÔNG có quà nào
 *  10. Món khách đã nhận không còn đổi điểm nào
 *  11. Khách mở cả `VPa` lẫn `VPb` là dữ liệu sai — 0 điểm
 *  12. Dòng HKD là tài khoản `VPa` riêng, KHÔNG vào combo và KHÔNG đếm là
 *      ngân hàng (chốt 2026-09-06), xem `comboRowsOf`
 *
 * Chạy thử: `bun run test:rules` (`scripts/test-rules-2026-09-16.ts` cho phần
 * khác, `scripts/test-rules-2026-09.ts` ghim ngày 15/9 nên vẫn thử file cũ).
 */

/** Ba hạng ở mục 1. Ngân hàng ngoài thể lệ KHÔNG mang hạng nào — xem `TIER_OF`. */
export type Tier = "priority" | "other" | "restricted";

/**
 * Hạng của từng mã ngân hàng (mục 1).
 *
 * `LPB`, `BIDV` sang nhóm hạn chế và `MBV` mới, Kế toán gửi 2026-09-15. Kỳ
 * 2026-09-01 để hai mã kia ở Bank khác và không có `MBV`, đừng chép bảng cũ.
 *
 * `CNKD`, `HKD` vẫn cố ý vắng mặt: chúng không phải ngân hàng, không vào combo
 * và không đếm vào số ngân hàng khách mở. Điểm riêng của chúng ở mục 4c và 4d.
 *
 * Đừng lấy `banks.coefficient` ra làm hạng. Cột đó thuộc công thức cũ và ngược
 * chiều với thể lệ: `VPa` là bank ưu tiên mà hệ số 1, `VPb` là bank hạn chế mà
 * hệ số 1.4.
 */
const TIER_OF: Record<string, Tier> = {
  MB: "priority",
  VPa: "priority",
  MSBa: "priority",
  MSBb: "other",
  TCB: "other",
  TPB: "other",
  VIB: "other",
  SHB: "other",
  BIDV: "restricted",
  LPB: "restricted",
  MBV: "restricted",
  VPb: "restricted",
};

/**
 * Mỗi hồ sơ chỉ MỘT ngân hàng hạng hạn chế — Kế toán chốt 2026-09-15, nguyên
 * văn: *"không triển khai bank hạn chế cùng lúc ví dụ combo 3: 1 ưu tiên + 1
 * khác + 1 hạn chế thì được, không triển khai cùng lúc 1 khác + 2 hạn chế hoặc
 * 1 ưu tiên + 2 hạn chế … cấm các bạn luôn giùm e"*.
 *
 * Là luật CHẶN LÚC MỞ, không phải luật tính điểm: bảng mục 2 vốn không có dòng
 * hai hạn chế, nên khách lỡ có hai hạn chế vẫn tính được (hạ xuống Combo 1 của
 * ngân hàng còn lại, G11). Hàm này để giao diện khoá ô chọn trước khi nhân viên
 * bấm, và máy chủ từ chối nếu lời gọi nặn tay. Cùng một hàm cho cả màn mở tài
 * khoản lẫn màn thử, để hai màn không mỗi nơi một câu.
 *
 * Xét theo HỒ SƠ, không theo mọi lần của khách: mỗi hồ sơ là một combo (chốt
 * 2026-09-05), Kế toán nói "combo" tức là hồ sơ đang mở.
 *
 * Ba ca cần nhớ:
 * - Dòng HKD không phải ngân hàng, nơi gọi phải bỏ nó khỏi `existing` trước.
 * - Ngân hàng đã có trong hồ sơ từ TRƯỚC 16/9 vẫn tính: hồ sơ mở thêm sau
 *   16/9 thì cả tổ hợp theo luật này (`ruleDateOf`), `LPB` mở 14/9 nay là hạn
 *   chế, thêm `VPb` là hai hạn chế.
 * - `candidate` trùng mã đang có thì không phải việc của hàm này: trùng ngân
 *   hàng do `slotConflict` xử, ở đây chỉ so với mã KHÁC.
 */
/**
 * Luật chọn tổ hợp, viết cho nhân viên đọc ở hộp thoại mở tài khoản. Mỗi dòng
 * một câu, không giải thích. Đổi luật thì đổi câu ở đây, không viết cứng ở giao
 * diện, để ngày thêm kỳ mới chỉ sửa một chỗ. Hạng từng ngân hàng và bảng điểm
 * giao diện tự tra từ `bankTierOf` và `comboPointsFor`, không lặp ở đây.
 */
export const OPEN_NOTES: string[] = [
  "Mỗi hồ sơ mở tối đa 3 ngân hàng. Dòng VPa HKD không tính vào 3.",
  "Bank hạn chế chỉ triển khai trong Combo 3. Mỗi hồ sơ chỉ mở MỘT bank hạn chế.",
  "Combo 3 có bank hạn chế: 2 ưu tiên + 1 hạn chế, 1 ưu tiên + 1 khác + 1 hạn chế, hoặc 2 khác + 1 hạn chế.",
  "Ngoại lệ: VPb mở được cho khách CNKD, kể cả khi hồ sơ chỉ có VPb.",
  "MSBa không vào Combo 1 và Combo 2, chỉ vào Combo 3.",
  "VPa và MSBa phải cài app mới có quà. Điểm KPI không xét cài app.",
  "Không mở cả VPa lẫn VPb cho cùng một khách. Hồ sơ đó 0 điểm.",
  "CNKD kèm ngân hàng nào cũng cộng 1,0. HKD chỉ kèm VPa, cộng 3,0.",
];

export function openBlockReason(existingBankCodes: string[], candidate: string): string | null {
  if (TIER_OF[candidate] !== "restricted") return null;
  const other = existingBankCodes.find(
    (code) => code !== candidate && TIER_OF[code] === "restricted",
  );
  return other
    ? `Hồ sơ đã có ${other} thuộc nhóm hạn chế. Mỗi hồ sơ chỉ mở một ngân hàng hạn chế.`
    : null;
}

/**
 * Hai ngân hàng DUY NHẤT đòi cài app mới được tính vào tổ hợp QUÀ (câu 7.8).
 * Chưa cài thì phần quà coi như khách không mở ngân hàng đó.
 *
 * ⚠️ CHỈ ÁP CHO QUÀ, không áp cho điểm — chốt 2026-08-25. File
 * `TÍNH ĐIỂM TỔNG T8.xlsx` xử hai cột theo hai cách: cột điểm đếm cả tài khoản
 * chưa cài app, cột quà thì không.
 */
const REQUIRES_APP = new Set(["VPa", "MSBa"]);

/**
 * Hai mã không triển khai cho khách tham gia Combo 2 (mục 4, lưu ý 1).
 *
 * `LPB` và `MBV` cũng ngoài Combo 2 nhưng không cần tên ở đây: bảng
 * `COMBO_2_TENTHS` không có dòng nào chứa hạng hạn chế, cặp có chúng ra 0 và
 * không thành tổ hợp. `VPb` cũng vậy, giữ tên chỉ để đọc cho rõ; `MSBa` thì
 * bắt buộc, vì bảng có dòng PP và PO.
 */
const OUT_OF_COMBO_2 = new Set(["MSBa", "VPb"]);

/**
 * Mã KHÔNG được vào Combo 1 — Kế toán chốt 2026-09-02: *"MSBa cũng không được
 * trong combo 1 và combo 2"*.
 *
 * Hạng hạn chế (`LPB`, `MBV`, `VPb`) không cần có tên ở đây: `bestComboOf` chặn
 * cả hạng theo `TIER_OF`, trừ ca `VPb` kèm CNKD ở khối cuối hàm.
 *
 * Hệ quả: khách mở đúng một `MSBa` không thành tổ hợp nào. `MSBa` vẫn vào Combo
 * 3 bình thường — bảng mục 2 có ba dòng chứa hạng ưu tiên đi cùng `MSBa`.
 */
const OUT_OF_COMBO_1 = new Set(["MSBa"]);

/** Ngân hàng hạn chế DUY NHẤT được vào Combo 1 khi khách có CNKD (lưu ý 1, ngoại lệ). */
const CNKD_COMBO_1_BANK = "VPb";

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
 * Dòng hạng hạn chế của Combo 1 ghi 0,1 từ bảng 2026-09-15, thay cho dòng "Bank
 * hạn chế (B2b) + CNKD = 1,0" của bảng trước. Đội đọc 0,1 là điểm TỔ HỢP của ca
 * duy nhất được có tổ hợp Combo 1 hạng hạn chế: `VPb` kèm CNKD (lưu ý 1). Khách
 * đó ra 0,1 + 1,0 CNKD = 1,1; kỳ 2026-09-01 ra 1,0. Hạn chế đứng một mình không
 * kèm CNKD vẫn KHÔNG thành tổ hợp, xem `bestComboOf` — giả định G9 và G10 của
 * thể lệ.
 */
const COMBO_1_TENTHS: Record<string, number> = { P: 3, O: 2, R: 1 };
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

/** Tổ hợp thắng của một khách. `size` 0 nghĩa là không thành combo nào. */
type Combo = { tenths: number; size: 0 | 1 | 2 | 3; codes: string[] };

const NO_COMBO: Combo = { tenths: 0, size: 0, codes: [] };

/**
 * Tổ hợp CHO ĐIỂM CAO NHẤT của một khách — dùng chung cho cả điểm lẫn quà.
 *
 * Lấy theo điểm chứ không theo số tài khoản (chốt 07/08, câu 7.4).
 *
 * Duyệt cả ba cỡ tổ hợp rồi lấy max. Mọi dòng combo lớn đều cao hơn HẲN tổ hợp
 * nhỏ nằm trong nó — thấp nhất của Combo 2 là 0,4 so với 0,3 của Combo 1, thấp
 * nhất của Combo 3 là 0,5 so với 0,4 — nên tổ hợp lớn hợp lệ thì luôn thắng và
 * không bao giờ hoà. Duyệt tổ hợp nhỏ chỉ đỡ ca bảng không có dòng nào khớp.
 *
 * `hasCnkd` chỉ dùng cho một ca: `VPb` kèm CNKD là tổ hợp Combo 1 hợp lệ nhưng
 * 0 điểm, nên nó không thắng được bằng phép so điểm. Xem khối cuối hàm.
 */
function bestComboOf(bankCodes: string[], hasCnkd: boolean): Combo {
  // Trùng mã chỉ tính một lần: "02 Bank ưu tiên" nghĩa là hai NGÂN HÀNG khác
  // nhau, hai tài khoản cùng một ngân hàng không thành combo.
  const codes = [...new Set(bankCodes)].filter((code) => code in TIER_OF);

  let best = NO_COMBO;
  const keep = (tenths: number, size: 1 | 2 | 3, picked: string[]) => {
    if (tenths > best.tenths) best = { tenths, size, codes: picked };
  };

  for (let i = 0; i < codes.length; i += 1) {
    // Hạng hạn chế không vào Combo 1 (lưu ý 1), trừ `VPb` kèm CNKD ở khối cuối.
    if (!OUT_OF_COMBO_1.has(codes[i]) && TIER_OF[codes[i]] !== "restricted")
      keep(COMBO_1_TENTHS[signatureOf([codes[i]])] ?? 0, 1, [codes[i]]);

    for (let j = i + 1; j < codes.length; j += 1) {
      for (let k = j + 1; k < codes.length; k += 1) {
        const three = [codes[i], codes[j], codes[k]];
        keep(COMBO_3_TENTHS[signatureOf(three)] ?? 0, 3, three);
      }

      if (!OUT_OF_COMBO_2.has(codes[i]) && !OUT_OF_COMBO_2.has(codes[j])) {
        const two = [codes[i], codes[j]];
        keep(COMBO_2_TENTHS[signatureOf(two)] ?? 0, 2, two);
      }
    }
  }

  /**
   * Dòng "Bank hạn chế = 0,1" của Combo 1: ca duy nhất hạng hạn chế thành tổ
   * hợp là `VPb` kèm CNKD (lưu ý 1, ngoại lệ), ra 0,1 điểm tổ hợp và bậc TH7.
   *
   * ⚠️ CHỈ `VPb`. `LPB` và `MBV` kèm CNKD không có ngoại lệ nào: không thành tổ
   * hợp, khách chỉ có 1,0 điểm CNKD. `hasCnkd` đã xét khách có CNKD ở ngân
   * hàng nào cũng được, nên ở đây chỉ cần `VPb` có mặt.
   *
   * Phải xét sau vòng lặp và phải kèm `best.size === 0`: khách đã có tổ hợp
   * khác — `VPb` + `TPB` + CNKD là Combo 1 của `TPB` — thì không đi vào đây.
   */
  if (best.size === 0 && hasCnkd && codes.includes(CNKD_COMBO_1_BANK))
    best = { tenths: COMBO_1_TENTHS.R, size: 1, codes: [CNKD_COMBO_1_BANK] };

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
 *
 * `hasCnkd` để `false` vì hàm chỉ nhận mã ngân hàng. Ca `VPb` kèm CNKD ra 0,1
 * ở đường điểm thật (`bankingPoints`); cột ĐIỂM COMBO của báo cáo ghi 0 cho ca
 * đó.
 */
export const comboPointsFor = (bankCodes: string[]): number => {
  const accounts = bankCodes.map((bankCode) => ({ bankCode }) as ScoringAccount);
  if (hasBothVpModes(accounts)) return 0;
  return bestComboOf(bankCodes, false).tenths / 10;
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
 * Hai con số Kế toán đưa tự chứng minh mức 1,0:
 *
 *   CNKD đi một mình là `VPb` = 1,0 → 0 của Combo 1 hạng hạn chế + 1,0
 *   CNKD đi một mình là `VPa` = 1,3 → 0,3 của Combo 1 hạng ưu tiên + 1,0
 */
const CNKD_TENTHS = 10;

/** Điểm HKD (thể lệ mục 4d, yêu cầu 2026-09-02). */
const HKD_TENTHS = 30;

/**
 * Ngân hàng CHỦ của từng mã hộ kinh doanh.
 *
 *   `CNKD` → BẤT KỲ ngân hàng nào trong thể lệ (chủ dự án chốt 2026-09-15)
 *   `HKD`  → CHỈ `VPa` (Kế toán chốt 2026-09-02)
 *
 * Kỳ 2026-09-01 chỉ nhận CNKD kèm `VPa` hoặc `VPb`. Nhưng kho mã giới thiệu
 * (P-61) và đường mở tài khoản cho gắn CNKD vào mọi ngân hàng, và danh mục có
 * sẵn bản hướng dẫn CNKD cho MSBa, MSBb, TPB, SHB. Khách mở MSBb kèm CNKD mà
 * ra 0 điểm CNKD là luật sai so với nghiệp vụ, không phải dữ liệu sai.
 *
 * Ghi HKD cho khách không mở `VPa` vẫn là DỮ LIỆU SAI, 0 điểm phần này.
 */
const HOUSEHOLD_HOST_BANKS: Record<Exclude<HouseholdKind, "none">, ReadonlySet<string>> = {
  CNKD: new Set(Object.keys(TIER_OF)),
  HKD: new Set(["VPa"]),
};

/**
 * Khách này có những mã hộ kinh doanh nào — đọc CẢ HAI cách ghi (câu 7.16): ô
 * chọn trên dòng ngân hàng, và tài khoản riêng mang mã `CNKD`/`HKD`.
 *
 * Trả về TẬP chứ không phải một mã. Kỳ 2026-08 trả một mã và ưu tiên `CNKD` vì
 * chỉ nó ra điểm; lý do đó mất khi HKD lên 3,0.
 */
function householdKindsOf(accounts: ScoringAccount[]): Set<Exclude<HouseholdKind, "none">> {
  const kinds = new Set<Exclude<HouseholdKind, "none">>();
  for (const account of accounts) {
    if (account.bankCode === "CNKD" || account.household === "CNKD") kinds.add("CNKD");
    if (account.bankCode === "HKD" || account.household === "HKD") kinds.add("HKD");
  }
  return kinds;
}

/**
 * Những dòng ĐƯỢC TÍNH là ngân hàng — bỏ dòng HKD (chủ dự án chốt 2026-09-06).
 *
 * Dòng HKD là một tài khoản VPa riêng, nằm cạnh tài khoản chính. Nó chỉ mang
 * điểm HKD (mục 4d) và hai món Loa, Bảng mica (mục 4b); nó KHÔNG vào combo và
 * KHÔNG đếm vào số ngân hàng. Khách chỉ có dòng HKD thì không có combo nào, còn
 * khách có dòng HKD kèm `TPB` thì là Combo 1 của `TPB`, không phải Combo 2.
 * `VPa` chỉ là ngân hàng khi khách có dòng chính, loại thường hoặc CNKD.
 *
 * `hasBothVpModes` và `hasHousehold` cố ý đọc CẢ dòng HKD: dòng đó vẫn là VPa
 * khi xét "VPa cùng VPb là dữ liệu sai", và vẫn là ngân hàng chủ của chính nó.
 */
const comboRowsOf = (accounts: ScoringAccount[]): ScoringAccount[] =>
  accounts.filter((a) => a.household !== "HKD");

/**
 * Số NGÂN HÀNG khách đã mở — bản dịch của ô `AN` trong file Excel của Kế toán.
 *
 * Đếm ngân hàng khác nhau, không đếm bản ghi: hai tài khoản cùng một ngân hàng
 * vẫn là một. `CNKD`/`HKD` không vào phép đếm vì chúng không có trong `TIER_OF`,
 * và dòng HKD của `VPa` cũng không, xem `comboRowsOf`.
 */
const bankCountOf = (accounts: ScoringAccount[]): number =>
  new Set(
    comboRowsOf(accounts)
      .filter((a) => a.bankCode in TIER_OF)
      .map((a) => a.bankCode),
  ).size;

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
 * Dòng "02 Bank ưu tiên + 01 Bank hạn chế = 0,9" của bảng mục 2 KHÔNG chết theo
 * luật này: nó vẫn đạt được bằng `MB` + `MSBa` + `VPb`.
 */
const hasBothVpModes = (accounts: ScoringAccount[]): boolean =>
  accounts.some((a) => a.bankCode === "VPa") && accounts.some((a) => a.bankCode === "VPb");

/**
 * Mã hộ kinh doanh này CÓ TÍNH không — khách phải mở đúng ngân hàng chủ của nó.
 *
 * Dùng chung cho cả điểm lẫn quà. Một điều kiện, hai đường đọc, nên chỉ có một
 * hàm: tách ra là có ngày điểm cho 3,0 mà rổ quà lại rỗng.
 */
const hasHousehold = (
  accounts: ScoringAccount[],
  kind: Exclude<HouseholdKind, "none">,
): boolean =>
  householdKindsOf(accounts).has(kind) &&
  accounts.some((a) => HOUSEHOLD_HOST_BANKS[kind].has(a.bankCode));

/**
 * Phần điểm hộ kinh doanh của MỘT khách — CNKD (mục 4c) và HKD (mục 4d).
 *
 * Mỗi mã đòi đúng ngân hàng chủ của nó, xem `HOUSEHOLD_HOST_BANKS`. Ngoài vế đó
 * thì KHÔNG xét gì thêm: không xét số ngân hàng, không xét tổ hợp thắng, không
 * xét món khách đã nhận.
 *
 * Khách có cả hai mã thì lấy MỨC CAO HƠN, không cộng dồn (giả định G2 của thể
 * lệ). Viết bằng `Math.max` chứ không viết `if HKD thì trả 30`, để ngày Kế toán
 * hạ mức HKD xuống dưới 1,0 thì luật vẫn đúng ý "lấy mức cao hơn".
 */
function householdTenths(accounts: ScoringAccount[]): number {
  if (hasBothVpModes(accounts)) return 0;
  let tenths = 0;
  if (hasHousehold(accounts, "HKD")) tenths = Math.max(tenths, HKD_TENTHS);
  if (hasHousehold(accounts, "CNKD")) tenths = Math.max(tenths, CNKD_TENTHS);
  return tenths;
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
 * ⚠️ ĐIỂM KHÔNG áp điều kiện cài app — chốt 2026-08-25, câu 7.8. Điều kiện cài
 * app chỉ còn ở đường QUÀ, xem `gift`.
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

    const combo = bestComboOf(
      comboRowsOf(rows).map((a) => a.bankCode),
      hasHousehold(rows, "CNKD"),
    );
    tenths += combo.tenths + householdTenths(rows);
  }
  return tenths / 10;
}

/**
 * Tài khoản còn được vào tổ hợp QUÀ sau khi lọc điều kiện cài app (câu 7.8).
 *
 * CHỈ dùng cho quà. Đường tính điểm không lọc gì — xem `bankingPoints`.
 */
const comboCodesOf = (accounts: ScoringAccount[]): ScoringAccount[] =>
  accounts.filter((a) => !REQUIRES_APP.has(a.bankCode) || a.appInstalled);

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
 * `withinDays` là HẠN CÔNG TY PHẢI CHI, và nó CHỈ ĐỂ HIỆN CHO NGƯỜI ĐỌC — việc
 * chi tiền nằm ngoài hệ thống này (chốt 07/08). Đừng dựng lịch nhắc hay cột
 * trạng thái dựa trên con số này.
 *
 * ⚠️ `VPb` cố ý VẮNG MẶT, đội chốt 2026-09-03, xem thể lệ mục 3c. Mục 1 của thể
 * lệ ghi *"KH sẽ được tặng 20k khi PSGD trong vòng 07 ngày"* cho `VPb`, nhưng
 * bảng quà mục 3 không có dòng nào cho nó. Khoản đó còn đòi tra soát khách có
 * phát sinh giao dịch hay không, mà việc tra soát nằm ngoài hệ thống.
 */
const CASH_OF: Record<string, Omit<GiftCash, "reason">> = {
  // Hạn chi của `VPa` nới từ 3 ngày lên 5, bảng khách gửi 2026-09-03. `MSBa`
  // giữ nguyên 10 ngày như kỳ 2026-08.
  VPa: { bankCode: "VPa", amount: 20_000, withinDays: 5 },
  MSBa: { bankCode: "MSBa", amount: 50_000, withinDays: 10 },
};

/**
 * Rổ bảo hiểm theo bậc quà.
 *
 * Thể lệ chỉ ghi "01 năm BH" / "02 năm BH" mà không nói gói nào — danh sách gói
 * lấy từ spec §5.2 bước 1.
 *
 * Mức 0 là của TH8: Kế toán chốt 2026-09-02 rằng khách Combo 1 mở `VPa` nhận
 * 20k THAY CHO gói bảo hiểm, không nhận cả hai. Nguyên văn: *"được tặng 1 năm
 * bảo hiểm trừ bank VPBa tặng khách 20K nên không tặng 1 năm BH"*.
 *
 * TH7 dùng chung rổ 1 năm với TH1–TH4, vì thể lệ ghi đúng một chữ "01 năm BH"
 * cho cả hai chỗ. Đây là giả định G5 của thể lệ.
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

// TH5 được chọn thêm hai gói đơn 1 năm để tối ưu chi phí. TH6 vẫn giữ nguyên
// bốn lựa chọn của mức 2 năm.
const TH5_INSURANCE_BASKET = [...INSURANCE_BASKET[2], "BH-1N-XEMAY", "BH-1N-DIEN"];

/**
 * Rổ quà thêm của khách có HKD — Kế toán chốt 2026-09-02, tách rổ 2026-09-17.
 *
 * ⚠️ CHỈ `HKD`. Kỳ 2026-08 cho cả `CNKD` lẫn `HKD`, và cũng đòi khách phải mở
 * `VPa`. Kỳ này bỏ cả hai vế đó: có `HKD` là đủ, không cần ngân hàng chủ.
 *
 * Nằm ở `extraBasket`, KHÔNG nằm chung `basket`: khách lấy một món ở đây CỘNG
 * gói bảo hiểm của combo. Bản trước trộn chung nên khách HKD đạt TH5 phải bỏ
 * gói bảo hiểm mới lấy được loa.
 */
const ITEMS_HKD = ["QUA-LOA", "QUA-MICA"];

/**
 * Lưu ý 2 mục 4: nhóm Phòng Y quy đổi quà sang vật phẩm.
 *
 * ⚠️ ĐÒI BẬC TH5 hoặc TH6 — Kế toán chốt 2026-09-02, lật chốt 2026-08-24. Chỉ
 * khách Combo 3 quy đổi được; Combo 1 và Combo 2 thì không.
 */
const ITEMS_HOSPITAL = ["QUA-MI", "QUA-BH-SUC-KHOE", "QUA-NON-BH"];

/** Hai bậc DUY NHẤT cho phép quy đổi quà sang vật phẩm (lưu ý 2 mục 4). */
const GIFT_ITEM_CASES = new Set(["TH5", "TH6"]);

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
 * Bậc thang mục 3 — KHỚP DÒNG ĐẦU THÌ DỪNG, không cộng dồn.
 *
 * `installed` là những mã ĐÃ THOẢ điều kiện cài app. Điều kiện đó chỉ chặn ở
 * ĐÂY, không chặn ở phép đếm số ngân hàng của tổ hợp (chốt 2026-08-25).
 *
 * TH7 và TH8 của Combo 1 LOẠI TRỪ nhau, y như TH1 với TH2 — Kế toán chốt
 * 2026-09-02. Bảng thể lệ viết hai dòng rời nên đọc thoáng ra thành cộng thêm,
 * nhưng Kế toán nói rõ khách `VPa` nhận 20k THAY CHO gói bảo hiểm.
 */
function caseOf(
  combo: Combo,
  installed: ReadonlySet<string>,
): { code: string; years: 0 | 1 | 2; cashBanks: string[] } | null {
  const has = (bankCode: string) => combo.codes.includes(bankCode) && installed.has(bankCode);

  if (combo.size === 1) {
    if (has("VPa")) return { code: "TH8", years: 0, cashBanks: ["VPa"] };
    return { code: "TH7", years: 1, cashBanks: [] };
  }

  if (combo.size === 2) {
    if (has("VPa")) return { code: "TH1", years: 1, cashBanks: ["VPa"] };
    return { code: "TH2", years: 1, cashBanks: [] };
  }

  if (combo.size === 3) {
    if (has("MSBa") && has("VPa")) return { code: "TH3", years: 1, cashBanks: ["VPa", "MSBa"] };
    if (has("MSBa")) return { code: "TH4", years: 1, cashBanks: ["MSBa"] };
    if (has("VPa")) return { code: "TH5", years: 2, cashBanks: ["VPa"] };
    return { code: "TH6", years: 2, cashBanks: [] };
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
 * Xét trên TỔ HỢP THẮNG, không xét mọi tài khoản khách có. `VPb` chỉ được
 * triển khai ở Combo 3 và ở ca `VPb` kèm CNKD (lưu ý 1 mục 4), và đúng hai ca
 * đó mới đưa `VPb` vào tổ hợp thắng. Khách mở `VPb` kèm một ngân hàng khác thì
 * tổ hợp thắng là Combo 1 của ngân hàng kia, nên không có câu này.
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
  /**
   * Tổ hợp đếm TRỌN tài khoản khách đã mở, y hệt đường tính điểm (chốt
   * 2026-08-25). Điều kiện cài app chuyển xuống `caseOf` — nó chỉ quyết định
   * BẬC, không quyết định khách có mấy ngân hàng.
   */
  const combo = bestComboOf(
    comboRowsOf(input.accounts).map((a) => a.bankCode),
    hasHousehold(input.accounts, "CNKD"),
  );
  const eligible = comboCodesOf(comboRowsOf(input.accounts));
  const installed = new Set(eligible.map((a) => a.bankCode));

  /**
   * `VPa` và `MSBa` BẮT BUỘC cài app — Kế toán chốt 2026-09-02: *"không được gì
   * hết, vì khách phải cài app VPa mới được"* và *"MSBa chưa cài app cũng không
   * được gì, bắt buộc MSBa phải cài app vì bank ưu tiên"*.
   *
   * Đúng hai mã của `REQUIRES_APP`. `MB` cũng là bank ưu tiên nhưng ghi chú mục
   * 1 không đòi cài app cho nó, nên `MB` chưa cài vẫn được TH7.
   *
   * Điều kiện xét trên SỐ NGÂN HÀNG khách mở, không xét tổ hợp thắng. Khách mở
   * `VPa` chưa cài kèm `MB` có hai ngân hàng, nên vẫn được TH7 của `MB` — luật
   * này chỉ chặn khách mở đúng một ngân hàng.
   */
  // Xét trên dòng ngân hàng, không xét dòng HKD: khách `VPa` chưa cài app kèm
  // dòng HKD đã cài vẫn là "một ngân hàng bắt buộc cài app mà chưa cài".
  const bankRows = comboRowsOf(input.accounts);
  const onlyUninstalledAppBank =
    bankCountOf(bankRows) === 1 &&
    bankRows.every((a) => !(a.bankCode in TIER_OF) || REQUIRES_APP.has(a.bankCode)) &&
    bankRows.some((a) => a.bankCode in TIER_OF) &&
    !bankRows.some((a) => a.bankCode in TIER_OF && a.appInstalled);

  const matched = onlyUninstalledAppBank ? null : caseOf(combo, installed);
  const explain: string[] = [];

  /**
   * Hai nhóm món thêm, hai luật khác hẳn nhau về điều kiện bậc VÀ về rổ:
   *
   *   Loa · Bảng mica  — chỉ cần khách có `HKD`, KHÔNG đòi bậc, vào RỔ QUÀ THÊM
   *   Mì · BH sức khoẻ · Nón — đòi bậc TH5 hoặc TH6, vào rổ chính thay gói BH
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
  if (hasHousehold(input.accounts, "HKD")) {
    addItems(extraBasket, ITEMS_HKD, "Khách có HKD");
    explain.push("Khách có HKD nên được quà thêm: chọn Loa hoặc Bảng mica, cộng với quà chính.");
  }

  /**
   * Phòng Y, phòng Dự án và kênh Bệnh viện là MỘT nhóm khách. Thoả một trong ba
   * vế là đủ.
   *
   * ⚠️ ĐÒI BẬC TH5 hoặc TH6 — Kế toán chốt 2026-09-02, lật chốt 2026-08-24.
   * Nguyên văn: *"phòng Y (kênh bệnh viện) chỉ được quy đổi quà tặng tại TH5,
   * TH6 thôi, còn combo 1, 2 thì không"*.
   *
   * Hệ quả: khách chưa đủ bậc không còn nhận Mì hay Nón, và khách Combo 1 cũng
   * không. Kỳ 2026-08 thì cả hai nhóm đều nhận.
   */
  const inGiftItemGroup =
    (input.departmentCode !== null && GIFT_ITEM_DEPARTMENTS.has(input.departmentCode)) ||
    input.channelCodes.includes(HOSPITAL_CHANNEL);
  const canSwapGift = inGiftItemGroup && matched !== null && GIFT_ITEM_CASES.has(matched.code);
  if (canSwapGift) {
    addItems(extras, ITEMS_HOSPITAL, "Phòng Y, phòng Dự án hoặc kênh Bệnh viện — bậc TH5/TH6");
    explain.push(
      "Khách thuộc Phòng Y, phòng Dự án hoặc kênh Bệnh viện và đạt bậc TH5 hoặc TH6 nên rổ có thêm Mì, BH sức khoẻ và Nón bảo hiểm.",
    );

    if (input.departmentCode === PHONG_Y) {
      addItems(extras, ITEMS_PHONG_Y, "Phòng Y quy đổi sang quà tặng khác");
      explain.push("Khách thuộc Phòng Y nên rổ có thêm Bảng mica.");
    }
  }

  if (!matched) {
    explain.push(
      onlyUninstalledAppBank
        ? "Khách chỉ mở một ngân hàng bắt buộc cài app, và chưa cài. VPa và MSBa phải cài app mới có quà."
        : eligible.length > 0
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
  for (const c of cash)
    explain.push(
      `Tặng ${c.amount.toLocaleString("vi-VN")}đ vào ${c.bankCode}, chi trong ${c.withinDays} ngày.`,
    );

  const insuranceBasket =
    matched.code === "TH5" ? TH5_INSURANCE_BASKET : INSURANCE_BASKET[matched.years];
  const cashTotal = cash.reduce((sum, c) => sum + c.amount, 0);
  const basket: GiftChoice[] = insuranceBasket.map((code) => ({
    kind: "insurance-package" as const,
    code,
    reason: `${matched.years} năm bảo hiểm của ${matched.code}`,
    cashIfChosen: cashTotal,
  }));
  if (matched.years === 0)
    explain.push("Khách nhận 20.000đ thay cho gói bảo hiểm — thể lệ không cho cả hai.");
  else
    explain.push(
      matched.code === "TH5"
        ? "TH5 được chọn 1 gói bảo hiểm, gồm lựa chọn 1 năm hoặc 2 năm."
        : `Được ${matched.years} năm bảo hiểm — chọn 1 gói trong rổ.`,
    );

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
    explain,
    giftNote: giftNoteOf(combo),
  };
}
