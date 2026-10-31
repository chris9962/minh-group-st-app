"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Download, Wrench } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { iso, thisMonthSoFar } from "@/components/exports/ScoringTable";
import { Button } from "@/components/ui/Button";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { PAGE_SIZE, type Page, type SortDir } from "@/lib/api/pagination";
import {
  fetchPersonServices,
  fetchPersonServicesForExport,
  type PersonService,
} from "@/lib/api/person";
import { EXCEL_GROUP_COLORS, exportExcel, type ExcelColumn } from "@/lib/excel";
import { formatDate, formatPoints } from "@/lib/format";
import { can } from "@/lib/permissions";
import { errorMessage, toast } from "@/lib/toast";
import { useSession } from "@/store/session";
import styles from "./PersonServicesTable.module.scss";

const COLUMNS: RankColumn<PersonService>[] = [
  {
    key: "date",
    label: "Ngày",
    sortBy: (s) => Number(s.date.replace(/-/g, "")),
    sortable: true,
    render: (s) => formatDate(s.date),
  },
  {
    key: "customerName",
    label: "Khách hàng",
    render: (s) => (
      <Link href={`/customers/${s.customerId}`} className={styles.nameLink}>
        {s.customerName}
      </Link>
    ),
  },
  { key: "serviceType", label: "Loại dịch vụ", render: (s) => s.serviceType },
  { key: "ward", label: "Xã", render: (s) => s.ward || "—" },
  {
    key: "points",
    label: "Điểm",
    sortBy: (s) => s.points,
    render: (s) => formatPoints(s.points),
  },
];

const SERVICE_GROUP = { group: "LƯỢT DỊCH VỤ", groupColor: EXCEL_GROUP_COLORS.account };
const CUSTOMER_GROUP = { group: "KHÁCH HÀNG", groupColor: EXCEL_GROUP_COLORS.customer };

const EXCEL_COLUMNS: ExcelColumn<PersonService>[] = [
  { header: "STT", width: 6, type: "number", ...CUSTOMER_GROUP, total: (rows) => rows.length, value: (_s, i) => i + 1 },
  { header: "KHÁCH HÀNG", width: 26, transform: "name", ...CUSTOMER_GROUP, value: (s) => s.customerName },
  { header: "NGÀY", width: 12, ...SERVICE_GROUP, value: (s) => formatDate(s.date) },
  { header: "LOẠI DỊCH VỤ", width: 30, ...SERVICE_GROUP, value: (s) => s.serviceType },
  { header: "XÃ", width: 20, ...SERVICE_GROUP, value: (s) => s.ward },
  {
    header: "ĐIỂM",
    width: 10,
    type: "number",
    group: "ĐIỂM",
    groupColor: EXCEL_GROUP_COLORS.points,
    total: (rows) => Number(rows.reduce((t, s) => t + s.points, 0).toFixed(2)),
    value: (s) => s.points,
  },
];

type Props = {
  staffId: string;
  from: string;
  to: string;
  /** "Hôm nay" · "T9/2026" — đi vào câu chú của bảng. */
  periodText: string;
  page: number;
  dir: SortDir;
  onPageChange: (page: number) => void;
  onDirChange: (dir: SortDir) => void;
  data: Page<PersonService> | undefined;
};

/** Lượt dịch vụ kèm điểm của một người, cùng khuôn với `HandledOrdersTable`: nơi gọi giữ truy vấn. */
export function PersonServicesTable({
  staffId,
  from,
  to,
  periodText,
  page,
  dir,
  onPageChange,
  onDirChange,
  data,
}: Props) {
  const user = useSession((s) => s.user);
  const [exporting, setExporting] = useState(false);
  const total = data?.total ?? 0;

  const exportAll = async () => {
    setExporting(true);
    try {
      const rows = await fetchPersonServicesForExport({ id: staffId, from, to });
      await exportExcel({
        fileName: `diem-dich-vu-${from}-den-${to}.xlsx`,
        sheetName: "Điểm dịch vụ",
        columns: EXCEL_COLUMNS,
        rows,
      });
      toast.ok(`Đã xuất ${rows.length.toLocaleString("vi-VN")} lượt dịch vụ`);
    } catch (e) {
      toast.fail(errorMessage(e, "Không xuất được file Excel."));
    } finally {
      setExporting(false);
    }
  };

  // Tự xuất việc của mình không cần `staff:export`, cùng chốt với máy chủ.
  const canExport = user?.id === staffId || can(user, "staff", "export");

  return (
    <>
      {canExport && (
        <div className={styles.tools}>
          <Button variant="secondary" onClick={exportAll} disabled={exporting || total === 0}>
            <Download size={16} aria-hidden />
            {exporting ? "Đang xuất…" : "Xuất Excel"}
          </Button>
        </div>
      )}
      <RankTable
        rows={data?.rows ?? []}
        columns={COLUMNS}
        rowKey={(s) => s.id}
        defaultSort="date"
        caption={`Dịch vụ đã làm cho khách ${periodText}`}
        emptyText="Chưa có lượt dịch vụ nào trong khoảng ngày đã chọn."
        server={{
          sort: "date",
          dir,
          page,
          total,
          pageSize: PAGE_SIZE,
          onSortChange: (_sort, next) => {
            onDirChange(next);
            onPageChange(0);
          },
          onPageChange,
        }}
      />
    </>
  );
}

/**
 * Khối Điểm dịch vụ TỰ CHỨA cho màn Tổng quan của nhân viên: ô khoảng ngày riêng
 * như bảng Điểm cài app bên cạnh, không đọc kỳ ở thanh trên.
 */
export function PersonServicePoints({ staffId }: { staffId: string }) {
  const [range, setRange] = useState<DateRange | undefined>(thisMonthSoFar);
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState<SortDir>("desc");

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["person-services", staffId, from, to, page, dir],
    queryFn: () => fetchPersonServices({ id: staffId, from, to, page, dir }),
    enabled: Boolean(from && to),
    placeholderData: keepPreviousData,
  });

  return (
    <div className={styles.wrap}>
      <div className={styles.filter}>
        <DateRangePicker
          label="Khoảng ngày"
          value={range}
          onChange={(next) => {
            setRange(next);
            setPage(0);
          }}
        />
      </div>
      {!from || !to ? (
        <p className="text-muted">Chọn khoảng ngày để xem điểm dịch vụ.</p>
      ) : isError ? (
        <ErrorState what="điểm dịch vụ" onRetry={refetch} retrying={isFetching} />
      ) : isPending ? (
        <SkeletonTable rows={8} columns={5} />
      ) : (
        <SectionCard title="Điểm dịch vụ" icon={<Wrench size={17} />} meta={`${data.total} lượt`}>
          <PersonServicesTable
            staffId={staffId}
            from={from}
            to={to}
            periodText={`từ ${formatDate(from)} đến ${formatDate(to)}`}
            page={page}
            dir={dir}
            onPageChange={setPage}
            onDirChange={setDir}
            data={data}
          />
        </SectionCard>
      )}
    </div>
  );
}
