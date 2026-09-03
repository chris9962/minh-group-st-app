import type { DepartmentType } from "@/lib/types";
import * as period202608 from "./2026-08";
import * as period202609 from "./2026-09";
import type { Tier } from "./2026-08";

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
 * Bốn trường này đủ cho kỳ 2026-08. Thể lệ có nhắc điều kiện "phát sinh giao
 * dịch" và cột `bank_accounts.transaction_at` đã ghi được ngày đó, nhưng kỳ này
 * KHÔNG dùng tới — xem câu 7.8 và 7.15.
 *
 * ⚠️ Kỳ nào cần tới thì thêm trường vào đây và xử trong file kỳ đó. TUYỆT ĐỐI
 * không đẩy điều kiện này xuống ràng buộc database. Database giữ SỰ KIỆN (khách
 * giao dịch ngày nào), file luật giữ CHÍNH SÁCH (ngày đó có tính hay không) —
 * spec §5.3. Ràng buộc DB không có khái niệm "kỳ": đặt luật của tháng 8 vào đó
 * thì tháng 9 đổi luật là kẹt, mà dữ liệu cũ ghi theo luật cũ vẫn phải nằm yên.
 * Đã từng có `bank_accounts_transaction_other_day`, bỏ ở migration 0017.
 */
/**
 * Kiểu hộ kinh doanh kèm theo tài khoản. `none` = không kèm gì.
 *
 * Phải phân biệt `CNKD` với `HKD`, không gộp thành một cờ đúng/sai: từ chốt
 * 2026-08-24 hai mã ăn điểm khác nhau — `CNKD` được 1,0–1,5 điểm còn `HKD` được
 * 0 (thể lệ mục 4c). Phần QUÀ thì vẫn xét chung, mục 4b không tách hai mã.
 */
export type HouseholdKind = "none" | "CNKD" | "HKD";

export type ScoringAccount = {
  /** Gom theo khách: điểm thuộc về CẢ COMBO của một khách, không cộng lẻ từng tài khoản. */
  customerId: string;
  /** Mã ngân hàng — thể lệ phân hạng theo mã (ưu tiên / khác / hạn chế). */
  bankCode: string;
  appInstalled: boolean;
  openedDate: string;
  /**
   * Tài khoản này có kèm đăng ký CNKD/HKD không, và là loại nào.
   *
   * Giao diện ghi nó thành một Ô CHỌN trên chính dòng `VPa`, không phải một
   * tài khoản riêng. Luật phải đọc được cả hai cách ghi: ô chọn ở đây, và
   * `bankCode` bằng `CNKD`/`HKD` khi người dùng lập tài khoản riêng.
   */
  household: HouseholdKind;
};

/**
 * Món quà một khách ĐÃ nhận — `null` khi chưa phát hoặc khách từ chối.
 *
 * Đầu vào của phép tính ĐIỂM từ chốt 2026-08-24 (thể lệ mục 4c): phát `Mì` hay
 * `Nón` cho khách CNKD một tài khoản đưa điểm khách đó xuống mức 0,7 thay vì 1,5.
 *
 * ⚠️ Trước chốt đó, điểm và quà chạy độc lập nhau. Nay điểm phụ thuộc quà, nên
 * MỌI đường ghi `gift_grants` phải gọi lại `recomputeKpiForCustomer` — nếu
 * không thì điểm đứng im sau khi phát quà, và điểm KPI dính tới lương.
 */
export type GrantedGifts = ReadonlyMap<string, string | null>;

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
  /**
   * Món khách ĐÃ nhận; `null` khi chưa phát hoặc khách từ chối.
   *
   * Nó đổi phần TIỀN MẶT: khách chưa đủ tổ hợp nhận 20k của `VPa`, nhưng lấy
   * `Mì` hay `Nón` thì mất khoản đó (`soloCashOf`).
   *
   * KHÔNG đổi rổ quà. Rổ tính xong trước, khách chọn sau, rồi tiền mới biết
   * mình còn hay mất — không có vòng lặp giữa hai thứ.
   */
  grantedItem: string | null;
};

/** Một khoản tiền mặt. Thể lệ ghi rõ tiền vào ngân hàng NÀO và hạn chi mấy ngày. */
export type GiftCash = {
  bankCode: string;
  amount: number;
  /**
   * Hạn công ty phải chi, tính bằng ngày. CHỈ ĐỂ HIỆN — việc chi tiền nằm ngoài
   * hệ thống này (chốt 07/08), không màn nào theo dõi đã chi hay chưa.
   */
  withinDays: number;
  reason: string;
};

/** Một món trong rổ. Trỏ bằng MÃ danh mục, không phải tên — tên đổi được. */
export type GiftChoice = {
  kind: "insurance-package" | "gift-item";
  code: string;
  reason: string;
  /**
   * Tổng tiền mặt khách nhận NẾU lấy đúng món này.
   *
   * Có mặt vì hai món cùng rổ cho ra hai số khác nhau: khách chưa đủ tổ hợp lấy
   * `Loa` thì vẫn giữ 20k, lấy `Mì` thì mất. Không có trường này thì hộp thoại
   * phát quà phải tự biết món nào chặn tiền — tức chép luật xuống giao diện.
   */
  cashIfChosen: number;
};

export type GiftResult = {
  /** `TH1`…`TH6` theo bảng mục 3; `null` khi khách không đủ combo nào. */
  caseCode: string | null;
  /** Số năm bảo hiểm thể lệ hứa — 0 khi không đủ điều kiện. */
  insuranceYears: 0 | 1 | 2;
  /**
   * Điểm KPI của chính tổ hợp này.
   *
   * Trả kèm ở đây vì quà và điểm dùng CHUNG một phép gom combo — hồ sơ khách
   * hiện cả hai cạnh nhau, và hai con số phải đến từ cùng một lượt tính, nếu
   * không sẽ có ngày màn nói "combo 3" mà điểm lại là của combo 2.
   */
  comboPoints: number;
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
  /**
   * Quyền lợi khách được hưởng NGOÀI hệ thống, chỉ để đọc.
   *
   * Khác `explain`: `explain` nói vì sao ra kết quả đã tính, trường này nói tới
   * khoản hệ thống KHÔNG tính. Rỗng khi khách không có khoản nào.
   *
   * Không sinh ra món chọn được, không cộng vào `cashTotal`. Kỳ 2026-09 dùng nó
   * cho 20k của `VPb`, xem thể lệ mục 3c.
   */
  giftNote?: string;
};

type PeriodRules = {
  bankingPoints(accounts: ScoringAccount[], granted: GrantedGifts): number;
  /** Phần điểm CNKD/HKD của MỘT khách, tách khỏi điểm tổ hợp. */
  householdPointsOf(accounts: ScoringAccount[], grantedItem: string | null): number;
  gift(input: GiftInput): GiftResult;
  /** Hạng của một mã ngân hàng; `null` = ngoài thể lệ kỳ đó. */
  bankTierOf(bankCode: string): Tier | null;
  /** Điểm của MỘT tổ hợp mã, không xét khách và không xét cài app. */
  comboPointsFor(bankCodes: string[]): number;
};

/**
 * Các kỳ đã có file luật, khoá là tháng BẮT ĐẦU áp dụng.
 *
 * Thêm kỳ mới thì thêm đúng một dòng ở đây và một file `YYYY-MM.ts` — không nơi
 * nào khác trong ứng dụng biết tên các file kỳ.
 */
const PERIODS: Record<string, PeriodRules> = {
  "2026-08": period202608,
  "2026-09": period202609,
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
 *
 * `granted` mang món quà từng khách ĐÃ nhận (chốt 2026-08-24, thể lệ mục 4c).
 * Bỏ trống thì mọi khách coi như chưa phát quà — dùng được cho ca thử và cho
 * màn xem thử, KHÔNG dùng cho đường ghi `kpi_scores` thật.
 */
export function bankingPointsFor(
  accounts: ScoringAccount[],
  yearMonth: string,
  granted: GrantedGifts = new Map(),
): number {
  const rules = rulesFor(yearMonth);
  if (!rules) return 0;

  // Combo chỉ tính tài khoản mở TRONG tháng đang tính, không nối combo qua
  // tháng (chốt 07/08, câu 7.13). Lọc ở đây để file kỳ nào cũng khỏi tự nhớ.
  return rules.bankingPoints(
    accounts.filter((a) => a.openedDate.startsWith(`${yearMonth}-`)),
    granted,
  );
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

/**
 * Phần điểm CNKD/HKD của MỘT khách, theo luật đang hiệu lực ngày `at`.
 *
 * Tách riêng khỏi `bankingPointsFor` vì hai con số trả lời hai câu khác nhau:
 * điểm tổ hợp quyết định BẬC QUÀ, điểm CNKD thì không. Màn thử quy tắc quà
 * (P-81) hiện cả hai cạnh nhau — bản trước chỉ hiện điểm tổ hợp, nên khách mở
 * đúng một `VPa` kèm CNKD ra "0 điểm" trong khi điểm thật là 1,5.
 *
 * KHÔNG lọc tài khoản theo tháng: nơi gọi tự lo, giống `giftFor`.
 */
export function householdPointsAt(
  accounts: ScoringAccount[],
  at: string,
  grantedItem: string | null = null,
): number {
  return rulesFor(at)?.householdPointsOf(accounts, grantedItem) ?? 0;
}

/**
 * Loại phòng này đã có công thức tính điểm chưa (spec §7.0, chốt 2026-08-22).
 *
 * `sales` — chín phòng Kinh doanh 1–9 — dùng công thức combo ngân hàng cộng hệ
 * số loại dịch vụ (spec §7.1 · §7.2). `office` và người không thuộc phòng nào
 * (Ban giám đốc, tài khoản quản trị) CHƯA có công thức: câu "sáu phòng còn lại
 * tính điểm bằng gì" vẫn chờ đội KD trả lời.
 *
 * Trả `false` nghĩa là CHƯA CHẤM ĐƯỢC, không phải "chấm rồi và được 0 điểm".
 * `server/kpi.ts` vì thế xoá dòng điểm thay vì ghi số 0.
 *
 * Chưa đặt trong file kỳ vì mới có đúng một công thức, và nó không đổi theo
 * tháng. Ngày `office` có công thức riêng thì chuyển phép chọn này vào
 * `PeriodRules` — lúc đó mỗi kỳ mới chọn khác nhau được.
 */
export function kpiAppliesTo(departmentType: DepartmentType | null): boolean {
  return departmentType === "sales";
}

/** Đã có file luật cho kỳ này chưa — nơi gọi dùng để biết số 0 là thật hay là chưa tính. */
export function hasRulesFor(yearMonth: string): boolean {
  return rulesFor(yearMonth) !== null;
}


/**
 * Hạng ngân hàng theo kỳ — `null` khi mã không nằm trong thể lệ, hoặc khi mốc
 * đó chưa có file luật.
 *
 * Báo cáo Tính điểm tổng (P-73 #1) dùng nó để đếm bốn cột `BANK ƯU TIÊN` ·
 * `BANK KHÁC` · `BANK HẠN CHẾ` của file Kế toán.
 */
export function bankTierFor(bankCode: string, at: string): Tier | null {
  return rulesFor(at)?.bankTierOf(bankCode) ?? null;
}

/**
 * Điểm của MỘT tổ hợp mã ngân hàng, theo luật của kỳ.
 *
 * KHÔNG lọc điều kiện cài app và không gom theo khách — nơi gọi tự lo. Dùng cho
 * cột `ĐIỂM COMBO 2` / `ĐIỂM COMBO 3` của báo cáo Tính điểm tổng; đường tính
 * điểm thật vẫn đi qua `bankingPointsFor`.
 */
export function comboPointsAt(bankCodes: string[], at: string): number {
  return rulesFor(at)?.comboPointsFor(bankCodes) ?? 0;
}
