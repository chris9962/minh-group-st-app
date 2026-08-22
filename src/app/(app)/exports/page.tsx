"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Download, Lock } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { MonthPicker, thisMonth } from "@/components/ui/MonthPicker";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { Combobox } from "@/components/ui/Combobox";
import { Select } from "@/components/ui/Select";
import { fetchBankAccountsForExport } from "@/lib/api/banking";
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
import { DEPARTMENT_TYPE_LABEL, DepartmentType, ROLE_LABEL, type ModuleKey, type Scope } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

type ReportId = "accounts-by-customer" | "staff-points" | "services-by-ward";

/**
 * Ba báo cáo, chốt 2026-08-22.
 *
 * Bản trước có bảy. Bốn báo cáo bỏ đi — Dữ liệu tổng, Tổng app đã cài theo ngân
 * hàng theo phòng, Tra tài khoản theo mã giới thiệu, Đơn bảo hiểm theo tháng.
 * Chủ dự án chốt chỉ giữ ba cái đang dùng thật.
 */
const REPORTS: { id: ReportId; label: string; hint: string; module: ModuleKey }[] = [
  { id: "accounts-by-customer", label: "Danh sách tài khoản, gộp theo khách", hint: "Ngân hàng · ngày · mã giới thiệu", module: "banking" },
  { id: "staff-points", label: "Nhân viên + điểm", hint: "Tháng · loại phòng · đơn vị", module: "staff" },
  { id: "services-by-ward", label: "Dịch vụ đã làm, có cột xã", hint: "Xã · loại dịch vụ · kỳ", module: "services" },
];

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: (row: any) => string | number;
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
    case "accounts-by-customer":
      return [
        { key: "customerName", header: "Khách hàng", transform: "name", defaultOn: true, sample: ["NGUYEN THI BICH TRAM", "TRAN VAN DUC"], value: (r) => r.customerName },
        { key: "customerId", header: "Mã khách hàng", type: "text", defaultOn: false, sample: ["kh-014", "kh-027"], value: (r) => r.customerId || "—" },
        { key: "createdByNames", header: "Người tạo", defaultOn: true, sample: ["Nguyễn Thị Bích Trâm", "Trần Văn Hậu"], value: (r) => r.createdByNames },
        // Một khách có thể có tài khoản do NHIỀU nhân viên tạo (mỗi ngân hàng
        // một người) — mấy cột nhân viên dưới đây nối bằng dấu phẩy y hệt cột
        // "Người tạo", không phải 1 khách 1 giá trị như báo cáo Nhân viên+điểm.
        { key: "createdByCodes", header: "Mã nhân viên", type: "text", defaultOn: false, sample: ["MG-0123", "MG-0007"], value: (r) => r.createdByCodes },
        { key: "createdByDepartments", header: "Đơn vị người tạo", defaultOn: false, sample: ["Phòng Kinh doanh 2", "Phòng Kinh doanh 2"], value: (r) => r.createdByDepartments },
        { key: "createdByRoles", header: "Chức vụ người tạo", defaultOn: false, sample: ["Nhân viên", "Trưởng phòng"], value: (r) => r.createdByRoles },
        { key: "createdByTitles", header: "Chức danh người tạo", defaultOn: false, sample: ["Nhân viên kinh doanh", "Trưởng phòng Kinh doanh 2"], value: (r) => r.createdByTitles },
        { key: "createdByPhones", header: "SĐT người tạo", type: "text", defaultOn: false, sample: ["0900000000", "0900000000"], value: (r) => r.createdByPhones },
        ...banks.map((b, i): CatalogColumn => ({
          key: `bank:${b.code}`,
          header: b.code,
          type: "text",
          defaultOn: true,
          sample: i === 0 ? ["0912345678", "—"] : i === 1 ? ["—", "0987654321"] : ["—", "—"],
          value: (r) => r.cells[b.code] ?? "",
        })),
      ];
    case "staff-points":
      return [
        { key: "staffCode", header: "Mã nhân viên", type: "text", defaultOn: false, sample: ["MG-0123", "MG-0007"], value: (r) => r.staffCode ?? "—" },
        { key: "username", header: "Tên đăng nhập", type: "text", defaultOn: false, sample: ["lethihong", "vothanhhai"], value: (r) => staffById.get(r.id)?.username ?? "—" },
        { key: "fullName", header: "Nhân viên", transform: "name", defaultOn: true, sample: ["LE THI HONG", "VO THANH HAI"], value: (r) => r.fullName },
        { key: "departmentName", header: "Đơn vị", defaultOn: true, sample: ["Phòng Kinh doanh 2", "Phòng Kinh doanh 2"], value: (r) => r.departmentName },
        { key: "bankingPoints", header: "Điểm ngân hàng", type: "number", defaultOn: true, sample: ["4,2", "2,8"], value: (r) => r.bankingPoints },
        { key: "servicePoints", header: "Điểm dịch vụ", type: "number", defaultOn: true, sample: ["6,5", "3"], value: (r) => r.servicePoints },
        { key: "totalPoints", header: "Tổng điểm", type: "number", defaultOn: true, sample: ["10,7", "5,8"], value: (r) => totalPoints(r) },
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
  }
}

/** Cột thật đưa vào `exportExcel` — đúng những cột đã tick, đúng thứ tự đã sắp. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildColumns(catalog: CatalogColumn[], order: string[]): ExcelColumn<any>[] {
  return order
    .map((key) => catalog.find((c) => c.key === key))
    .filter((c): c is CatalogColumn => Boolean(c))
    .map((c) => ({ header: c.header, type: c.type, transform: c.transform, value: c.value }));
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
  const [orderMap, setOrderMap] = useState<Partial<Record<ReportId, string[]>>>({});
  const [enabledMap, setEnabledMap] = useState<Partial<Record<ReportId, string[]>>>({});

  // Bộ lọc dùng chung theo từng nhóm báo cáo — khai hết ở đây, mỗi báo cáo chỉ
  // hiện đúng vài ô liên quan, tránh tách ba component riêng cho ba form nhỏ.
  const [bankCode, setBankCode] = useState("");
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [referralCode, setReferralCode] = useState("");
  const [month, setMonth] = useState(thisMonth());
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
  const fullOrder = active ? (orderMap[active] ?? catalog.map((c) => c.key)) : [];
  const enabled = active ? (enabledMap[active] ?? catalog.filter((c) => c.defaultOn).map((c) => c.key)) : [];
  // Cột thật sẽ xuất: đúng những cột đang bật, đúng thứ tự đang xếp.
  const exportOrder = fullOrder.filter((key) => enabled.includes(key));

  const toggleColumn = (key: string) => {
    if (!active) return;
    const next = enabled.includes(key) ? enabled.filter((k) => k !== key) : [...enabled, key];
    setEnabledMap((m) => ({ ...m, [active]: next }));
  };
  const moveColumn = (key: string, dir: -1 | 1) => {
    if (!active) return;
    const i = fullOrder.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= fullOrder.length) return;
    const next = [...fullOrder];
    [next[i], next[j]] = [next[j], next[i]];
    setOrderMap((m) => ({ ...m, [active]: next }));
  };

  async function run() {
    if (!active) return;
    if (exportOrder.length === 0) {
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
      const { rows, total } = await fetchBankAccountsForExport({
        search: "",
        bankCode,
        from,
        to,
        referralCode,
        channelId: "",
        staffId: "",
        status: "",
      });
      capCheck(rows.length, total, "tài khoản");
      // Khoá gộp là `customerId`, KHÔNG phải tên. Database đang có hai khách
      // trùng tên khác CCCD; gộp theo tên là trộn hồ sơ của hai người vào một
      // dòng, và dòng đó mang `customerId` của người đến trước — báo cáo đối
      // soát gửi ngân hàng ghi mã khách của người này cho tài khoản người kia.
      //
      // Ô ngân hàng giữ TẬP số: gán đè thì khách có nhiều tài khoản ở cùng ngân
      // hàng chỉ còn số cuối. Một khách thật đang có 4 tài khoản BIDV.
      const byCustomer = new Map<
        string,
        { customerId: string; customerName: string; createdByNames: Set<string>; createdByIds: Set<string>; cells: Record<string, Set<string>> }
      >();
      for (const r of rows) {
        const row = byCustomer.get(r.customerId) ?? {
          customerId: r.customerId,
          customerName: r.customerName,
          createdByNames: new Set<string>(),
          createdByIds: new Set<string>(),
          cells: {},
        };
        (row.cells[r.bankCode] ??= new Set<string>()).add(r.accountNumber);
        if (r.createdByName) row.createdByNames.add(r.createdByName);
        if (r.createdById) row.createdByIds.add(r.createdById);
        byCustomer.set(r.customerId, row);
      }
      // Một khách có thể có tài khoản do nhiều nhân viên tạo — nối mọi trường
      // nhân viên bằng dấu phẩy giống "Người tạo", không phải suy ra một người.
      const grouped = [...byCustomer.values()].map((g) => {
        const staffs = [...g.createdByIds].map((id) => staffById.get(id)).filter((s): s is (typeof staffOptions)[number] => Boolean(s));
        return {
          customerId: g.customerId,
          customerName: g.customerName,
          cells: Object.fromEntries(Object.entries(g.cells).map(([code, nums]) => [code, [...nums].join(", ")])),
          createdByNames: [...g.createdByNames].join(", "),
          createdByCodes: staffs.map((s) => s.staffCode || "—").join(", ") || "—",
          createdByDepartments: staffs.map((s) => s.departmentName || "—").join(", ") || "—",
          createdByRoles: staffs.map((s) => ROLE_LABEL[s.role]).join(", ") || "—",
          createdByTitles: staffs.map((s) => s.title || "—").join(", ") || "—",
          createdByPhones: staffs.map((s) => s.phone).join(", ") || "—",
        };
      });
      await exportExcel({
        fileName: `tai-khoan-gop-theo-khach-${iso(new Date())}.xlsx`,
        sheetName: "Tài khoản theo khách",
        rows: grouped,
        columns: buildColumns(catalogFor("accounts-by-customer", banks, staffById), exportOrder),
      });
      return grouped.length;
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
            meta={activeReport.hint}
          >
            <div className={styles.columnPreview}>
              <span className={styles.columnPreviewLabel}>
                Cột sẽ xuất — tick chọn, mũi tên đổi thứ tự ({exportOrder.length}/{catalog.length}). Bỏ tick không đổi
                vị trí, bật lại là về đúng chỗ cũ.
              </span>
              <div className={styles.columnPicker}>
                <div className={styles.columnChips}>
                  {fullOrder.map((key, i) => {
                    const col = catalog.find((c) => c.key === key);
                    if (!col) return null;
                    const isOn = enabled.includes(key);
                    return (
                      <div key={key} className={`${styles.columnChip} ${isOn ? "" : styles.columnChipOff}`}>
                        <button
                          type="button"
                          className={styles.chipArrow}
                          aria-label={`Đưa cột ${col.header} sang trái`}
                          disabled={i === 0}
                          onClick={() => moveColumn(key, -1)}
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <Checkbox checked={isOn} onCheckedChange={() => toggleColumn(key)} label={col.header} />
                        <button
                          type="button"
                          className={styles.chipArrow}
                          aria-label={`Đưa cột ${col.header} sang phải`}
                          disabled={i === fullOrder.length - 1}
                          onClick={() => moveColumn(key, 1)}
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <span className={styles.columnPreviewLabel}>Mở file lên sẽ có dạng</span>
              <div className={styles.previewScroll}>
                <table className={styles.previewTable}>
                  <thead>
                    <tr>
                      {exportOrder.map((key) => {
                        const col = catalog.find((c) => c.key === key);
                        if (!col) return null;
                        return (
                          <th key={key} className={col.type === "number" ? styles.alignNum : undefined}>
                            {col.header}
                            {col.type === "text" && <span className={styles.textHint}> (văn bản)</span>}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 1].map((rowIndex) => (
                      <tr key={rowIndex}>
                        {exportOrder.map((key) => {
                          const col = catalog.find((c) => c.key === key);
                          if (!col) return null;
                          return (
                            <td key={key} className={col.type === "number" ? styles.alignNum : undefined}>
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

            <span className={styles.columnPreviewLabel}>Bộ lọc</span>
            <div className={styles.filters} role="group" aria-label="Bộ lọc">
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

              {active !== "staff-points" && (
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
