import { z } from 'zod';
import type { Period } from '@/components/ui/PeriodPicker';
import { periodKey } from '@/components/ui/PeriodPicker';
import { PersonDetail } from './person';

/** Số liệu cho P-80 Dashboard tổng. */

/**
 * Một dòng xếp hạng phòng — dùng chung với P-91 (Phòng ban) qua
 * `src/lib/api/org.ts` nên tách riêng, không khai lại cùng hình dạng ở hai
 * chỗ.
 */
export const DepartmentRanking = z.object({
  id: z.string(),
  name: z.string(),
  accountsOpened: z.number(),
  appsInstalled: z.number(),
  /**
   * Khách CÓ tài khoản: hồ sơ LẬP trong kỳ và có ít nhất một tài khoản hoàn
   * thành (chốt 2026-09-12). Trục khác hai số trên (tài khoản MỞ trong kỳ),
   * cùng trục với `BankingSummary.customersWithAccounts`.
   */
  customers: z.number(),
  /**
   * Tỉ lệ cài của kỳ liền trước, để so tăng/giảm. `null` khi không có kỳ nào
   * để so — người dùng tự chọn khoảng ngày.
   */
  previousInstallRate: z.number().nullable(),
  /**
   * Tổng điểm KPI của dòng này TRONG KỲ XEM.
   *
   * `null` khi nơi gọi không tính điểm — bảng Phòng ban (P-91) dùng chung kiểu
   * này nhưng không có cột điểm.
   *
   * ⚠️ Gom theo NGƯỜI LẬP HỒ SƠ KHÁCH, khác ba cột kia — chúng gom theo người
   * mở tài khoản (thể lệ câu 7.11). Hai cách gom lệch nhau ở ca mở hộ tài khoản
   * cho khách của đồng nghiệp, và cột điểm phải khớp bảng lương chứ không khớp
   * ba cột bên cạnh.
   */
  points: z.number().nullable().default(null),
});
export type DepartmentRanking = z.infer<typeof DepartmentRanking>;

/**
 * Khối số ngân hàng của một phạm vi trong một kỳ. Tổng quan P-80 và chi tiết
 * phòng ban P-91 cùng đọc hình dạng này, máy chủ tính ở một chỗ
 * (`bankingSummaryFor` ở `server/dashboard.ts`).
 */
export const BankingSummary = z.object({
  accountsOpened: z.number(),
  appsInstalled: z.number(),
  /** Tỉ lệ cài app trên số tài khoản mở, 0–100. */
  installPercent: z.number(),
  /**
   * Tỉ lệ riêng của những ngân hàng đội theo dõi sát, thứ tự do máy chủ quyết
   * (`INSTALL_RATE_BANKS` ở `server/dashboard.ts`). Cùng cách đếm với ba số
   * trên, chỉ lọc thêm theo ngân hàng.
   */
  installRateByBank: z.array(
    z.object({
      code: z.string(),
      percent: z.number(),
      appsInstalled: z.number(),
      accountsOpened: z.number(),
    }),
  ),
  /**
   * Số hồ sơ khách LẬP trong kỳ — trục khác ba số trên (tài khoản MỞ trong
   * kỳ), vì thẻ này phải đếm được cả khách chưa hoàn thành tài khoản nào.
   */
  customers: z.number(),
  /** Trong `customers`, hồ sơ có ít nhất một tài khoản hoàn thành. */
  customersWithAccounts: z.number(),
  /**
   * `customers` chia theo số tài khoản hoàn thành 0, 1, 2, 3: phần tử thứ i là
   * số khách có i tài khoản. Không dính gì tới cài app. Bốn số cộng lại bằng
   * `customers`; ba số sau cộng lại bằng `customersWithAccounts`.
   */
  customersByAccounts: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
export type BankingSummary = z.infer<typeof BankingSummary>;

export const DashboardData = z.object({
  banking: BankingSummary.extend({
    /**
     * Tỉ lệ cài app của kỳ liền trước: hôm nay so hôm qua, tháng này so tháng
     * trước. `null` khi người dùng tự chọn khoảng ngày — một khoảng tuỳ ý không
     * có "kỳ liền trước" nào định nghĩa được.
     */
    previousInstallPercent: z.number().nullable(),
    giftsPending: z.number(),
  }),
  /**
   * Tổng điểm KPI của PHẠM VI người xem, trong kỳ xem.
   *
   * Giám đốc thấy điểm cả công ty; Trưởng phòng, Phó phòng và Phó GĐ thấy điểm
   * của phòng mình. Nhân viên xem mặt cá nhân của màn nên không có ô này.
   *
   * Tính lại từ dữ liệu gốc theo đúng khoảng ngày người dùng chọn, không đọc
   * `kpi_scores` (bảng đó chỉ lưu theo tháng).
   */
  scopePoints: z
    .object({ kind: z.enum(['company', 'departments']), points: z.number() })
    .nullable()
    .default(null),
  insurance: z.object({
    createdToday: z.number(),
    /** Bảo hiểm tai nạn hộ sử dụng điện. */
    electricCount: z.number(),
    /** Bảo hiểm xe máy. */
    motorbikeCount: z.number(),
    completed: z.number(),
    completedPercent: z.number(),
    /** Đơn huỷ trong kỳ. KHÔNG nằm trong `createdToday` — hai số cộng lại ra tổng đơn đã lập. */
    cancelled: z.number(),
    /** Số tức thời — "ngay lúc này còn bao nhiêu đơn chưa xong", không theo kỳ. */
    pending: z.number(),
    pendingBot: z.number(),
    pendingManual: z.number(),
    /**
     * Cột của biểu đồ. Độ chia do KỲ quyết định, không cố định theo giờ:
     * một ngày → khung giờ, một tháng → ngày, dài hơn → tuần hoặc tháng.
     */
    bucketType: z.enum(['hour', 'day', 'week', 'month']),
    buckets: z.array(
      z.object({
        label: z.string(),
        /** Bảo hiểm tai nạn hộ sử dụng điện. */
        electric: z.number(),
        /** Bảo hiểm xe máy. */
        motorbike: z.number(),
      }),
    ),
  }),
  /**
   * Bảng xếp hạng đổi theo CHỨC VỤ người xem (chốt 13/08).
   *
   * Trưởng phòng và Phó phòng chỉ thấy đúng phòng mình, nên bảng phòng của họ
   * có một dòng và không so được gì. Với hai chức vụ đó, bảng đổi sang xếp hạng
   * NHÂN VIÊN trong phòng.
   *
   * Bốn cột số giữ nguyên, chỉ đổi cột đầu: tên phòng thành tên nhân viên. Nên
   * giao diện dùng chung một bảng, chỉ đổi tiêu đề và chú thích.
   */
  rankingKind: z.enum(['department', 'staff']),
  /** Xếp hạng — phòng hoặc nhân viên, tuỳ `rankingKind`. */
  departments: z.array(DepartmentRanking),
  services: z.object({
    byType: z.array(z.object({ label: z.string(), count: z.number() })),
    topWard: z.object({ name: z.string(), count: z.number() }),
  }),
  gifts: z.object({
    byType: z.array(z.object({ label: z.string(), count: z.number() })),
    /** Khách đủ điều kiện nhưng chưa phát quà — khớp thẻ ở đầu trang. */
    pending: z.number(),
  }),
});
export type DashboardData = z.infer<typeof DashboardData>;

/**
 * Màn tổng quan có HAI mặt, và máy chủ quyết định mặt nào (chốt 06/08):
 *
 *   Giám đốc         `overview` toàn công ty
 *   Phó giám đốc     `overview` những phòng họ quản
 *   Trưởng/Phó phòng `overview` phòng của họ
 *   Nhân viên        `personal` — chỉ số của chính mình, đúng hồ sơ P-52 mà
 *                    cấp trên nhìn thấy, chỉ khác là tự xem
 *
 * Phạm vi KHÔNG đi qua đường truyền. Nhận `scope` từ client là mở một ô để nặn
 * tay mà không thêm tính năng nào — phiên đăng nhập đã nói đủ, và bản trước
 * nhận đúng tham số đó.
 */
/** Tài khoản đang tạo dở của chính người xem — mới tạo nhất đứng đầu. */
export const DashboardDraftAccount = z.object({
  id: z.string(),
  bankCode: z.string(),
  referralCode: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  createdAt: z.string(),
});
export type DashboardDraftAccount = z.infer<typeof DashboardDraftAccount>;

export const DashboardView = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('overview'),
    /** "Toàn công ty" · tên các phòng · "3 phòng bạn quản" — người xem cần biết mình đang nhìn gì. */
    scopeLabel: z.string(),
    data: DashboardData,
  }),
  z.object({
    kind: z.literal('personal'),
    person: PersonDetail,
    draftAccounts: z.array(DashboardDraftAccount),
  }),
]);
export type DashboardView = z.infer<typeof DashboardView>;

export async function fetchDashboard(period: Period): Promise<DashboardView> {
  const res = await fetch(`/api/dashboard?period=${encodeURIComponent(periodKey(period))}`);
  if (!res.ok) throw new Error('Không tải được số liệu tổng quan');
  return DashboardView.parse(await res.json());
}
