"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Lock } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { MonthPicker, thisMonth } from "@/components/ui/MonthPicker";
import { fetchOrderStats, type OrderStatsGroupBy } from "@/lib/api/exports";
import { exportOrderStats, type OrderStatsMeasures, type OrderStatsSheet } from "@/lib/excelOrderStats";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { Combobox } from "@/components/ui/Combobox";
import { Select } from "@/components/ui/Select";
import {
  SCORING_INCLUDE,
  SCORING_INCLUDE_LABEL,
  fetchScoringExport,
  type ScoringExportRow,
  type ScoringInclude,
} from "@/lib/api/exports";
import { fetchBanks, fetchReferralCodeOptions, type Bank } from "@/lib/api/bankCatalog";
import { errorMessage } from "@/lib/toast";
import { fetchDepartments } from "@/lib/api/departments";
import { fetchPeopleForExport, periodMonth, periodParam, totalPoints } from "@/lib/api/people";
import { fetchServicesForExport } from "@/lib/api/services";
import { fetchServiceTypes } from "@/lib/api/settings";
import { fetchStaffOptions, type StaffOption } from "@/lib/api/staff";
import { fetchProvinces } from "@/lib/api/wardCatalog";
import { exportExcel, type ExcelColumn } from "@/lib/excel";
import { can, scopeFor } from "@/lib/permissions";
import { DEPARTMENT_TYPE_LABEL, DepartmentType, type ModuleKey, type Scope } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

type ReportId = "accounts-by-customer" | "staff-points" | "services-by-ward" | "order-stats";

/**
 * Ba báo cáo, chốt 2026-08-22.
 *
 * Bản trước có bảy. Bốn báo cáo bỏ đi — Dữ liệu tổng, Tổng app đã cài theo ngân
 * hàng theo phòng, Tra tài khoản theo mã giới thiệu, Đơn bảo hiểm theo tháng.
 * Chủ dự án chốt chỉ giữ ba cái đang dùng thật.
 *
 * Báo cáo #1 đổi hình dạng 2026-08-25: từ "Danh sách tài khoản, gộp theo khách"
 * — 8 cột cố định cộng một cột mỗi ngân hàng — sang bản dựng lại đúng sheet
 * `TỔNG` của `TÍNH ĐIỂM TỔNG T8.xlsx`, 47 cột và đầu bảng ba tầng. Bộ lọc giữ
 * nguyên ba ô cũ.
 */
const REPORTS: { id: ReportId; label: string; module: ModuleKey }[] = [
  { id: "accounts-by-customer", label: "Tính điểm tổng, gộp theo khách", module: "banking" },
  { id: "staff-points", label: "Nhân viên + điểm", module: "staff" },
  { id: "services-by-ward", label: "Dịch vụ đã làm, có cột xã", module: "services" },
  { id: "order-stats", label: "Số liệu cấp đơn bảo hiểm", module: "insurance" },
];

/**
 * Báo cáo #4 KHÔNG cho chọn cột.
 *
 * Ba báo cáo kia là bảng phẳng nên tick cột nào cũng ra file đọc được. Báo cáo
 * này dựng lại đúng hình dạng file Kế toán — đầu bảng hai tầng gộp ô, dòng TỔNG
 * ở chân — nên bỏ một cột là hỏng cả bố cục.
 */
const FIXED_SHAPE: ReportId[] = ["order-stats"];

/**
 * Điều kiện này phải khớp chốt của route xuất tương ứng; lệch nhau thì người
 * dùng bấm một báo cáo đang hiện và nhận về 403 không hiểu vì sao.
 */
const hasAccess = (user: Parameters<typeof can>[0], report: (typeof REPORTS)[number]): boolean =>
  can(user, report.module, "export");

/** Một cột có thể chọn/bỏ và đổi thứ tự — `value` nhận `any` vì mỗi báo cáo có một kiểu dòng riêng. */
type CatalogColumn = {
  key: string;
  header: string;
  type?: "text" | "number";
  transform?: "name";
  /** Có sẵn tick khi vào báo cáo — cột phụ (mã, id) để tắt, tránh file rối ngay từ đầu. */
  defaultOn: boolean;
  sample: [string, string];
  /** Nhãn nhóm ở dòng đầu của file — chỉ báo cáo Tính điểm tổng dùng. */
  group?: string;
  groupColor?: string;
  align?: "left" | "center";
  /** Độ rộng cột trong file, tính bằng ký tự. Bỏ trống thì `exportExcel` lấy 18. */
  width?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  total?: (rows: any[]) => string | number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: (row: any, index: number) => string | number;
};

/**
 * Toàn bộ cột CÓ THỂ xuất cho từng báo cáo — không phải danh sách cố định.
 * Cùng một khai báo này vừa dựng bảng xem trước, vừa dựng cột thật lúc xuất
 * (qua `buildColumns`), nên xem trước không bao giờ lệch với file thật.
 */
/**
 * `staffById` khoá bằng id nội bộ, nhưng KHÔNG cột nào xuất id đó ra.
 *
 * Người nhận file đối chiếu với hệ thống nhân sự khác của công ty, nơi định
 * danh là `staffCode` (`MG-0123`). Uuid ở cột "Mã nhân viên" thì không tra được
 * gì, và cột trông vẫn có dữ liệu nên không ai báo lỗi.
 */
function catalogFor(report: ReportId, banks: Bank[], staffById: Map<string, StaffOption>): CatalogColumn[] {
  const staffCodeOf = (id: string | null) => (id && staffById.get(id)?.staffCode) || "—";
  switch (report) {
    case "accounts-by-customer": {
      /**
       * Dựng lại đúng sheet `TỔNG` của `TÍNH ĐIỂM TỔNG T8.xlsx` — 47 cột, một
       * khách một dòng, đầu bảng ba tầng (chốt 2026-08-25).
       *
       * Ánh xạ từng cột và công thức gốc ghi ở `mgst-the-le/2026-08.md` mục 4c.
       * Sửa thứ tự cột ở đây là làm lệch file Kế toán đang đối chiếu — đọc mục
       * đó trước khi đụng vào.
       *
       * Hai khối ngân hàng SINH TỪ BẢNG `banks`, không viết cứng 10 mã: thêm
       * ngân hàng mới thì file mọc thêm cột, đúng chốt 2026-07-28.
       */
      const scoring = banksInRuleOrder(banks);
      /**
       * Bảy khối của file, mỗi khối một nhãn và một màu nhạt.
       *
       * File mẫu đặt nhãn lệch cột — `TỔNG APP:` nằm ở cột KÊNH. Ở đây nhãn phủ
       * đúng khối nó mô tả, vì đó là thứ duy nhất giúp người đọc định vị khi
       * cuộn ngang qua năm mươi cột.
       *
       * Màu chọn nhạt: file hay được in đen trắng, nên ranh giới khối phải đọc
       * được bằng viền và chữ đậm chứ không chỉ bằng màu.
       */
      const KHACH = { group: "KHÁCH HÀNG", groupColor: "FFDCE9F7" };
      const MO_TK = { group: "MỞ TÀI KHOẢN", groupColor: "FFDFF0E0" };
      const APP_CAI = { group: "APP CÀI TRÊN THIẾT BỊ", groupColor: "FFFDF2D5" };
      const QUA = { group: "QUÀ TẶNG", groupColor: "FFF6E2F0" };
      const BAO_HIEM = { group: "BẢO HIỂM", groupColor: "FFE6E2F6" };
      const NHAN_SU = { group: "NHÂN SỰ", groupColor: "FFEDEEF0" };
      const DIEM = { group: "ĐIỂM", groupColor: "FFFBE0DC" };
      const mark = { align: "center" as const, type: "number" as const };

      const sum = (pick: (r: ScoringExportRow) => number) => (rows: ScoringExportRow[]) =>
        Number(rows.reduce((t, r) => t + pick(r), 0).toFixed(2));
      const countIf = (pick: (r: ScoringExportRow) => boolean) => (rows: ScoringExportRow[]) =>
        rows.filter(pick).length;

      return [
        { key: "stt", header: "STT", ...KHACH, ...mark, width: 7, defaultOn: true, sample: ["1", "2"], total: (rows) => rows.length, value: (_row, index) => index + 1 },
        { key: "customerName", header: "TÊN KHÁCH HÀNG", ...KHACH, transform: "name", width: 26, defaultOn: true, sample: ["NGUYEN VAN MEN", "VO VAN CHIEN"], total: countIf((r) => Boolean(r.customerName)), value: (r) => r.customerName },
        { key: "idNumber", header: "SỐ CCCD", ...KHACH, type: "text", width: 15, defaultOn: true, sample: ["82077017051", "82047005635"], total: countIf((r) => Boolean(r.idNumber)), value: (r) => r.idNumber },
        { key: "phone", header: "SỐ ĐIỆN THOẠI", ...KHACH, type: "text", width: 17, defaultOn: true, sample: ["336585699", "369907415"], total: countIf((r) => Boolean(r.phone)), value: (r) => r.phone },
        { key: "date", header: "NGÀY", ...KHACH, ...mark, width: 7, defaultOn: true, sample: ["1", "1"], total: countIf((r) => Boolean(r.date)), value: (r) => Number(r.date.slice(8, 10)) || "" },
        { key: "hamlet", header: "ẤP", ...KHACH, width: 24, defaultOn: true, sample: ["MỸ TRUNG/HẬU MỸ", "MỸ TRUNG/HẬU MỸ"], total: countIf((r) => Boolean(r.hamlet)), value: (r) => r.hamlet },
        { key: "channel", header: "KÊNH", ...KHACH, width: 13, defaultOn: true, sample: ["KÊNH ẤP", "KÊNH ẤP"], value: (r) => r.channelName },
        { key: "apps", header: "CÁC APP", ...KHACH, width: 20, defaultOn: true, sample: ["MB, LPB, MSBb", "VPa, LPB, MSBa"], value: (r) => r.openedBanks.join(", ") },
        ...scoring.map((b): CatalogColumn => ({
          key: `open:${b.code}`,
          header: b.code,
          ...MO_TK,
          ...mark,
          width: 9,
          defaultOn: true,
          sample: ["1", ""],
          total: countIf((r) => r.openedBanks.includes(b.code)),
          value: (r) => (r.openedBanks.includes(b.code) ? 1 : ""),
        })),
        { key: "msbAccount", header: "STK MSB", ...MO_TK, type: "text", width: 15, defaultOn: true, sample: ["80003630480", ""], total: countIf((r) => Boolean(r.msbAccountNumber)), value: (r) => r.msbAccountNumber },
        { key: "household", header: "HKD/CNKD", ...MO_TK, align: "center", width: 10, defaultOn: true, sample: ["CNKD", ""], total: countIf((r) => Boolean(r.household)), value: (r) => r.household },
        // Cột ngăn hai khối, luôn trống — file Kế toán có nó nên giữ đúng vị trí cột.
        { key: "spacer", header: "0", ...APP_CAI, width: 6, defaultOn: true, sample: ["", ""], value: () => "" },
        ...scoring.map((b): CatalogColumn => ({
          key: `app:${b.code}`,
          header: b.code,
          ...APP_CAI,
          ...mark,
          width: 9,
          defaultOn: true,
          sample: ["1", ""],
          total: countIf((r) => r.installedBanks.includes(b.code)),
          value: (r) => (r.installedBanks.includes(b.code) ? 1 : ""),
        })),
        { key: "installedCount", header: "TỔNG APP CÀI TRÊN THIẾT BỊ", ...APP_CAI, ...mark, width: 16, defaultOn: true, sample: ["1", "1"], total: sum((r) => r.installedBanks.length), value: (r) => r.installedBanks.length },
        { key: "giftReport", header: "QUÀ TẶNG BÁO CÁO", ...QUA, width: 40, defaultOn: true, sample: ["2 NĂM BH (Không thuộc…)", "MÌ"], total: countIf((r) => Boolean(r.giftReport)), value: (r) => r.giftReport },
        { key: "giftCombo", header: "QUÀ TẶNG THEO COMBO", ...QUA, width: 18, defaultOn: true, sample: ["2 năm BH", "2 năm BH + 20k"], total: countIf((r) => Boolean(r.giftCombo)), value: (r) => r.giftCombo },
        { key: "speaker", header: "LOA", ...QUA, align: "center", width: 7, defaultOn: true, sample: ["", "LOA"], total: countIf((r) => Boolean(r.speaker)), value: (r) => r.speaker },
        { key: "insuranceLabel", header: "LOẠI BẢO HIỂM", ...BAO_HIEM, width: 13, defaultOn: true, sample: ["BHX", "BHĐ 100K"], total: countIf((r) => Boolean(r.insuranceLabel)), value: (r) => r.insuranceLabel },
        { key: "licensePlate", header: "BIỂN SỐ XE", ...BAO_HIEM, type: "text", width: 13, defaultOn: true, sample: ["63B1-87397", ""], total: countIf((r) => Boolean(r.licensePlate)), value: (r) => r.licensePlate },
        { key: "beneficiary", header: "TÊN KHÁCH HÀNG TRÊN BẢO HIỂM", ...BAO_HIEM, transform: "name", width: 26, defaultOn: true, sample: ["NGUYEN VAN NGOC", "HUYNH CAM LOAN"], total: countIf((r) => Boolean(r.beneficiaryName)), value: (r) => r.beneficiaryName },
        { key: "staffCode", header: "MÃ CBNV", ...NHAN_SU, type: "text", width: 14, defaultOn: true, sample: ["243PHUNGVN", "019LYBTC"], total: countIf((r) => Boolean(r.staffCode)), value: (r) => r.staffCode },
        { key: "department", header: "NHÓM", ...NHAN_SU, width: 20, defaultOn: true, sample: ["PHÒNG 1 - TRANG", "PHÒNG 1 - TRANG"], total: countIf((r) => Boolean(r.departmentName)), value: (r) => r.departmentName },
        { key: "bankCount", header: "APP", ...DIEM, ...mark, width: 9, defaultOn: true, sample: ["3", "3"], value: (r) => r.openedBanks.length },
        { key: "priorityCount", header: "BANK ƯU TIÊN", ...DIEM, ...mark, width: 13, defaultOn: true, sample: ["1", "2"], value: (r) => r.priorityCount },
        { key: "otherCount", header: "BANK KHÁC", ...DIEM, ...mark, width: 13, defaultOn: true, sample: ["2", "1"], value: (r) => r.otherCount },
        { key: "restrictedCount", header: "BANK HẠN CHẾ", ...DIEM, ...mark, width: 13, defaultOn: true, sample: ["0", "0"], value: (r) => r.restrictedCount },
        { key: "combo2", header: "ĐIỂM COMBO 2", ...DIEM, ...mark, width: 14, defaultOn: true, sample: ["", ""], total: sum((r) => r.combo2Points), value: (r) => r.combo2Points || "" },
        { key: "combo3", header: "ĐIỂM COMBO 3", ...DIEM, ...mark, width: 14, defaultOn: true, sample: ["0,8", "1"], total: sum((r) => r.combo3Points), value: (r) => r.combo3Points || "" },
        { key: "householdPoints", header: "ĐIỂM CNKD", ...DIEM, ...mark, width: 14, defaultOn: true, sample: ["0", "1"], total: sum((r) => r.householdPoints), value: (r) => r.householdPoints || "" },
        { key: "totalPoints", header: "TỔNG ĐIỂM", ...DIEM, ...mark, width: 14, defaultOn: true, sample: ["0,8", "2"], total: sum((r) => r.totalPoints), value: (r) => r.totalPoints },
      ];
    }
    case "staff-points":
      return [
        { key: "staffCode", header: "Mã nhân viên", type: "text", defaultOn: false, sample: ["MG-0123", "MG-0007"], value: (r) => r.staffCode ?? "—" },
        { key: "username", header: "Tên đăng nhập", type: "text", defaultOn: false, sample: ["lethihong", "vothanhhai"], value: (r) => staffById.get(r.id)?.username ?? "—" },
        { key: "fullName", header: "Nhân viên", transform: "name", defaultOn: true, sample: ["LE THI HONG", "VO THANH HAI"], value: (r) => r.fullName },
        { key: "departmentName", header: "Đơn vị", defaultOn: true, sample: ["Phòng Kinh doanh 2", "Phòng Kinh doanh 2"], value: (r) => r.departmentName },
        { key: "bankingPoints", header: "Điểm ngân hàng", type: "number", defaultOn: true, sample: ["4,2", "2,8"], value: (r) => r.bankingPoints },
        { key: "servicePoints", header: "Điểm dịch vụ", type: "number", defaultOn: true, sample: ["6,5", "3"], value: (r) => r.servicePoints },
        { key: "adjustmentPoints", header: "Điểm cộng", type: "number", defaultOn: true, sample: ["2", "0"], value: (r) => r.adjustmentPoints },
        { key: "totalPoints", header: "Tổng điểm", type: "number", defaultOn: true, sample: ["12,7", "5,8"], value: (r) => totalPoints(r) },
        { key: "target", header: "Chỉ tiêu", type: "number", defaultOn: true, sample: ["100", "100"], value: (r) => r.target },
        { key: "accounts", header: "Tài khoản", type: "number", defaultOn: true, sample: ["63", "40"], value: (r) => r.accounts },
        { key: "apps", header: "App đã cài", type: "number", defaultOn: true, sample: ["41", "22"], value: (r) => r.apps },
        { key: "insuranceOrders", header: "Đơn BH", type: "number", defaultOn: true, sample: ["1", "0"], value: (r) => r.insuranceOrders },
      ];
    case "services-by-ward":
      return [
        { key: "id", header: "Mã dịch vụ", type: "text", defaultOn: false, sample: ["sv-041", "sv-055"], value: (r) => r.id },
        { key: "customerName", header: "Khách hàng", transform: "name", defaultOn: true, sample: ["PHAM MINH TUAN", "BUI THI KIM CHI"], value: (r) => r.customerName },
        { key: "serviceTypeName", header: "Loại dịch vụ", defaultOn: true, sample: ["Tư vấn BHYT", "Hỗ trợ giấy tờ"], value: (r) => r.serviceTypeName },
        { key: "wardName", header: "Xã", defaultOn: true, sample: ["Xã Tân Thành", "Xã Bình Phú"], value: (r) => r.wardName ?? "—" },
        { key: "date", header: "Ngày", defaultOn: true, sample: ["10/07/2026", "18/07/2026"], value: (r) => r.date },
        { key: "createdByCode", header: "Mã người thực hiện", type: "text", defaultOn: false, sample: ["MG-0123", "MG-0007"], value: (r) => staffCodeOf(r.createdById) },
        { key: "createdByName", header: "Người thực hiện", defaultOn: true, sample: ["Lý Hoàng Nam", "Phan Thị Tuyết"], value: (r) => r.createdByName },
        { key: "note", header: "Ghi chú", defaultOn: true, sample: ["—", "Đã hoàn tất hồ sơ"], value: (r) => r.note || "—" },
      ];

    // Báo cáo hình dạng cố định — không có bảng chọn cột, xem `FIXED_SHAPE`.
    case "order-stats":
      return [];
  }
}

/**
 * Thứ tự cột ngân hàng của file `TÍNH ĐIỂM TỔNG` — theo thể lệ, không theo bảng
 * chữ cái: `B1 · B2a · B2b · B3 · B4a · B4b · TCB · B6 · B8 · B10 · B12`.
 *
 * Danh sách này CHỈ quyết định thứ tự, không quyết định cột nào có mặt. Cột vẫn
 * sinh từ bảng `banks` (chốt 2026-07-28), nên thêm ngân hàng mới thì file mọc
 * thêm cột — mã lạ xếp cuối, sau mười một mã đã biết.
 */
const RULE_BANK_ORDER = ["MB", "VPa", "VPb", "LPB", "MSBa", "MSBb", "TCB", "BIDV", "TPB", "VIB", "SHB"];

/**
 * Ngân hàng vào hai khối cột của báo cáo Tính điểm tổng.
 *
 * Bỏ `CNKD`/`HKD`: file Kế toán để chúng ở cột `HKD/CNKD` riêng, không nằm
 * trong khối ngân hàng và không vào phép đếm `AN`.
 */
function banksInRuleOrder(banks: Bank[]): Bank[] {
  const rank = (code: string) => {
    const i = RULE_BANK_ORDER.indexOf(code);
    return i === -1 ? RULE_BANK_ORDER.length : i;
  };
  return banks
    .filter((b) => !["CNKD", "HKD"].includes(b.code))
    .sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code));
}

/** Cột thật đưa vào `exportExcel` — đúng những cột đã tick, đúng thứ tự đã sắp. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildColumns(catalog: CatalogColumn[], order: string[]): ExcelColumn<any>[] {
  return order
    .map((key) => catalog.find((c) => c.key === key))
    .filter((c): c is CatalogColumn => Boolean(c))
    .map((c) => ({
      header: c.header,
      type: c.type,
      transform: c.transform,
      group: c.group,
      groupColor: c.groupColor,
      align: c.align,
      width: c.width,
      total: c.total,
      value: c.value,
    }));
}

/** P-73 · Trung tâm xuất dữ liệu — một trang, chọn báo cáo, chọn cột, đặt bộ lọc. */
export default function ExportsPage() {
  const user = useSession((s) => s.user);
  const allowed = REPORTS.filter((r) => hasAccess(user, r));

  const [active, setActive] = useState<ReportId | null>(allowed[0]?.id ?? null);
  const [exporting, setExporting] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  // Vị trí TẤT CẢ cột (kể cả tắt) + danh sách cột đang bật, riêng cho từng báo
  // cáo. Tách hai thứ này ra để bỏ tick một cột không làm nó rớt khỏi hàng —
  // bật lại thì về đúng chỗ cũ, không nhảy xuống cuối.
  const [enabledMap, setEnabledMap] = useState<Partial<Record<ReportId, string[]>>>({});

  // Bộ lọc dùng chung theo từng nhóm báo cáo — khai hết ở đây, mỗi báo cáo chỉ
  // hiện đúng vài ô liên quan, tránh tách ba component riêng cho ba form nhỏ.
  const [bankCode, setBankCode] = useState("");
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [referralCode, setReferralCode] = useState("");
  /** Báo cáo #1: chỉ khách có tài khoản, hay cả khách chưa mở tài khoản nào. */
  const [scoringInclude, setScoringInclude] = useState<ScoringInclude>("with-accounts");
  const [month, setMonth] = useState(thisMonth());
  const [statsGroupBy, setStatsGroupBy] = useState<OrderStatsGroupBy>("department");
  /** `day` = mỗi ngày một sheet, `month` = một sheet gộp cả tháng. */
  const [statsSheets, setStatsSheets] = useState<"day" | "month">("day");
  const [departmentId, setDepartmentId] = useState("");
  const [departmentType, setDepartmentType] = useState<DepartmentType | "">("");
  const [ward, setWard] = useState("");
  const [serviceTypeId, setServiceTypeId] = useState("");

  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const { data: codes = [] } = useQuery({
    queryKey: ["referral-code-options"],
    queryFn: fetchReferralCodeOptions,
  });
  const { data: departments = [] } = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const { data: serviceTypes = [] } = useQuery({ queryKey: ["service-types"], queryFn: fetchServiceTypes });
  const { data: provinces = [] } = useQuery({ queryKey: ["provinces"], queryFn: fetchProvinces });
  const wards = provinces.flatMap((p) => p.wards);
  // `status: "all"` chứ không phải `"active"`: báo cáo đọc dữ liệu CŨ, và người
  // tạo ra nó có thể đã nghỉ. Lấy mỗi người đang hoạt động thì mã nhân viên,
  // đơn vị và chức vụ của họ ra "—" trên mọi dòng họ từng nhập.
  const { data: staffData } = useQuery({
    queryKey: ["staff-all-for-export"],
    queryFn: () => fetchStaffOptions({ status: "all" }),
  });
  const staffOptions = staffData ?? [];
  const staffById = new Map(staffOptions.map((s) => [s.id, s]));

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";

  const catalog = active ? catalogFor(active, banks, staffById) : [];
  /* Thứ tự cột CỐ ĐỊNH theo file mẫu của từng báo cáo (chốt 2026-08-27, bỏ
     mũi tên đổi thứ tự) — tick chọn ngay trên bảng xem trước. */
  const fullOrder = catalog.map((c) => c.key);
  const enabled = active ? (enabledMap[active] ?? catalog.filter((c) => c.defaultOn).map((c) => c.key)) : [];
  // Cột thật sẽ xuất: đúng những cột đang tick, theo thứ tự file mẫu.
  const exportOrder = fullOrder.filter((key) => enabled.includes(key));

  const toggleColumn = (key: string) => {
    if (!active) return;
    const next = enabled.includes(key) ? enabled.filter((k) => k !== key) : [...enabled, key];
    setEnabledMap((m) => ({ ...m, [active]: next }));
  };

  async function run() {
    if (!active) return;
    // Báo cáo hình dạng cố định không có bảng chọn cột, nên không có gì để tick.
    if (!FIXED_SHAPE.includes(active) && exportOrder.length === 0) {
      setLastResult("Chọn ít nhất một cột trước khi xuất.");
      return;
    }
    setExporting(true);
    setLastResult(null);
    try {
      const count = await RUN[active]();
      setLastResult(`Đã xuất ${count} dòng, ${exportOrder.length} cột.`);
    } catch (e) {
      // Nuốt câu của máy chủ rồi in "thử lại" là bắt người dùng thử lại một
      // việc chắc chắn hỏng — ví dụ vượt trần dòng thì thử bao nhiêu lần cũng
      // vậy, phải thu hẹp bộ lọc mới xong.
      setLastResult(errorMessage(e, "Xuất thất bại — thử lại."));
    } finally {
      setExporting(false);
    }
  }

  /**
   * Chạm trần thì DỪNG, không dựng file: một báo cáo thiếu 5.000 dòng trông y
   * hệt báo cáo đủ, người nhận không có cách nào biết. Thà không có file còn
   * hơn có file nói dối.
   */
  const capCheck = (got: number, total: number, what: string) => {
    if (got < total)
      throw new Error(
        `Bộ lọc này có ${total.toLocaleString("vi-VN")} ${what}, vượt trần ${got.toLocaleString("vi-VN")} dòng một lần xuất. Thu hẹp khoảng ngày rồi xuất làm nhiều đợt.`,
      );
  };

  const RUN: Record<ReportId, () => Promise<number>> = {
    async "accounts-by-customer"() {
      /**
       * Máy chủ gộp theo khách và tính sẵn điểm — xem `server/exports.ts`.
       *
       * Bản trước gộp ở đây, nhưng báo cáo này cần thêm CCCD, SĐT, kênh, quà đã
       * phát, đơn bảo hiểm và điểm của từng khách. Kéo sáu bảng đó về trình
       * duyệt rồi ghép tay là sáu lượt gọi và sáu chỗ có thể lệch.
       */
      const { rows, total } = await fetchScoringExport(
        {
          search: "",
          bankCode,
          from,
          to,
          referralCode,
          channelId: "",
          staffId: "",
          departmentId: "",
          status: "",
        },
        scoringInclude,
      );
      capCheck(rows.length, total, "khách hàng");

      // Sắp theo NGÀY rồi tên, đúng thứ tự file Kế toán đang đọc quen.
      const sorted = [...rows].sort(
        (a, b) => a.date.localeCompare(b.date) || a.customerName.localeCompare(b.customerName),
      );

      await exportExcel({
        fileName: `tinh-diem-tong-${iso(new Date())}.xlsx`,
        sheetName: "TỔNG",
        rows: sorted,
        columns: buildColumns(catalogFor("accounts-by-customer", banks, staffById), exportOrder),
      });
      return sorted.length;
    },

    async "staff-points"() {
      const scope: Scope = scopeFor(user, "staff", "export") ?? "own";
      const param = periodParam({ kind: "month", month }, thisMonth());
      const summaryMonth = periodMonth({ kind: "month", month }, thisMonth());
      const people = await fetchPeopleForExport({
        scope,
        period: param,
        summaryMonth,
        departmentId,
        departmentType,
        search: "",
      });
      await exportExcel({
        fileName: `nhan-vien-diem-${month}.xlsx`,
        sheetName: "Nhân viên và điểm",
        rows: people,
        columns: buildColumns(catalogFor("staff-points", banks, staffById), exportOrder),
      });
      return people.length;
    },

    async "order-stats"() {
      const { groups, cells } = await fetchOrderStats(month, statsGroupBy);

      /** Cộng các ô của cùng một nhóm thành mười con số. */
      const measuresOf = (rows: typeof cells): Map<string, OrderStatsMeasures> => {
        const byGroup = new Map<string, OrderStatsMeasures>();
        for (const c of rows) {
          const m = byGroup.get(c.groupId) ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
          m[0] += c.motorbike;
          m[1] += c.motorbikeYears;
          m[2] += c.electric100;
          m[3] += c.electric200;
          m[4] += c.health;
          m[5] += c.motorbikeCancelled;
          m[6] += c.motorbikeYearsCancelled;
          m[7] += c.electric100Cancelled;
          m[8] += c.electric200Cancelled;
          m[9] += c.healthCancelled;
          byGroup.set(c.groupId, m);
        }
        return byGroup;
      };

      /**
       * Gộp theo PHÒNG thì giữ đủ mọi phòng, kể cả phòng 0 đơn — file Kế toán
       * so ngang giữa các ngày nên số dòng phải cố định. Gộp theo NHÂN VIÊN thì
       * chỉ giữ người có số liệu của chính sheet đó.
       */
      const sheetOf = (name: string, title: string, rows: typeof cells): OrderStatsSheet => {
        const byGroup = measuresOf(rows);
        const zero: OrderStatsMeasures = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        return {
          name,
          title,
          rows: groups
            .filter((g) => statsGroupBy === "department" || byGroup.has(g.id))
            .map((g) => ({
              label: g.label,
              department: g.department,
              measures: byGroup.get(g.id) ?? zero,
            })),
        };
      };

      const [year, mm] = month.split("-");
      const sheets: OrderStatsSheet[] =
        statsSheets === "month"
          ? [sheetOf(`Tháng ${mm}`, `TỔNG ĐƠN BẢO HIỂM ĐIỆN TỬ THÁNG ${mm}/${year}`, cells)]
          : // Chỉ dựng sheet cho ngày CÓ số liệu. Tháng đang chạy dở thì dừng ở
            // ngày cuối có đơn, không đẻ ra sheet rỗng cho ngày chưa tới.
            [...new Set(cells.map((c) => c.day))]
              .sort()
              .map((day) => {
                const [, , dd] = day.split("-");
                return sheetOf(
                  `${dd}.${mm}`,
                  `TỔNG ĐƠN BẢO HIỂM ĐIỆN TỬ NGÀY ${dd}/${mm}/${year}`,
                  cells.filter((c) => c.day === day),
                );
              });

      if (sheets.length === 0) throw new Error(`Tháng ${mm}/${year} chưa có đơn bảo hiểm nào.`);

      await exportOrderStats({
        fileName: `so-lieu-cap-don-${statsGroupBy === "department" ? "theo-phong" : "theo-nhan-vien"}-${month}.xlsx`,
        shape: statsGroupBy,
        sheets,
      });
      return sheets.reduce((n, s) => n + s.rows.length, 0);
    },

    async "services-by-ward"() {
      const { rows, total } = await fetchServicesForExport({
        search: "",
        serviceTypeId,
        from,
        to,
        wardId: ward,
        staffId: "",
      });

      // Chạm trần thì DỪNG, không dựng file — cùng lý do với báo cáo khách hàng
      // ở trên: file thiếu dòng trông y hệt file đủ.
      if (rows.length < total) {
        throw new Error(
          `Khoảng ngày này có ${total.toLocaleString("vi-VN")} lượt dịch vụ, vượt trần ${rows.length.toLocaleString("vi-VN")} dòng một lần xuất. Thu hẹp khoảng ngày rồi xuất làm nhiều đợt.`,
        );
      }
      await exportExcel({
        fileName: `dich-vu-theo-xa-${iso(new Date())}.xlsx`,
        sheetName: "Dịch vụ",
        rows,
        columns: buildColumns(catalogFor("services-by-ward", banks, staffById), exportOrder),
      });
      return rows.length;
    },
  };

  if (allowed.length === 0) {
    return (
      <>
        <TopBar title="Xuất dữ liệu" keepTitleOnMobile />
        <main className={styles.body}>
          <p className="text-muted">Bạn không có quyền xuất báo cáo nào.</p>
        </main>
      </>
    );
  }

  const activeReport = REPORTS.find((r) => r.id === active);

  return (
    <>
      <TopBar title="Xuất dữ liệu" keepTitleOnMobile />
      <main className={styles.body}>
        <SectionTabs
          label="Báo cáo"
          value={active ?? ""}
          onChange={(v) => {
            setActive(v as ReportId);
            setLastResult(null);
          }}
          options={REPORTS.map((r) => ({
            value: r.id,
            disabled: !hasAccess(user, r),
            label: (
              <span className={styles.tabLabel}>
                {!hasAccess(user, r) && <Lock size={13} aria-hidden />}
                {r.label}
              </span>
            ),
          }))}
        />

        {activeReport && (
          <SectionCard
            title={activeReport.label}
            icon={<Download size={17} />}
          >
            {!FIXED_SHAPE.includes(activeReport.id) && (
            <div className={styles.columnPreview}>
              <span className={styles.columnPreviewLabel}>
                Tick chọn cột sẽ xuất ({exportOrder.length}/{catalog.length})
              </span>
              {/* Tick nằm ngay trên tiêu đề cột (chốt 2026-08-27) — bảng hiện ĐỦ
                  mọi cột, cột bỏ tick mờ đi chứ không biến mất, để còn thấy mà
                  tick lại. Thứ tự cố định theo file mẫu. */}
              <div className={styles.previewScroll}>
                <table className={styles.previewTable}>
                  <thead>
                    <tr>
                      {fullOrder.map((key) => {
                        const col = catalog.find((c) => c.key === key);
                        if (!col) return null;
                        const isOn = enabled.includes(key);
                        return (
                          <th
                            key={key}
                            className={`${col.type === "number" ? styles.alignNum : ""} ${isOn ? "" : styles.colOff}`}
                          >
                            <Checkbox
                              checked={isOn}
                              onCheckedChange={() => toggleColumn(key)}
                              label={
                                <>
                                  {col.header}
                                  {col.type === "text" && (
                                    <span className={styles.textHint}> (văn bản)</span>
                                  )}
                                </>
                              }
                            />
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 1].map((rowIndex) => (
                      <tr key={rowIndex}>
                        {fullOrder.map((key) => {
                          const col = catalog.find((c) => c.key === key);
                          if (!col) return null;
                          const isOn = enabled.includes(key);
                          return (
                            <td
                              key={key}
                              className={`${col.type === "number" ? styles.alignNum : ""} ${isOn ? "" : styles.colOff}`}
                            >
                              {col.sample[rowIndex]}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            )}

            <span className={styles.columnPreviewLabel}>Bộ lọc</span>
            <div className={styles.filters} role="group" aria-label="Bộ lọc">
              {active === "accounts-by-customer" && (
                <Select
                  block
                  label="Khách đưa vào file"
                  value={scoringInclude}
                  onChange={(v) => setScoringInclude(v as ScoringInclude)}
                  options={SCORING_INCLUDE.map((value) => ({
                    value,
                    label: SCORING_INCLUDE_LABEL[value],
                  }))}
                />
              )}

              {active === "accounts-by-customer" && (
                <Select
                  block
                  label="Ngân hàng"
                  value={bankCode}
                  onChange={setBankCode}
                  options={[{ value: "", label: "Tất cả ngân hàng" }, ...banks.map((b) => ({ value: b.code, label: b.code }))]}
                />
              )}

              {active === "accounts-by-customer" && (
                <Combobox
                  block
                  // Combobox chứ không phải Select: kho mã lớn thêm mỗi đợt
                  // Kinh doanh tổng hợp nhập vào, mà `<select>` gốc không gõ
                  // tìm được. Cùng lối với ô lọc mã ở màn Ngân hàng.
                  label="Mã giới thiệu"
                  placeholder="Gõ để tìm mã…"
                  value={referralCode}
                  onChange={setReferralCode}
                  options={[{ value: "", label: "Tất cả mã giới thiệu" }, ...codes.map((code) => ({ value: code, label: code }))]}
                />
              )}

              {active === "staff-points" && (
                <>
                  {/*
                    `MonthPicker` là cụm nút ‹ › chứ không phải một ô nhập, nên
                    nó không có `label` như `Select`. Bọc thành nhóm có nhãn để
                    đứng cùng hàng lưới với các ô khác, và để trình đọc màn hình
                    biết ba nút đó thuộc về "Tháng".
                  */}
                  <div className={styles.field} role="group" aria-label="Tháng">
                    <span className={styles.fieldLabel} aria-hidden>
                      Tháng
                    </span>
                    <MonthPicker value={month} onChange={setMonth} />
                  </div>
                  {/* Hai ô lọc ĐỘC LẬP: chọn "tất cả đơn vị" kèm loại "Phòng
                      kinh doanh" thì ra người của 11 phòng đó, không phải chọn
                      từng phòng một. */}
                  <Select
                    block
                    label="Loại phòng"
                    value={departmentType}
                    onChange={(v) => setDepartmentType(v as DepartmentType | "")}
                    options={[
                      { value: "", label: "Tất cả loại phòng" },
                      ...DepartmentType.options.map((t) => ({ value: t, label: DEPARTMENT_TYPE_LABEL[t] })),
                    ]}
                  />
                  <Select
                    block
                    label="Đơn vị"
                    value={departmentId}
                    onChange={setDepartmentId}
                    options={[{ value: "", label: "Tất cả đơn vị" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
                  />
                </>
              )}

              {active === "services-by-ward" && (
                <>
                  <Select
                    block
                    label="Xã"
                    value={ward}
                    onChange={setWard}
                    options={[{ value: "", label: "Tất cả xã" }, ...wards.map((w) => ({ value: w.id, label: w.name }))]}
                  />
                  <Select
                    block
                    label="Loại dịch vụ"
                    value={serviceTypeId}
                    onChange={setServiceTypeId}
                    options={[{ value: "", label: "Tất cả loại dịch vụ" }, ...serviceTypes.map((t) => ({ value: t.id, label: t.name }))]}
                  />
                </>
              )}

              {active === "order-stats" && (
                <>
                  <div className={styles.field} role="group" aria-label="Tháng">
                    <span className={styles.fieldLabel} aria-hidden>
                      Tháng
                    </span>
                    <MonthPicker value={month} onChange={setMonth} />
                  </div>
                  <Select
                    block
                    label="Gộp theo"
                    value={statsGroupBy}
                    onChange={(v) => setStatsGroupBy(v as OrderStatsGroupBy)}
                    options={[
                      { value: "department", label: "Phòng" },
                      { value: "staff", label: "Nhân viên nhập đơn" },
                    ]}
                  />
                  {/* Chỉ đổi cách chia sheet, KHÔNG đổi khoảng thời gian: cả hai
                      lựa chọn đều lấy trọn tháng đã chọn (chốt 2026-09-01). */}
                  <Select
                    block
                    label="Chia sheet"
                    value={statsSheets}
                    onChange={(v) => setStatsSheets(v as "day" | "month")}
                    options={[
                      { value: "day", label: "Mỗi ngày một sheet" },
                      { value: "month", label: "Một sheet cả tháng" },
                    ]}
                  />
                </>
              )}

              {active !== "staff-points" && active !== "order-stats" && (
                <DateRangePicker label="Khoảng ngày" value={range} onChange={setRange} />
              )}
            </div>

            <div className={styles.actions}>
              <Button onClick={run} disabled={exporting}>
                <Download size={16} />
                {exporting ? "Đang xuất…" : "Xuất Excel"}
              </Button>
              {lastResult && <span className={styles.result}>{lastResult}</span>}
            </div>
          </SectionCard>
        )}
      </main>
    </>
  );
}
