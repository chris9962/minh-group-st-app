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
 * Bốn trường này đủ cho phần ĐIỂM. Phần QUÀ sẽ đòi thêm: thể lệ 2026-08 yêu cầu
 * "có giao dịch khác ngày mở tài khoản" và "chi tiền vào đúng ngân hàng trong X
 * ngày" (`transaction_at` đã có cột, mốc đếm ngày thì chưa). Chưa thêm bây giờ
 * vì ba câu 7.5 · 7.6 · 7.10 chưa chốt — thêm mò là đoán sai rồi phải sửa lại.
 */
export type ScoringAccount = {
  /** Gom theo khách: điểm thuộc về CẢ COMBO của một khách, không cộng lẻ từng tài khoản. */
  customerId: string;
  /** Mã ngân hàng — thể lệ phân hạng theo mã (ưu tiên / khác / hạn chế). */
  bankCode: string;
  appInstalled: boolean;
  openedDate: string;
};

type PeriodRules = {
  bankingPoints(accounts: ScoringAccount[]): number;
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
 * File luật áp cho `yearMonth`: file mới nhất có mốc áp dụng KHÔNG SAU tháng đó.
 *
 * Thể lệ ghi "áp dụng từ 01/8/2026" chứ không phải "cho riêng tháng 8", nên
 * tháng 9 chưa có thể lệ mới thì vẫn tính bằng thể lệ tháng 8. Để rơi về 0 thì
 * sáng mùng 1 tháng 9 cả công ty mất sạch điểm ngân hàng mà không ai báo gì.
 *
 * Tháng TRƯỚC kỳ đầu tiên thì không luật nào áp: công thức cũ bỏ từ 03/08 và
 * không được khôi phục.
 */
function rulesFor(yearMonth: string): PeriodRules | null {
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

/** Đã có file luật cho kỳ này chưa — nơi gọi dùng để biết số 0 là thật hay là chưa tính. */
export function hasRulesFor(yearMonth: string): boolean {
  return rulesFor(yearMonth) !== null;
}
