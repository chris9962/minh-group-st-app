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
 * ⚠️ Dạng này sẽ phải nở thêm khi viết file luật thật. Thể lệ kỳ 2026-08 còn
 * đòi "có giao dịch khác ngày mở tài khoản" và "chi tiền vào đúng ngân hàng
 * trong X ngày" — hai điều kiện đó cần thêm cột. Chưa thêm bây giờ vì chưa chốt
 * (12 câu ở `mgst-the-le/2026-08.md` §7), thêm mò là đoán sai rồi phải sửa lại.
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
 * Điểm ngân hàng của MỘT người trong một tháng.
 *
 * Nhận trọn danh sách tài khoản rồi tự gom theo khách — tầng gọi không cần biết
 * luật gom thế nào. Nhờ vậy ngày luật đổi thì chỉ thân hàm này đổi.
 *
 * TODO(KPI, chờ `src/rules/2026-08.ts`): đang trả 0 vì chưa có file luật của kỳ.
 *
 * Trả 0 chứ KHÔNG trả một số cố định khác: số khác 0 nghĩa là mọi nhân viên
 * cùng điểm, trông như dữ liệu thật, ai mở màn KPI sẽ tin. 0 đọc ra ngay là
 * "chưa tính được" — cùng nguyên tắc đang ghi ở đầu `src/server/people.ts`.
 *
 * Công thức CŨ (`Σ banks.coefficient` của tài khoản đã cài app) đã bị bỏ từ
 * 03/08, đừng khôi phục: thang mới nhỏ hơn khoảng 2,5 lần và tính theo tổ hợp
 * hạng ngân hàng trên từng khách (spec §7.1).
 */
export function bankingPointsFor(accounts: ScoringAccount[], yearMonth: string): number {
  void accounts;
  void yearMonth;
  return 0;
}

/** Đã có file luật cho kỳ này chưa — nơi gọi dùng để biết số 0 là thật hay là chưa tính. */
export function hasRulesFor(yearMonth: string): boolean {
  void yearMonth;
  return false;
}
