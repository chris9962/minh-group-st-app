"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ClipboardCheck, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import {
  fetchPersonHandled,
  fetchPersonHandledForExport,
  type PersonHandledOrder,
} from "@/lib/api/person";
import { PAGE_SIZE, type Page, type SortDir } from "@/lib/api/pagination";
import { exportExcel } from "@/lib/excel";
import { formatDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { errorMessage, toast } from "@/lib/toast";
import { PRODUCT_LABEL } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./HandledOrdersTable.module.scss";

/**
 * Mã đơn bấm được, mở chi tiết đơn ở TAB MỚI.
 *
 * Người xem đang dò một bảng dài; mở tại chỗ là mất kỳ đang chọn và vị trí cuộn.
 * Không có quyền xem đơn thì hiện chữ trơn — bấm vào chỉ nhận một màn báo lỗi.
 */
function OrderCodeCell({ id, code }: { id: string; code: string }) {
  const user = useSession((s) => s.user);
  if (!can(user, "insurance", "view-detail")) return <>{code}</>;
  return (
    <Link
      href={`/insurance/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.nameLink}
      aria-label={`Mở đơn ${code} ở tab mới`}
    >
      {code}
      <ExternalLink size={13} aria-hidden className={styles.newTab} />
    </Link>
  );
}

/**
 * Đơn người này ĐÃ XỬ LÝ TAY — khác danh sách đơn họ TẠO.
 *
 * Không có cột Trạng thái: đơn đã qua tay người xử lý thì việc cần đọc là mã
 * đơn, khách nào, loại gì, mấy năm. Trạng thái nằm ở màn chi tiết đơn.
 */
const COLUMNS: RankColumn<PersonHandledOrder>[] = [
  {
    key: "date",
    label: "Ngày",
    sortBy: (o) => Number(o.date.replace(/-/g, "")),
    sortable: true,
    render: (o) => formatDate(o.date),
  },
  {
    key: "orderCode",
    label: "Mã đơn",
    render: (o) => <OrderCodeCell id={o.id} code={o.orderCode} />,
  },
  {
    key: "customerName",
    label: "Khách hàng",
    render: (o) => (
      <Link href={`/customers/${o.customerId}`} className={styles.nameLink}>
        {o.customerName}
      </Link>
    ),
  },
  { key: "product", label: "Loại bảo hiểm", render: (o) => PRODUCT_LABEL[o.product] },
  { key: "years", label: "Số năm", sortBy: (o) => o.years, render: (o) => o.years },
];

type Props = {
  staffId: string;
  /** Kỳ đã quy về hai ngày `YYYY-MM-DD` — nơi gọi tự chọn kiểu kỳ của mình. */
  from: string;
  to: string;
  /** "Hôm nay" · "T9/2026" — đi vào câu chú của bảng. */
  periodText: string;
  /** Trang do NƠI GỌI giữ, để hai màn tự quyết cách nhớ trang. */
  page: number;
  dir: SortDir;
  onPageChange: (page: number) => void;
  onDirChange: (dir: SortDir) => void;
  data: Page<PersonHandledOrder> | undefined;
};

/**
 * Bảng đơn đã xử lý tay, dùng chung ở hai màn: hồ sơ nhân viên P-52 (cấp trên
 * xem) và màn Tổng quan của chính nhân viên đó (tự xem) — AGENTS.md §2.
 *
 * Nơi gọi giữ truy vấn, không phải khối này: hai màn gọi nó bằng hai kỳ khác
 * nhau, và P-52 cần biết số dòng TRƯỚC khi vẽ để quyết định có hiện tab hay không.
 */
export function HandledOrdersTable({
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

  /**
   * Xuất từ đường RIÊNG, không dựng file từ trang đang xem.
   *
   * Dựng từ `data.rows` thì file chỉ có 15 dòng của trang hiện tại mà trông y
   * hệt file đầy đủ — người nhận không có cách nào biết.
   */
  const exportAll = async () => {
    setExporting(true);
    try {
      const rows = await fetchPersonHandledForExport({ id: staffId, from, to });
      await exportExcel({
        fileName: `don-da-xu-ly-${from}-${to}.xlsx`,
        sheetName: "Đơn đã xử lý",
        rows,
        columns: [
          { header: "Ngày", value: (o) => formatDate(o.date) },
          // `text` cho mã đơn: để mặc định thì Excel đọc `DH-2609-016` thành
          // công thức trừ ở vài phiên bản.
          { header: "Mã đơn", type: "text", value: (o) => o.orderCode },
          { header: "Khách hàng", transform: "name", value: (o) => o.customerName },
          { header: "Loại bảo hiểm", value: (o) => PRODUCT_LABEL[o.product] },
          { header: "Số năm", type: "number", value: (o) => o.years },
        ],
      });
      toast.ok(`Đã xuất ${rows.length.toLocaleString("vi-VN")} đơn`);
    } catch (e) {
      toast.fail(errorMessage(e, "Không xuất được file Excel."));
    } finally {
      setExporting(false);
    }
  };

  // Tự xuất việc của mình không cần `staff:export` — cùng chốt với máy chủ.
  const canExport = user?.id === staffId || can(user, "staff", "export");

  return (
    <>
      {canExport && (
        <div className={styles.tools}>
          <Button variant="secondary" onClick={exportAll} disabled={exporting || total === 0}>
            <Download size={16} aria-hidden />
            Xuất Excel
          </Button>
        </div>
      )}
      <RankTable
        rows={data?.rows ?? []}
        columns={COLUMNS}
        rowKey={(o) => o.id}
        defaultSort="date"
        caption={`Đơn bảo hiểm đã xử lý tay ${periodText}`}
        emptyText="Chưa xử lý đơn nào."
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
 * Khối "Đơn đã xử lý" TỰ CHỨA — dùng ở màn Tổng quan, nơi không có hệ tab.
 *
 * Tự giữ truy vấn và trang, và tự vắng mặt khi không có dòng nào. Khác cách
 * P-52 dùng: ở đó hệ tab phải biết số dòng TRƯỚC khi vẽ để quyết định có hiện
 * tab hay không, nên truy vấn nằm ở khối tab.
 *
 * ⚠️ Nơi gọi PHẢI đặt `key={`${from}:${to}`}` — đổi kỳ là danh sách đổi nội
 * dung, giữ trang 3 của kỳ cũ là hiện một khúc rỗng (AGENTS.md §7).
 */
export function HandledOrdersSection({
  staffId,
  from,
  to,
  periodText,
}: Pick<Props, "staffId" | "from" | "to" | "periodText">) {
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState<SortDir>("desc");

  const { data } = useQuery({
    queryKey: ["person-handled", staffId, from, to, page, dir],
    queryFn: () => fetchPersonHandled({ id: staffId, from, to, page, dir }),
    placeholderData: keepPreviousData,
  });

  // Người không có quyền `insurance:handle-fallback` không bao giờ có đơn nào ở
  // đây, nên khối tự vắng mặt mà không phải hỏi quyền của ai.
  if ((data?.total ?? 0) === 0) return null;

  return (
    <SectionCard title="Đơn đã xử lý" icon={<ClipboardCheck size={17} />} meta={`${data!.total} đơn`}>
      <HandledOrdersTable
        staffId={staffId}
        from={from}
        to={to}
        periodText={periodText}
        page={page}
        dir={dir}
        onPageChange={setPage}
        onDirChange={setDir}
        data={data}
      />
    </SectionCard>
  );
}
