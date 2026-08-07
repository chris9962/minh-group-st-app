import * as period202608 from "./2026-08";

/**
 * Cửa vào DUY NHẤT của công thức tính điểm theo kỳ.
 *
 * Quyết định 03/08: quy tắc quà và công thức điểm là CHÍNH SÁCH, không phải dữ
 * liệu — đổi cả hình dạng theo tháng, nên nằm ở code chứ không ở bảng cấu hình
 * (`mgst-db-design.md` §9, spec §5.3). Mỗi kỳ một file `src/rules/YYYY-MM.ts`,
 * file của kỳ đã qua **đóng băng vĩnh viễn**.
 *
 * File này là chỗ tra file của kỳ. Mọi nơi cần điểm đều đi qua đây, không import
 * thẳng file kỳ — để ngày thêm kỳ mới chỉ phải sửa đúng một chỗ.
 */

/**
 * Một tài khoản ngân hàng đã tính vào điểm, ở dạng công thức cần.
 *
 * KHÔNG phải hàng của bảng `bank_accounts`: hàm luật là hàm thuần, không biết
 * gì về DB (spec §5.3). Tầng gọi có nhiệm vụ đọc DB rồi nắn về dạng này.
 *
 * Bốn trường này đủ cho cả điểm lẫn quà. Thể lệ còn nhắc "có giao dịch khác ngày
 * mở tài khoản" (`bank_accounts.transaction_at` đã có cột) nhưng chưa dùng: nó
 * là điều kiện của khoản tiền 20k cho `VPb`, mà bảng quà mục 3 không có dòng
 * nào cho `VPb` — xem câu 7.15.
 */
export type ScoringAccount = {
  /** Gom theo khách: điểm thuộc về CẢ COMBO của một khách, không cộng lẻ từng tài khoản. */
  customerId: string;
  /** Mã ngân hàng — thể lệ phân hạng theo mã (ưu tiên / khác / hạn chế). */
  bankCode: string;
  appInstalled: boolean;
  openedDate: string;
};

/**
 * Vào của phép tính QUÀ — mọi thứ đã tra sẵn từ database, hàm luật không tự đọc
 * (spec §5.3).
 *
 * Khác phép tính điểm ở chỗ nó cần thêm hai thứ ngoài tài khoản: KÊNH của khách
 * (kênh Bệnh viện góp thêm món vào rổ — spec §5.2 bước 2) và PHÒNG của nhân
 * viên phụ trách (Phòng Y quy đổi quà — thể lệ mục 4 lưu ý 2).
 */
export type GiftInput = {
  /** Tài khoản của ĐÚNG MỘT khách. Truyền nhầm nhiều khách là ra combo không có thật. */
  accounts: ScoringAccount[];
  /** Mã kênh khách đã dùng — mảng, vì mỗi tài khoản mở qua một kênh khác nhau được. */
  channelCodes: string[];
  /** Mã phòng của người phụ trách khách; `null` khi không thuộc phòng nào. */
  departmentCode: string | null;
};

/** Một khoản tiền mặt. Thể lệ ghi rõ tiền vào ngân hàng NÀO và hạn chi mấy ngày. */
export type GiftCash = {
  bankCode: string;
  amount: number;
  /** Hạn công ty phải chi, tính từ ngày khách đủ điều kiện (câu 7.7 chưa chốt mốc đếm). */
  withinDays: number;
  reason: string;
};

/** Một món trong rổ. Trỏ bằng MÃ danh mục, không phải tên — tên đổi được. */
export type GiftChoice = {
  kind: "insurance-package" | "gift-item";
  code: string;
  reason: string;
};

export type GiftResult = {
  /** `TH1`…`TH6` theo bảng mục 3; `null` khi khách không đủ combo nào. */
  caseCode: string | null;
  /** Số năm bảo hiểm thể lệ hứa — 0 khi không đủ điều kiện. */
  insuranceYears: 0 | 1 | 2;
  cash: GiftCash[];
  cashTotal: number;
  /** Khách lấy ĐÚNG MỘT món, hoặc từ chối không lấy gì (spec §5.2 bước 3). */
  basket: GiftChoice[];
  /**
   * Vì sao ra kết quả này, mỗi dòng một lý do.
   *
   * BẮT BUỘC có, không phải trang trí (spec §5.3): khách hỏi "sao tôi chỉ được
   * 1 năm mà người kia được 2 năm" thì nhân viên phải trả lời ngay tại màn.
   */
  explain: string[];
};

type PeriodRules = {
  bankingPoints(accounts: ScoringAccount[]): number;
  gift(input: GiftInput): GiftResult;
};

/**
 * Các kỳ đã có file luật, khoá là tháng BẮT ĐẦU áp dụng.
 *
 * Thêm kỳ mới thì thêm đúng một dòng ở đây và một file `YYYY-MM.ts` — không nơi
 * nào khác trong ứng dụng biết tên các file kỳ.
 */
const PERIODS: Record<string, PeriodRules> = {
  "2026-08": period202608,
};

/**
 * File luật áp cho một mốc thời gian: file mới nhất có ngày áp dụng KHÔNG SAU
 * mốc đó (spec §5.3 — *"lấy file có ngày lớn nhất mà vẫn ≤ ngày đó"*).
 *
 * Nhận cả `YYYY-MM` lẫn `YYYY-MM-DD`; điểm hỏi theo tháng, quà hỏi theo ngày.
 *
 * Nhờ vậy một file dùng được cho nhiều tháng liền: thể lệ ghi "áp dụng từ
 * 01/8/2026" chứ không phải "cho riêng tháng 8". Để rơi về "không có luật" thì
 * sáng mùng 1 tháng 9 cả công ty mất sạch điểm ngân hàng mà không ai báo gì.
 *
 * Mốc TRƯỚC kỳ đầu tiên thì không luật nào áp: công thức cũ bỏ từ 03/08 và
 * không được khôi phục.
 */
function rulesFor(at: string): PeriodRules | null {
  const yearMonth = at.slice(0, 7);
  const applicable = Object.keys(PERIODS)
    .filter((start) => start <= yearMonth)
    .sort();
  const latest = applicable.at(-1);
  return latest ? PERIODS[latest] : null;
}

/**
 * Điểm ngân hàng của MỘT người trong một tháng.
 *
 * Nhận trọn danh sách tài khoản rồi tự gom theo khách — tầng gọi không cần biết
 * luật gom thế nào. Nhờ vậy ngày luật đổi thì chỉ file kỳ đổi.
 *
 * Công thức CŨ (`Σ banks.coefficient` của tài khoản đã cài app) đã bị bỏ từ
 * 03/08, đừng khôi phục: thang mới nhỏ hơn khoảng 2,5 lần và tính theo tổ hợp
 * hạng ngân hàng trên từng khách (spec §7.1).
 */
export function bankingPointsFor(accounts: ScoringAccount[], yearMonth: string): number {
  const rules = rulesFor(yearMonth);
  if (!rules) return 0;

  // Combo chỉ tính tài khoản mở TRONG tháng đang tính, không nối combo qua
  // tháng (chốt 07/08, câu 7.13). Lọc ở đây để file kỳ nào cũng khỏi tự nhớ.
  return rules.bankingPoints(accounts.filter((a) => a.openedDate.startsWith(`${yearMonth}-`)));
}

/**
 * Quà của MỘT khách theo luật đang hiệu lực ngày `at` (`YYYY-MM-DD`).
 *
 * Trả `null` khi ngày đó chưa có file luật — khác hẳn một kết quả có
 * `caseCode: null`. Cái sau nghĩa là "đã tính, khách không đủ điều kiện"; cái
 * này nghĩa là "chưa tính được". Nơi gọi phải phân biệt hai chuyện đó, nếu
 * không màn hình sẽ nói "không có quà" cho một khách đủ điều kiện.
 *
 * KHÔNG lọc tài khoản theo tháng như phép tính điểm: quà xét theo hồ sơ khách và
 * mỗi khách chỉ có đúng một đợt, không có "quà của tháng 8". Xem câu 7.15.
 */
export function giftFor(input: GiftInput, at: string): GiftResult | null {
  const rules = rulesFor(at);
  return rules ? rules.gift(input) : null;
}

/** Đã có file luật cho kỳ này chưa — nơi gọi dùng để biết số 0 là thật hay là chưa tính. */
export function hasRulesFor(yearMonth: string): boolean {
  return rulesFor(yearMonth) !== null;
}
