import { z } from 'zod';
import { InsuranceProduct, RoleKey } from '@/lib/types';
import type { BankAccountQuery } from './banking';
import type { PageQuery } from './pagination';

/**
 * P-73 báo cáo #1 · Tính điểm tổng — MỘT KHÁCH MỘT DÒNG.
 *
 * Dựng lại đúng hình dạng sheet `TỔNG` của `TÍNH ĐIỂM TỔNG T8.xlsx`, file Kế
 * toán đang dùng thật. Ánh xạ từng cột ghi ở `mgst-the-le/2026-08.md` mục 4c.
 *
 * Khác `BankAccountRow` ở chỗ đó: kia là MỘT TÀI KHOẢN một dòng, cho màn danh
 * sách P-21. Không gộp hai hợp đồng làm một — màn danh sách không cần điểm, còn
 * báo cáo này không cần id tài khoản.
 */
export const ScoringExportRow = z.object({
  customerId: z.string(),
  customerName: z.string(),
  /** CCCD đầy đủ. Route gác bằng `customer:access-id-number`. */
  idNumber: z.string(),
  phone: z.string(),
  /** `YYYY-MM-DD`; `''` = hồ sơ chưa có ngày sinh. */
  dob: z.string(),
  /** Ngày mở tài khoản SỚM NHẤT của khách — cột `NGÀY` của file. */
  date: z.string(),
  /** Dạng `ẤP/XÃ`, tách từ `customers.channel_detail`. */
  hamlet: z.string(),
  channelName: z.string(),
  /** Mã ngân hàng khách đã mở tính vào combo, KHÔNG gồm `CNKD`/`HKD` và không gồm dòng VPa HKD. */
  openedBanks: z.array(z.string()),
  msbAccountNumber: z.string(),
  /** `CNKD` · `HKD` · rỗng. */
  /** Loại hộ kinh doanh của tài khoản VPa: `CNKD`, `HKD` hoặc rỗng. Hai cột vì HKD mở được ở nhiều ngân hàng từ kỳ 2026-10-01. */
  householdVpa: z.string(),
  /** Như trên, của tài khoản MB. */
  householdMb: z.string(),
  /** Mã ngân hàng đã cài app trên thiết bị, đọc cả dòng VPa HKD. */
  installedBanks: z.array(z.string()),
  /** Món đã giao kèm tiền đã ghi, đọc từ đợt phát. Rỗng khi chưa phát. */
  giftReport: z.string(),
  /** Trọn rổ luật tính theo tài khoản hiện tại, mọi khách. */
  giftCombo: z.string(),
  /** Trọn rổ lúc phát, đọc từ `snapshot`. Rỗng khi chưa phát. Khác cột trên là khách cần đổi quà. */
  giftBasketAtGrant: z.string(),
  speaker: z.string(),
  insuranceLabel: z.string(),
  licensePlate: z.string(),
  beneficiaryName: z.string(),
  staffCode: z.string(),
  departmentName: z.string(),
  priorityCount: z.number(),
  otherCount: z.number(),
  restrictedCount: z.number(),
  combo2Points: z.number(),
  combo3Points: z.number(),
  householdPoints: z.number(),
  totalPoints: z.number(),
});
export type ScoringExportRow = z.infer<typeof ScoringExportRow>;

const ScoringExportPage = z.object({
  rows: z.array(ScoringExportRow),
  total: z.number(),
});

/**
 * Khách nào vào file — xem `ScoringInclude` ở `server/exports.ts`.
 *
 * `with-accounts` là mặc định và là hình dạng cũ của báo cáo.
 */
export const SCORING_INCLUDE = ['with-accounts', 'all'] as const;
export type ScoringInclude = (typeof SCORING_INCLUDE)[number];

export const SCORING_INCLUDE_LABEL: Record<ScoringInclude, string> = {
  'with-accounts': 'Chỉ khách có tài khoản',
  all: 'Tất cả khách',
};

/**
 * TRỌN danh sách khớp bộ lọc, đã gộp theo khách ở máy chủ.
 *
 * `total` đếm KHÁCH, không đếm tài khoản — nơi gọi so với `rows.length` để biết
 * đã chạm trần chưa, mà một file thiếu dòng trông y hệt file đủ.
 */
export async function fetchScoringExport(
  /** `address`: địa chỉ xã/ấp chọn từ danh mục, cùng chuỗi với ô lọc P-40. */
  query: Omit<BankAccountQuery, keyof PageQuery> & { address?: string },
  include: ScoringInclude = 'with-accounts',
  /**
   * Bỏ CCCD, số điện thoại và ngày sinh khỏi mỗi dòng — bảng hiện trên màn bật cờ này,
   * đường xuất Excel thì không (chốt 2026-09-04).
   *
   * Cờ cũng là điều kiện để NGƯỜI TỰ XEM MÌNH đi qua cửa quyền: xem
   * `/api/exports/scoring`.
   */
  omitPii = false,
): Promise<{ rows: ScoringExportRow[]; total: number }> {
  const params = new URLSearchParams({
    search: query.search,
    bankCode: query.bankCode,
    from: query.from,
    to: query.to,
    referralCode: query.referralCode,
    channelId: query.channelId,
    staffId: query.staffId,
    status: query.status,
    include,
    ...(query.address ? { address: query.address } : {}),
    ...(omitPii ? { omitPii: '1' } : {}),
  });
  const res = await fetch(`/api/exports/scoring?${params}`);
  if (!res.ok) throw new Error('Không tải được dữ liệu tính điểm tổng');
  return ScoringExportPage.parse(await res.json());
}

/* ── Báo cáo #4 · Số liệu cấp đơn bảo hiểm ──────────────────────────── */

/** Trục gộp của báo cáo — phòng ghi nhận lúc tạo đơn, hoặc người tạo đơn. */
export const OrderStatsGroupBy = z.enum(['department', 'staff']);
export type OrderStatsGroupBy = z.infer<typeof OrderStatsGroupBy>;

/** Một ngày, một nhóm, mười con số. Máy chủ luôn trả theo NGÀY; gộp tháng là việc của giao diện. */
export const OrderStatsCell = z.object({
  day: z.string(),
  groupId: z.string(),
  motorbike: z.number(),
  motorbikeYears: z.number(),
  electric100: z.number(),
  electric200: z.number(),
  health: z.number(),
  motorbikeCancelled: z.number(),
  motorbikeYearsCancelled: z.number(),
  electric100Cancelled: z.number(),
  electric200Cancelled: z.number(),
  healthCancelled: z.number(),
});
export type OrderStatsCell = z.infer<typeof OrderStatsCell>;

export const OrderStatsResult = z.object({
  /** Đúng thứ tự dòng trong sheet. Gộp theo phòng thì có cả phòng 0 đơn; trục nhân viên kèm tên phòng. */
  groups: z.array(z.object({ id: z.string(), label: z.string(), department: z.string().optional() })),
  cells: z.array(OrderStatsCell),
});
export type OrderStatsResult = z.infer<typeof OrderStatsResult>;

/** Số liệu cấp đơn của TRỌN một tháng, `month` dạng `YYYY-MM`. */
export async function fetchOrderStats(
  month: string,
  groupBy: OrderStatsGroupBy,
): Promise<OrderStatsResult> {
  const res = await fetch(`/api/exports/order-stats?month=${month}&groupBy=${groupBy}`);
  if (!res.ok) throw new Error('Không tải được số liệu cấp đơn');
  return OrderStatsResult.parse(await res.json());
}

/* ── Báo cáo #5 · Đơn bảo hiểm huỷ ──────────────────────────────────── */

/**
 * MỘT ĐƠN ĐÃ HUỶ một dòng, kèm lượt huỷ MỚI NHẤT của đơn đó.
 *
 * Đơn huỷ rồi được người có `insurance:set-status` đưa về trạng thái khác thì
 * không còn là đơn huỷ, nên không vào báo cáo — đo trên dữ liệu thật
 * 2026-09-08: 224 lượt huỷ trong 30 ngày nhưng chỉ 220 đơn đang ở `cancelled`.
 */
export const CancelledInsuranceRow = z.object({
  id: z.string(),
  orderCode: z.string(),
  product: InsuranceProduct,
  packageName: z.string(),
  /** Mốc huỷ dạng ISO — giao diện tự đổi sang giờ Việt Nam. */
  cancelledAt: z.string(),
  /** Lý do người huỷ gõ, chữ tự do. Không có danh mục nên không lọc được. */
  reason: z.string(),
  /** Người LẬP đơn, không phải người bấm huỷ. `''` khi tài khoản đã bị xoá. */
  createdById: z.string(),
  createdByName: z.string(),
  /** Tên phòng của người lập lúc lập đơn. */
  departmentName: z.string(),
  customerName: z.string(),
  fee: z.number(),
  orderDate: z.string(),
  /** Người bấm huỷ. Trùng người lập ở phần lớn đơn, khác khi quản trị huỷ giúp. */
  cancelledByName: z.string(),
  /** Trạng thái ngay trước lượt huỷ, mã thô — giao diện tra nhãn. */
  previousStatus: z.string(),
  pviElectronicOrderNo: z.string(),
  /** `PolicyNumber` của API đối tác; rỗng với đơn đi đường bot hoặc làm tay. */
  pviPolicyNumber: z.string(),
  pviSerialNumber: z.string(),
  /** `Policy_GCN` — số in trên giấy của đơn tai nạn điện; rỗng với đơn xe máy. */
  pviPolicyGcn: z.string(),
});
export type CancelledInsuranceRow = z.infer<typeof CancelledInsuranceRow>;

const CancelledInsurancePage = z.object({
  rows: z.array(CancelledInsuranceRow),
  total: z.number(),
});

export type CancelledInsuranceQuery = {
  /** Khoảng NGÀY HUỶ, không phải ngày lập đơn. */
  from: string;
  to: string;
  staffId: string;
  departmentId: string;
  product: InsuranceProduct | '';
};

/**
 * TRỌN danh sách đơn huỷ khớp bộ lọc.
 *
 * `total` đếm mọi đơn khớp lọc, kể cả phần vượt trần một lần xuất — nơi gọi so
 * với `rows.length` để biết đã chạm trần chưa.
 */
export async function fetchCancelledInsuranceExport(
  query: CancelledInsuranceQuery,
): Promise<{ rows: CancelledInsuranceRow[]; total: number }> {
  const params = new URLSearchParams(query);
  const res = await fetch(`/api/exports/cancelled-insurance?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách đơn bảo hiểm huỷ');
  return CancelledInsurancePage.parse(await res.json());
}

/* ── Báo cáo #6 · Quà cấp dư do app lỗi ─────────────────────────────── */

/**
 * MỘT KHÁCH một dòng: đã phát quà, có ít nhất một tài khoản `error`, và đợt đã
 * phát có phần KHÔNG còn trong rổ tính lại theo tài khoản `done` hiện tại.
 *
 * Quà dư là TRỌN món, không trừ chênh lệch bậc (chốt 2026-09-19): gói bảo hiểm
 * 2 năm đã cấp thì không cắt còn 1 năm được.
 */
export const GiftExcessRow = z.object({
  customerId: z.string(),
  customerName: z.string(),
  idNumber: z.string(),
  /** Tài khoản đang `error`, sắp theo mã ngân hàng. Không bao giờ rỗng. */
  errorAccounts: z.array(z.object({ id: z.string(), bankCode: z.string() })),
  /** Mốc phát dạng ISO — giao diện tự đổi sang giờ Việt Nam. */
  grantedAt: z.string(),
  grantedItem: z.string(),
  /** `''` khi đợt không có quà thêm hoặc khách từ chối. */
  grantedExtra: z.string(),
  grantedCash: z.number(),
  /** Mã bậc `THn` lúc phát và theo tài khoản hiện tại; `''` khi không đủ bậc nào. */
  caseAtGrant: z.string(),
  caseNow: z.string(),
  /** Ba phần dư; chuỗi rỗng và số 0 là phần đó không dư. Ít nhất một phần có giá trị. */
  excessItem: z.string(),
  excessExtra: z.string(),
  excessCash: z.number(),
  /** NGƯỜI LẬP HỒ SƠ khách, cũng là người phát quà. `''` khi tài khoản đã bị xoá. */
  createdByName: z.string(),
  createdByStaffCode: z.string(),
  departmentName: z.string(),
});
export type GiftExcessRow = z.infer<typeof GiftExcessRow>;

/**
 * `total` đếm khách ứng viên (đã phát quà + có tài khoản `error`) khớp bộ lọc;
 * `scanned` là số ứng viên máy chủ đã tính, nhỏ hơn `total` khi chạm trần. Phần
 * dư chỉ biết sau khi chạy luật, nên `rows.length` không so được với `total`.
 */
const GiftExcessPage = z.object({
  rows: z.array(GiftExcessRow),
  scanned: z.number(),
  total: z.number(),
});

export type GiftExcessQuery = {
  /** Khoảng NGÀY PHÁT QUÀ. */
  from: string;
  to: string;
  /** Người lập hồ sơ khách. */
  staffId: string;
  departmentId: string;
  /** Mã ngân hàng của tài khoản `error`, nối bằng dấu phẩy. Rỗng = mọi ngân hàng. */
  bankCode: string;
};

export async function fetchGiftExcessExport(
  query: GiftExcessQuery,
): Promise<{ rows: GiftExcessRow[]; scanned: number; total: number }> {
  const params = new URLSearchParams(query);
  const res = await fetch(`/api/exports/gift-excess?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách quà cấp dư');
  return GiftExcessPage.parse(await res.json());
}

/* ── Khách đã nhận Nón, Mì ──────────────────────────────────────────── */

/** Mã khớp `gift_items.code`. Hai món chỉ có ở rổ quà chính, không có ở rổ quà thêm. */
export const HelmetNoodleItem = z.enum(['QUA-NON-BH', 'QUA-MI']);
export type HelmetNoodleItem = z.infer<typeof HelmetNoodleItem>;

export const HELMET_NOODLE_LABEL: Record<HelmetNoodleItem, string> = {
  'QUA-NON-BH': 'Nón bảo hiểm',
  'QUA-MI': 'Mì',
};

/** Một đợt phát một dòng; một khách chỉ có một đợt phát. */
export const HelmetNoodleRow = z.object({
  customerId: z.string(),
  customerName: z.string(),
  /** CCCD đầy đủ; `''` khi người xuất thiếu `customer:access-id-number`. */
  idNumber: z.string(),
  phone: z.string(),
  /** `YYYY-MM-DD`; `''` = hồ sơ chưa có ngày sinh. */
  dob: z.string(),
  address: z.string(),
  item: HelmetNoodleItem,
  /** Tên món lúc phát, đọc từ `snapshot`. */
  itemName: z.string(),
  /** Mốc phát dạng ISO. */
  grantedAt: z.string(),
  /**
   * Tài khoản `done` hiện tại kèm hạng ngân hàng theo kỳ thể lệ của khách, ví
   * dụ `TPB (ưu tiên), MB (khác), VPa HKD`. Dòng HKD không mang hạng.
   */
  openedAccounts: z.string(),
  grantedByName: z.string(),
  grantedByStaffCode: z.string(),
  /** Phòng của người phát trong tháng phát. */
  grantedByDepartmentName: z.string(),
});
export type HelmetNoodleRow = z.infer<typeof HelmetNoodleRow>;

const HelmetNoodlePage = z.object({
  rows: z.array(HelmetNoodleRow),
  total: z.number(),
});

export type HelmetNoodleQuery = {
  /** Khoảng NGÀY PHÁT QUÀ. */
  from: string;
  to: string;
  /** Phòng của người phát, cùng trục với danh sách Quà đã phát. */
  departmentId: string;
  /** Người phát quà. */
  staffId: string;
  /** Rỗng = cả hai món. */
  item: HelmetNoodleItem | '';
};

export async function fetchHelmetNoodleExport(
  query: HelmetNoodleQuery,
): Promise<{ rows: HelmetNoodleRow[]; total: number }> {
  const params = new URLSearchParams(query);
  const res = await fetch(`/api/exports/helmet-noodle-gifts?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách khách đã nhận Nón, Mì');
  return HelmetNoodlePage.parse(await res.json());
}

/* ── Khách không mở ngân hàng ───────────────────────────────────────── */

/**
 * Một người lập hồ sơ trong một ngày lập hồ sơ một dòng (thêm 2026-10-22).
 *
 * Mỗi hồ sơ vào đúng một trong bốn nhóm: đã mở ngân hàng đang xét, ba cột
 * đếm bên dưới. `total` gồm cả nhóm đã mở, nên ba cột cộng lại nhỏ hơn hoặc
 * bằng `total`.
 */
export const BankNotOpenedRow = z.object({
  /** Ngày lập hồ sơ `YYYY-MM-DD`, mỗi ngày một sheet. */
  day: z.string(),
  fullName: z.string(),
  staffCode: z.string(),
  /** Phòng của người lập trong tháng của `day`. */
  departmentName: z.string(),
  /** Hồ sơ có tài khoản khác, đủ tuổi ngân hàng mà không mở ngân hàng đó. */
  ageFitNotOpened: z.number(),
  /** Hồ sơ ngoài độ tuổi ngân hàng, hoặc khách đã mở ngân hàng đó ở lần mở khác. */
  otherReason: z.number(),
  /** Hồ sơ không có tài khoản ngân hàng nào. */
  noAccount: z.number(),
  total: z.number(),
});
export type BankNotOpenedRow = z.infer<typeof BankNotOpenedRow>;

/** Một khách nhóm "đủ tuổi mà không mở", cho sheet danh sách khách (chốt 2026-10-26). */
export const BankNotOpenedCustomer = z.object({
  day: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  fullName: z.string(),
  staffCode: z.string(),
  departmentName: z.string(),
  /** Lý do không mở ngân hàng đang xét; rỗng khi hồ sơ chưa ghi. */
  reason: z.string(),
});
export type BankNotOpenedCustomer = z.infer<typeof BankNotOpenedCustomer>;

export const BankNotOpenedExport = z.object({
  rows: z.array(BankNotOpenedRow),
  customers: z.array(BankNotOpenedCustomer),
});
export type BankNotOpenedExport = z.infer<typeof BankNotOpenedExport>;

export type BankNotOpenedQuery = {
  /** Khoảng NGÀY LẬP HỒ SƠ. */
  from: string;
  to: string;
  bankId: string;
};

export async function fetchBankNotOpenedExport(query: BankNotOpenedQuery): Promise<BankNotOpenedExport> {
  const params = new URLSearchParams(query);
  const res = await fetch(`/api/exports/bank-not-opened?${params}`);
  if (!res.ok) throw new Error('Không tải được số khách không mở ngân hàng');
  return BankNotOpenedExport.parse(await res.json());
}

/* ── Báo cáo #7 · Ngày công ─────────────────────────────────────────── */

/**
 * Một người một dòng, trừ Giám đốc và Phó giám đốc. Trưởng phòng và Phó phòng
 * có công vào ngày phòng có ít nhất một nhân viên có công, cùng cách màn lương.
 */
export const WorkDayExportRow = z.object({
  fullName: z.string(),
  departmentName: z.string(),
  /** Ngày trong tháng có công, đếm từ 1, tăng dần. `fraction` 0,5 là nửa ngày. */
  days: z.array(z.object({ day: z.number(), fraction: z.number() })),
});
export type WorkDayExportRow = z.infer<typeof WorkDayExportRow>;

export async function fetchWorkDayExport(month: string, departmentId: string): Promise<WorkDayExportRow[]> {
  const params = new URLSearchParams({ month });
  if (departmentId) params.set('departmentId', departmentId);
  const res = await fetch(`/api/exports/work-days?${params}`);
  if (!res.ok) throw new Error('Không tải được ngày công');
  return z.array(WorkDayExportRow).parse(await res.json());
}

/* ── Báo cáo #8 · Lương ─────────────────────────────────────────────── */

/**
 * Phó giám đốc, Trưởng phòng, Phó phòng, Nhân viên của phòng kinh doanh, theo
 * nhân sự của tháng xuất. "App" là tài khoản ngân hàng, tính cho người mở tài
 * khoản; `appsAll` gồm cả `error` và `fixed`, `appsBroken` chỉ hai trạng thái đó.
 */
export const SalaryExportRow = z.object({
  fullName: z.string(),
  staffCode: z.string(),
  role: RoleKey,
  title: z.string(),
  active: z.boolean(),
  /** Phó giám đốc: các phòng kinh doanh được giao quản, ngăn bằng dấu phẩy. */
  departmentName: z.string(),
  appsAll: z.number(),
  appsBroken: z.number(),
  /** Điểm ngân hàng + dịch vụ + BHYT/BHXH, chưa gồm điểm cộng tay. */
  points: z.number(),
  /** Tổng các dòng điểm âm của tháng, số âm. */
  minusPoints: z.number(),
  minusReason: z.string(),
  plusPoints: z.number(),
  plusReason: z.string(),
  salary: z.number(),
  /** Lý do ghi lúc bấm "Không tính điểm phòng"; `null` là vẫn tính điểm phòng. */
  excludedNote: z.string().nullable(),
});
export type SalaryExportRow = z.infer<typeof SalaryExportRow>;

export async function fetchSalaryExport(month: string): Promise<SalaryExportRow[]> {
  const res = await fetch(`/api/exports/salary?${new URLSearchParams({ month })}`);
  if (!res.ok) throw new Error('Không tải được bảng lương');
  return z.array(SalaryExportRow).parse(await res.json());
}

/* ── Báo cáo #9 · Tài khoản định hướng ──────────────────────────────── */

/** Một Nhân viên bị chấm chỉ tiêu định hướng của tháng, cùng tập người với bảng lương. */
export const DirectedExportRow = z.object({
  fullName: z.string(),
  staffCode: z.string(),
  departmentName: z.string(),
  active: z.boolean(),
  achieved: z.number(),
  target: z.number(),
  /** Câu chấm của bảng lương, ví dụ `31/50, thiếu 38%, trừ 38 điểm`. */
  result: z.string(),
});
export type DirectedExportRow = z.infer<typeof DirectedExportRow>;

/** Ô lọc Kết quả; chuỗi rỗng là cả người đạt lẫn chưa đạt. */
export const DirectedResult = z.enum(['reached', 'missed']);
export type DirectedResult = z.infer<typeof DirectedResult>;
export const DIRECTED_RESULT_LABEL: Record<DirectedResult, string> = {
  reached: 'Đạt',
  missed: 'Chưa đạt',
};

export async function fetchDirectedExport(
  month: string,
  result: DirectedResult | '',
): Promise<DirectedExportRow[]> {
  const params = new URLSearchParams({ month });
  if (result) params.set('result', result);
  const res = await fetch(`/api/exports/directed-accounts?${params}`);
  if (!res.ok) throw new Error('Không tải được tài khoản định hướng');
  return z.array(DirectedExportRow).parse(await res.json());
}
