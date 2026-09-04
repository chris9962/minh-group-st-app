"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Calculator, Download } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { fetchScoringExport, type ScoringExportRow } from "@/lib/api/exports";
import { exportExcel, type ExcelColumn } from "@/lib/excel";
import { fetchStaffOptions } from "@/lib/api/staff";
import { errorMessage, toast } from "@/lib/toast";
import { formatDate, formatPoints } from "@/lib/format";
import styles from "./ScoringTable.module.scss";

const iso = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Đầu tháng hiện tại tới hôm nay — khoảng người dùng cần tới nhiều nhất. */
const thisMonthSoFar = (): DateRange => {
  const now = new Date();
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
};

/** Danh sách mã ngân hàng của một khách; khách chưa mở cái nào thì nói rõ. */
function BankList({ codes }: { codes: string[] }) {
  if (codes.length === 0) return <span className={styles.none}>chưa mở</span>;
  return (
    <span className={styles.banks}>
      {codes.map((code) => (
        <span key={code} className={styles.bank}>
          {code}
        </span>
      ))}
    </span>
  );
}

const COLUMNS: RankColumn<ScoringExportRow>[] = [
  {
    key: "customerName",
    label: "Khách hàng",
    sortText: (r) => r.customerName,
    render: (r) => r.customerName,
  },
  {
    key: "date",
    label: "Ngày mở",
    // `date` là ngày mở tài khoản SỚM NHẤT của khách. Khách chưa mở cái nào thì
    // trường này rỗng, và `formatDate` với chuỗi rỗng cho ra "Invalid Date".
    sortBy: (r) => Number(r.date.replace(/-/g, "") || 0),
    render: (r) => (r.date ? formatDate(r.date) : "—"),
  },
  { key: "hamlet", label: "Ấp / Xã", render: (r) => r.hamlet || "—" },
  { key: "channelName", label: "Kênh", render: (r) => r.channelName || "—" },
  {
    key: "openedBanks",
    label: "Ngân hàng đã mở",
    render: (r) => <BankList codes={r.openedBanks} />,
  },
  { key: "household", label: "CNKD / HKD", render: (r) => r.household || "—" },
  {
    key: "installedBanks",
    label: "App đã cài",
    render: (r) => <BankList codes={r.installedBanks} />,
  },
  {
    key: "priorityCount",
    label: "Ưu tiên",
    align: "left",
    sortBy: (r) => r.priorityCount,
    render: (r) => r.priorityCount,
  },
  {
    key: "otherCount",
    label: "Khác",
    align: "left",
    sortBy: (r) => r.otherCount,
    render: (r) => r.otherCount,
  },
  {
    key: "restrictedCount",
    label: "Hạn chế",
    align: "left",
    sortBy: (r) => r.restrictedCount,
    render: (r) => r.restrictedCount,
  },
  {
    key: "combo2Points",
    label: "Combo 2",
    align: "left",
    sortBy: (r) => r.combo2Points,
    render: (r) => formatPoints(r.combo2Points),
  },
  {
    key: "combo3Points",
    label: "Combo 3",
    align: "left",
    sortBy: (r) => r.combo3Points,
    render: (r) => formatPoints(r.combo3Points),
  },
  {
    key: "householdPoints",
    label: "Điểm CNKD / HKD",
    align: "left",
    sortBy: (r) => r.householdPoints,
    render: (r) => formatPoints(r.householdPoints),
  },
  {
    key: "totalPoints",
    label: "Tổng điểm",
    align: "left",
    sortBy: (r) => r.totalPoints,
    render: (r) => formatPoints(r.totalPoints),
  },
];

/**
 * Cột của file Excel — CÙNG danh sách với bảng trên màn, không hơn.
 *
 * Không có CCCD lẫn số điện thoại: máy chủ đã bỏ hai trường đó khỏi lượt gọi
 * (`omitPii`), nên chúng không tồn tại để mà xuất. File đầy đủ 47 cột vẫn nằm ở
 * màn Xuất dữ liệu P-73, nơi có gác quyền.
 */
const EXCEL_COLUMNS: ExcelColumn<ScoringExportRow>[] = [
  { header: "STT", width: 6, type: "number", value: (_r, i) => i + 1 },
  { header: "KHÁCH HÀNG", width: 26, transform: "name", value: (r) => r.customerName },
  { header: "NGÀY MỞ", width: 12, value: (r) => (r.date ? formatDate(r.date) : "") },
  { header: "ẤP / XÃ", width: 24, value: (r) => r.hamlet },
  { header: "KÊNH", width: 14, value: (r) => r.channelName },
  { header: "NGÂN HÀNG ĐÃ MỞ", width: 24, value: (r) => r.openedBanks.join(", ") },
  { header: "CNKD / HKD", width: 12, value: (r) => r.household },
  { header: "APP ĐÃ CÀI", width: 24, value: (r) => r.installedBanks.join(", ") },
  { header: "ƯU TIÊN", width: 9, type: "number", value: (r) => r.priorityCount },
  { header: "KHÁC", width: 9, type: "number", value: (r) => r.otherCount },
  { header: "HẠN CHẾ", width: 9, type: "number", value: (r) => r.restrictedCount },
  { header: "COMBO 2", width: 10, type: "number", value: (r) => r.combo2Points },
  { header: "COMBO 3", width: 10, type: "number", value: (r) => r.combo3Points },
  { header: "ĐIỂM CNKD / HKD", width: 15, type: "number", value: (r) => r.householdPoints },
  {
    header: "TỔNG ĐIỂM",
    width: 12,
    type: "number",
    total: (rows) => Number(rows.reduce((t, r) => t + r.totalPoints, 0).toFixed(2)),
    value: (r) => r.totalPoints,
  },
];

type Props = {
  /** Nhân viên chọn sẵn khi mở, và người dùng vẫn đổi được. */
  defaultStaffId?: string;
  /**
   * Khoá cứng vào một nhân viên và ẩn luôn ô chọn.
   *
   * Dùng ở màn đã nói rõ đang xem ai — hồ sơ nhân viên P-52, màn Tổng quan của
   * chính nhân viên đó. Bày một ô chọn ở đó là mời người dùng đổi sang người
   * khác ngay giữa hồ sơ của một người.
   */
  lockedStaffId?: string;
  /** Số dòng mỗi trang; bỏ trống thì hiện hết. */
  pageSize?: number;
};

/**
 * Bảng "Tính điểm tổng, gộp theo khách" hiện thẳng trên màn — cùng nguồn dữ
 * liệu với báo cáo Excel cùng tên, không tính lại ở đây.
 *
 * Hai ô lọc, không hơn: nhân viên và khoảng ngày. Lọc theo NGƯỜI LẬP HỒ SƠ
 * khách, đúng người nhận điểm combo (thể lệ câu 7.11) — không phải người mở
 * tài khoản.
 *
 * KHÔNG có cột CCCD lẫn số điện thoại, và máy chủ cũng không gửi hai trường đó
 * xuống (chốt 2026-09-04). Chúng chỉ tồn tại trong file Excel.
 *
 * Khách chưa mở ngân hàng nào VẪN nằm trong bảng (`include: "all"`): người xem
 * cần thấy đủ khách của nhân viên đó, kể cả khách 0 điểm.
 *
 * Khoảng ngày khoá trong MỘT tháng: điểm tính theo tháng và tổ hợp không nối
 * qua tháng (thể lệ câu 7.13), nên một khoảng vắt hai tháng ra con số không ai
 * đoán được.
 *
 * Máy chủ trả TRỌN danh sách khớp bộ lọc, không phân trang — đây là đường xuất
 * dữ liệu. Lọc theo một nhân viên trong một tháng nên vài chục dòng; `pageSize`
 * cắt ở trình duyệt là đủ.
 */
export function ScoringTable({ defaultStaffId = "", lockedStaffId, pageSize }: Props) {
  const [pickedStaffId, setPickedStaffId] = useState(defaultStaffId);
  const [range, setRange] = useState<DateRange | undefined>(thisMonthSoFar);

  const staffId = lockedStaffId ?? pickedStaffId;

  const { data: staff = [] } = useQuery({
    queryKey: ["staff", "options", "all"],
    queryFn: () => fetchStaffOptions({ status: "all" }),
    retry: false,
    staleTime: Infinity,
    // Khoá cứng vào một người thì không có ô chọn nào để đổ danh sách vào.
    enabled: !lockedStaffId,
  });

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";
  const ready = Boolean(staffId && from && to);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["scoring-table", staffId, from, to],
    queryFn: () =>
      fetchScoringExport(
        {
          search: "",
          bankCode: "",
          from,
          to,
          referralCode: "",
          channelId: "",
          staffId,
          departmentId: "",
          status: "",
          accountType: "",
        },
        "all",
        // Máy chủ bỏ CCCD và số điện thoại: hai trường đó chỉ tồn tại trong file
        // Excel. Xoá cột ở đây là chưa đủ — dữ liệu vẫn nằm trong lượt gọi mạng.
        true,
      ),
    enabled: ready,
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const tongDiem = rows.reduce((t, r) => t + r.totalPoints, 0);

  const [xuatDang, setXuatDang] = useState(false);
  /**
   * Xuất đúng những dòng đang hiện, không gọi lại máy chủ.
   *
   * `rows` đã là trọn danh sách khớp bộ lọc — `pageSize` chỉ cắt trang ở trình
   * duyệt. Gọi lại là một lượt mạng thừa và mở đường cho hai lần gọi ra hai kết
   * quả khác nhau.
   */
  const xuatExcel = async () => {
    setXuatDang(true);
    try {
      await exportExcel({
        fileName: `bang-diem-${from}-den-${to}.xlsx`,
        sheetName: `Điểm ${from.slice(0, 7)}`,
        columns: EXCEL_COLUMNS,
        rows,
      });
    } catch (e) {
      toast.fail(errorMessage(e, "Không xuất được file"));
    } finally {
      setXuatDang(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={lockedStaffId ? styles.oneFilter : styles.filters}>
        {!lockedStaffId && (
          <Combobox
            block
            // Combobox chứ không phải Select: công ty có hàng trăm nhân viên, mà
            // `<select>` gốc không gõ tìm được.
            label="Nhân viên"
            placeholder="Gõ để tìm nhân viên…"
            value={pickedStaffId}
            onChange={setPickedStaffId}
            options={[
              { value: "", label: "Chưa chọn nhân viên" },
              ...staff.map((s) => ({ value: s.id, label: s.fullName })),
            ]}
          />
        )}
        <DateRangePicker label="Khoảng ngày" value={range} onChange={setRange} sameMonthOnly />
      </div>

      {!ready ? (
        <p className="text-muted">Chọn nhân viên và khoảng ngày để xem bảng điểm.</p>
      ) : isError ? (
        <ErrorState what="bảng tính điểm tổng" onRetry={refetch} retrying={isFetching} />
      ) : isPending ? (
        <SkeletonTable rows={8} columns={8} />
      ) : (
        <SectionCard
          title="Tính điểm tổng, gộp theo khách"
          icon={<Calculator size={17} />}
          meta={`${rows.length} khách - ${formatPoints(tongDiem)} điểm`}
          action={
            <Button
              variant="secondary"
              disabled={rows.length === 0 || xuatDang}
              onClick={xuatExcel}
            >
              <Download size={16} aria-hidden />
              {xuatDang ? "Đang xuất…" : "Xuất Excel"}
            </Button>
          }
        >
          <div className={styles.scroll}>
            <RankTable
              rows={rows}
              columns={COLUMNS}
              rowKey={(r) => r.customerId}
              defaultSort="date"
              pageSize={pageSize}
              caption="Điểm từng khách của nhân viên đã chọn"
              emptyText="Nhân viên này chưa lập hồ sơ khách nào trong khoảng ngày đã chọn."
            />
          </div>
        </SectionCard>
      )}
    </div>
  );
}
