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
 * Thể lệ kỳ **2026-08** — điểm KPI và quà tặng.
 *
 * Nguồn: `../../../mgst-the-le/2026-08.md` mục 1 (phân hạng ngân hàng), mục 2
 * (bảng điểm), mục 3 (bảng quà TH1–TH6), mục 4 (hai lưu ý). Thể lệ chỉ ghi "01
 * năm BH" mà không nói gói nào, nên phần rổ quà lấy theo spec §5.2 — hai tài
 * liệu khớp nhau từng bậc, xem `giftOf`.
 *
 * File của một kỳ ĐÓNG BĂNG VĨNH VIỄN (spec §5.3). Tháng sau thể lệ đổi thì
 * thêm `2026-09.ts`, không sửa file này: sửa nó là đổi điểm của một kỳ đã trả
 * lương xong và đổi quà đã hứa với khách.
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

/** Tổ hợp thắng của một khách. `size` 0 nghĩa là không thành combo nào. */
type Combo = { tenths: number; size: 0 | 2 | 3; codes: string[] };

const NO_COMBO: Combo = { tenths: 0, size: 0, codes: [] };

/**
 * Tổ hợp CHO ĐIỂM CAO NHẤT của một khách — dùng chung cho cả điểm lẫn quà.
 *
 * Lấy theo điểm chứ không theo số tài khoản (chốt 07/08, câu 7.4): dữ liệu có
 * dư 4 tài khoản thì bỏ bớt cái kéo điểm xuống.
 *
 * Duyệt cả tổ hợp 2 lẫn tổ hợp 3 rồi lấy max. Duyệt tổ hợp 2 KHÔNG phải để hạ
 * điểm khách có 3 tài khoản: mọi dòng combo 3 đều cao hơn HẲN tổ hợp 2 nằm
 * trong nó (thấp nhất 0.5 so với 0.4), nên tổ hợp 3 hợp lệ thì luôn thắng và
 * không bao giờ hoà. Nhánh combo 2 chỉ đỡ ca bảng không có dòng nào khớp.
 *
 * Số tổ hợp phải duyệt chỉ hàng chục — mỗi khách tối đa 3 tài khoản theo luật
 * ngoài đời, và danh mục có 10 mã ngân hàng tham gia. Không đáng tối ưu.
 */
function bestComboOf(bankCodes: string[]): Combo {
  // Trùng mã chỉ tính một lần: "02 Bank ưu tiên" nghĩa là hai NGÂN HÀNG khác
  // nhau, hai tài khoản cùng một ngân hàng không thành combo.
  const codes = [...new Set(bankCodes)].filter((code) => code in TIER_OF);

  let best = NO_COMBO;
  const keep = (tenths: number, size: 2 | 3, picked: string[]) => {
    if (tenths > best.tenths) best = { tenths, size, codes: picked };
  };

  for (let i = 0; i < codes.length; i += 1)
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
export const comboPointsFor = (bankCodes: string[]): number => bestComboOf(bankCodes).tenths / 10;

/**
 * Điểm ngân hàng của MỘT người trong kỳ.
 *
 * Hai việc lọc đã làm trước khi tới đây: `src/rules/index.ts` cắt còn tài khoản
 * mở trong đúng tháng đang tính (câu 7.13), tầng gọi cắt còn tài khoản `done`
 * của những khách do NGƯỜI NÀY lập hồ sơ (câu 7.11).
 *
 * Điểm mỗi khách gồm HAI phần cộng lại: điểm tổ hợp ngân hàng (mục 2) và điểm
 * CNKD/HKD (mục 4c). Khách chỉ có CNKD mà không đủ tổ hợp vẫn ra điểm, nên phải
 * duyệt theo TOÀN BỘ tài khoản của khách chứ không theo danh sách đã lọc combo.
 */
export function bankingPoints(accounts: ScoringAccount[], granted: GrantedGifts): number {
  const byCustomer = new Map<string, ScoringAccount[]>();
  for (const account of accounts) {
    const rows = byCustomer.get(account.customerId);
    if (rows) rows.push(account);
    else byCustomer.set(account.customerId, [account]);
  }

  let tenths = 0;
  for (const [customerId, rows] of byCustomer) {
    const combo = bestComboOf(comboCodesOf(rows).map((a) => a.bankCode));
    tenths += combo.tenths + householdTenths(rows, combo, granted.get(customerId) ?? null);
  }
  return tenths / 10;
}

/** Tài khoản còn được vào combo sau khi lọc điều kiện cài app (câu 7.8). */
const comboCodesOf = (accounts: ScoringAccount[]): ScoringAccount[] =>
  accounts.filter((a) => !REQUIRES_APP.has(a.bankCode) || a.appInstalled);

/* ── Mục 4c · điểm CNKD/HKD (chốt 2026-08-24) ────────────────────────── */

/**
 * Điểm CNKD, ghi bằng ĐƠN VỊ 1/10 ĐIỂM như bảng combo.
 *
 * `HKD` cố ý vắng mặt — nó được 0 điểm. Đo trên `TÍNH ĐIỂM TỔNG T8.xlsx`: cả 39
 * dòng HKD đều 0, còn 5.925/5.940 dòng CNKD khớp ba mức dưới đây.
 */
const CNKD_TENTHS = {
  /** Khách không đủ tổ hợp nào, và chưa nhận Mì/Nón. */
  alone: 15,
  /** Khách có tổ hợp — CNKD chỉ cộng thêm 1 điểm. */
  withCombo: 10,
  /** Khách không đủ tổ hợp, nhưng ĐÃ nhận Mì hoặc Nón. */
  afterGiftItem: 7,
} as const;

/**
 * Hai món đưa điểm CNKD xuống mức 0,7 (thông báo Kế toán 2026-08-24).
 *
 * Đây là phép CHỌN MỨC, không phải phép trừ: thông báo ghi *"điểm của bạn chỉ
 * có 0.7"* và *"không tặng thì vẫn hưởng 1.5đ"* — hai mức, không có số bị trừ.
 * Viết thành `1.5 - 0.8` thì ngày Kế toán đổi mức nền sẽ có người sửa nhầm.
 *
 * `QUA-BH-SUC-KHOE` cùng nhóm Phòng Y nhưng KHÔNG nằm đây: thông báo chỉ nêu Mì
 * và Nón. Kế toán xác nhận thì thêm vào, đừng tự suy ra từ "cùng nhóm".
 */
const CNKD_LOWERING_ITEMS = new Set(["QUA-MI", "QUA-NON-BH"]);

/**
 * Khách này có CNKD hay HKD — đọc CẢ HAI cách ghi (câu 7.16): ô chọn trên dòng
 * `VPa`, và tài khoản riêng mang mã `CNKD`/`HKD`.
 *
 * `CNKD` thắng khi khách có cả hai, vì chỉ nó ra điểm.
 */
function householdKindOf(accounts: ScoringAccount[]): HouseholdKind {
  if (accounts.some((a) => a.bankCode === "CNKD" || a.household === "CNKD")) return "CNKD";
  if (accounts.some((a) => a.bankCode === "HKD" || a.household === "HKD")) return "HKD";
  return "none";
}

/** Phần điểm CNKD của MỘT khách, theo bảng mục 4c. */
function householdTenths(
  accounts: ScoringAccount[],
  combo: Combo,
  grantedItem: string | null,
): number {
  if (householdKindOf(accounts) !== "CNKD") return 0;
  if (combo.size !== 0) return CNKD_TENTHS.withCombo;
  return grantedItem && CNKD_LOWERING_ITEMS.has(grantedItem)
    ? CNKD_TENTHS.afterGiftItem
    : CNKD_TENTHS.alone;
}

/* ── Mục 3 · quà tặng ────────────────────────────────────────────────── */

/**
 * Tiền mặt của từng ngân hàng (mục 1, cột Ghi chú).
 *
 * `withinDays` là HẠN CÔNG TY PHẢI CHI, và nó CHỈ ĐỂ HIỆN CHO NGƯỜI ĐỌC — việc
 * chi tiền nằm ngoài hệ thống này (chốt 07/08), không có bảng nào theo dõi đã
 * chi hay chưa và cũng không định có. Đừng dựng lịch nhắc hay cột trạng thái
 * dựa trên con số này.
 */
const CASH_OF: Record<string, Omit<GiftCash, "reason">> = {
  VPa: { bankCode: "VPa", amount: 20_000, withinDays: 3 },
  MSBa: { bankCode: "MSBa", amount: 50_000, withinDays: 10 },
};

/**
 * Rổ bảo hiểm theo số năm thể lệ hứa.
 *
 * Thể lệ chỉ ghi "01 năm BH" / "02 năm BH" mà không nói gói nào — danh sách gói
 * lấy từ spec §5.2 bước 1, và hai tài liệu khớp nhau từng bậc:
 *
 *   spec "app ≥ 3 và có MSBa" = thể lệ TH3/TH4 (Combo 3 có B4a) → 1 năm
 *   spec "app ≥ 3"            = thể lệ TH5/TH6 (Combo 3 không B4a) → 2 năm
 *   spec "app = 2"            = thể lệ TH1/TH2 (Combo 2) → 1 năm
 *
 * Mức 1 năm chỉ có hai gói đơn vì một năm còn lại đã quy đổi thành 50k tiền mặt
 * (spec §5.2, ghi chú dưới bảng).
 */
const INSURANCE_BASKET: Record<1 | 2, string[]> = {
  1: ["BH-1N-XEMAY", "BH-1N-DIEN"],
  2: ["BH-COMBO-1N", "BH-2N-XEMAY", "BH-2N-DIEN-100K", "BH-1N-DIEN-200K"],
};

/** Món thêm — spec §5.2 bước 2, mọi dòng khớp đều góp, không dừng ở dòng đầu. */
const ITEMS_CNKD = ["QUA-LOA", "QUA-MICA"];
/** Lưu ý 2 mục 4: nhóm Phòng Y quy đổi quà sang vật phẩm. Không đòi bậc từ 2026-08-24. */
const ITEMS_HOSPITAL = ["QUA-MI", "QUA-BH-SUC-KHOE", "QUA-NON-BH"];

const HOSPITAL_CHANNEL = "KENH-BENH-VIEN";
/**
 * Ba vế của cùng MỘT nhóm khách — thoả một vế là đủ (thể lệ mục 4b).
 *
 * `PHONG-DU-AN` thêm 2026-08-24: file `TÍNH ĐIỂM TỔNG T8.xlsx` có 166 dòng `MÌ`
 * và 22 dòng `NÓN` mang nhóm `DỰ ÁN`, mà bản trước chỉ nhận Phòng Y.
 */
const GIFT_ITEM_DEPARTMENTS = new Set(["PHONG-Y", "PHONG-DU-AN"]);

/** Bậc thang mục 3 — KHỚP DÒNG ĐẦU THÌ DỪNG, không cộng dồn. */
function caseOf(combo: Combo): { code: string; years: 1 | 2; cashBanks: string[] } | null {
  const has = (bankCode: string) => combo.codes.includes(bankCode);

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
 * Quà của MỘT khách.
 *
 * Ba bước, đúng thứ tự spec §5.2: tiền mặt cộng dồn (khách không phải chọn) →
 * rổ quà gộp lại → khách lấy đúng một món hoặc từ chối. Rổ trộn món giá trị rất
 * khác nhau (2 năm bảo hiểm nằm cạnh gói mì) nên màn chọn quà phải hiện rõ giá
 * trị từng món — chỗ đó là việc của giao diện, không phải của file này.
 *
 * ⚠️ Xét trên TỔ HỢP THẮNG, không phải trên mọi tài khoản khách có. Khách dư
 * tài khoản mà `VPa` không nằm trong tổ hợp thắng thì không tính 20k của `VPa`.
 * Ca này chỉ xảy ra với dữ liệu dư (luật ngoài đời giới hạn 3 tài khoản).
 */
export function gift(input: GiftInput): GiftResult {
  const eligible = comboCodesOf(input.accounts);
  const combo = bestComboOf(eligible.map((a) => a.bankCode));
  const matched = caseOf(combo);
  const explain: string[] = [];

  /**
   * MÓN THÊM XÉT TRƯỚC COMBO.
   *
   * Ba điều kiện dưới đây quyết định món quà, không quyết định điểm. Chúng
   * không phụ thuộc số tài khoản (spec §5.2 xếp thành bước 2 riêng, và bước 1
   * đã có sẵn dòng "tổng app ≤ 1 → không góp món nào").
   *
   * Bản trước xét chúng SAU khi thoát vì khách chưa đủ bậc, nên khách 1 tài
   * khoản đến từ kênh Bệnh viện nhận rổ rỗng.
   */
  const extras: GiftChoice[] = [];
  const addItems = (codes: string[], reason: string) => {
    for (const code of codes) {
      if (extras.some((b) => b.code === code)) continue;
      extras.push({ kind: "gift-item", code, reason });
    }
  };

  /**
   * Xét trên TÀI KHOẢN KHÁCH ĐÃ MỞ, không xét tổ hợp thắng (chốt 2026-08-24).
   *
   * Bản trước đọc `combo.codes`, nên khách chỉ mở đúng một tài khoản `VPa` kèm
   * CNKD không có tổ hợp thắng nào và mất luôn hai món. File
   * `TÍNH ĐIỂM TỔNG T8.xlsx` có 47 khách đúng dạng đó vẫn nhận Bảng mica.
   *
   * Đây là ngoại lệ có ghi của câu 7.15 — bậc quà và tiền mặt thì vẫn xét trên
   * tổ hợp thắng.
   */
  const hasHousehold = householdKindOf(input.accounts) !== "none";
  if (input.accounts.some((a) => a.bankCode === "VPa") && hasHousehold) {
    addItems(ITEMS_CNKD, "Mở VPa kèm CNKD/HKD");
    explain.push("Mở VPa kèm CNKD hoặc HKD nên rổ có thêm Loa và Bảng mica.");
  }

  /**
   * Phòng Y, phòng Dự án và kênh Bệnh viện là MỘT nhóm khách. Thoả một trong ba
   * vế là đủ, và KHÔNG vế nào đòi bậc quà (chốt 2026-08-24).
   *
   * ⚠️ LẬT chốt 2026-08-22 "phải đạt TH5 hoặc TH6". Thông báo của Kế toán
   * 2026-08-24 mô tả khách CNKD một tài khoản `VPa` được tặng Mì hoặc Nón như
   * một ca bình thường, mà khách một tài khoản không bao giờ đạt TH5/TH6.
   *
   * Ba món giữ nguyên danh sách cũ. Bảng gốc chỉ gọi tên nón và mì, phần "một
   * số quà tặng khác" vẫn treo ở câu 7.9 của file thể lệ.
   */
  const inGiftItemGroup =
    (input.departmentCode !== null && GIFT_ITEM_DEPARTMENTS.has(input.departmentCode)) ||
    input.channelCodes.includes(HOSPITAL_CHANNEL);
  if (inGiftItemGroup) {
    addItems(ITEMS_HOSPITAL, "Phòng Y, phòng Dự án hoặc kênh Bệnh viện");
    explain.push(
      "Khách thuộc Phòng Y, phòng Dự án hoặc kênh Bệnh viện nên rổ có thêm Mì, BH sức khoẻ và Nón bảo hiểm.",
    );

    // Nhân viên phải biết TRƯỚC khi bấm chọn, không phải sau khi thấy điểm tụt.
    if (combo.size === 0 && householdKindOf(input.accounts) === "CNKD")
      explain.push(
        "⚠️ Khách CNKD chưa đủ tổ hợp: chọn Mì hoặc Nón làm điểm của khách này giảm từ 1,5 xuống 0,7.",
      );
  }

  if (!matched) {
    explain.push(
      combo.size === 0 && eligible.length > 0
        ? "Khách chưa đủ tổ hợp 2 ngân hàng theo thể lệ nên chưa có quà."
        : "Khách chưa mở tài khoản nào tính được vào thể lệ.",
    );
    return {
      caseCode: null,
      insuranceYears: 0,
      comboPoints: combo.tenths / 10,
      cash: [],
      cashTotal: 0,
      // Chưa đạt bậc nào thì không có gói bảo hiểm, nhưng món thêm vẫn phát.
      basket: extras,
      explain,
    };
  }

  explain.unshift(
    `Tổ hợp ${combo.size} ngân hàng: ${combo.codes.join(" + ")} — trường hợp ${matched.code}.`,
  );

  const cash: GiftCash[] = matched.cashBanks.map((bankCode) => ({
    ...CASH_OF[bankCode],
    reason: `Mở ${bankCode} trong tổ hợp ${matched.code}`,
  }));
  for (const c of cash)
    explain.push(`Tặng ${c.amount.toLocaleString("vi-VN")}đ vào ${c.bankCode}, chi trong ${c.withinDays} ngày.`);

  const basket: GiftChoice[] = INSURANCE_BASKET[matched.years].map((code) => ({
    kind: "insurance-package" as const,
    code,
    reason: `${matched.years} năm bảo hiểm của ${matched.code}`,
  }));
  explain.push(`Được ${matched.years} năm bảo hiểm — chọn 1 gói trong rổ.`);

  // Gói bảo hiểm đứng TRƯỚC món thêm trong rổ. Rổ trộn món giá trị rất khác
  // nhau, và khách đọc từ trên xuống (spec §5.2 cảnh báo ca "lấy mì trong khi
  // đủ điều kiện nhận 2 năm bảo hiểm").
  basket.push(...extras);

  return {
    caseCode: matched.code,
    insuranceYears: matched.years,
    comboPoints: combo.tenths / 10,
    cash,
    cashTotal: cash.reduce((sum, c) => sum + c.amount, 0),
    basket,
    explain,
  };
}
