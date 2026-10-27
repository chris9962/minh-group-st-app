"use client";

import { useQuery } from "@tanstack/react-query";
import { Boxes, FileSpreadsheet, History, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { monthLabel } from "@/components/ui/MonthPicker";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonText } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  fetchGiftStockMonth,
  type GiftStockEntry,
  type GiftStockItem,
  type GiftStockMonth,
} from "@/lib/api/giftStock";
import { EXCEL_GROUP_COLORS, exportExcelSheets, type ExcelColumn, type ExcelSheet } from "@/lib/excel";
import { formatCount, formatDateTime } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import { GiftStockEntryDialog } from "./GiftStockEntryDialog";
import styles from "./GiftStockSection.module.scss";

/** P-87 · Kho quà của một tháng: bảng tổng mỗi món và danh sách các lần nhập. */
export function GiftStockSection({ month }: { month: string }) {
  const stock = useQuery({ queryKey: ["gift-stock", month], queryFn: () => fetchGiftStockMonth(month) });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GiftStockEntry | null>(null);
  const [exporting, setExporting] = useState(false);
  const data = stock.data;

  const exportFile = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await exportGiftStock(data);
    } catch (e) {
      toast.fail(errorMessage(e, "Không xuất được file Excel."));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <SectionCard
        title={`Tồn kho ${monthLabel(month).toLowerCase()}`}
        icon={<Boxes size={17} />}
        action={
          <span className={styles.actions}>
            <Button variant="secondary" disabled={!data || exporting} onClick={exportFile}>
              <FileSpreadsheet size={16} aria-hidden />
              Xuất Excel
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden />
              Nhập quà
            </Button>
          </span>
        }
      >
        {stock.isPending && <SkeletonText lines={3} label="Đang tải kho quà" />}
        {stock.isError && <ErrorState what="kho quà" onRetry={stock.refetch} retrying={stock.isFetching} />}
        {data && data.items.length === 0 && (
          <p className="text-muted">Chưa có món nào nhập quà tới {monthLabel(month).toLowerCase()}.</p>
        )}
        {data && data.items.length > 0 && (
          <div className={styles.scroll}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Món</th>
                  <th scope="col">Tồn đầu tháng</th>
                  <th scope="col">Số lần nhập</th>
                  <th scope="col">Số lượng nhập</th>
                  <th scope="col">Số lượt phát</th>
                  <th scope="col">Tồn cuối tháng</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.giftItemId}>
                    <td>
                      <span className={styles.itemName}>
                        {item.name}
                        <ItemState item={item} />
                      </span>
                    </td>
                    <td className="tabular-nums">{formatCount(item.openingStock)}</td>
                    <td className="tabular-nums">{formatCount(item.entryCount)}</td>
                    <td className="tabular-nums">{formatCount(item.entryQuantity)}</td>
                    <td className="tabular-nums">{formatCount(item.issued)}</td>
                    <td className="tabular-nums">{formatCount(item.closingStock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Các lần nhập trong tháng"
        icon={<History size={17} />}
        meta={data ? `${formatCount(data.entries.length)} lần` : undefined}
      >
        {data && data.entries.length === 0 && (
          <p className="text-muted">{monthLabel(month)} chưa có lần nhập quà nào.</p>
        )}
        {data && data.entries.length > 0 && (
          <div className={styles.scroll}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Ngày nhập</th>
                  <th scope="col">Món</th>
                  <th scope="col">Số lượng</th>
                  <th scope="col">Người nhập</th>
                  <th scope="col">Ghi chú</th>
                  <th scope="col">
                    <span className="sr-only">Sửa</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="tabular-nums">{formatDateTime(entry.createdAt)}</td>
                    <td>{entry.itemName}</td>
                    <td className="tabular-nums">{formatCount(entry.quantity)}</td>
                    <td>{entry.createdByName}</td>
                    <td>{entry.note}</td>
                    <td>
                      <Button
                        variant="secondary"
                        icon
                        tooltip="Sửa lần nhập"
                        aria-label={`Sửa lần nhập ${entry.itemName} lúc ${formatDateTime(entry.createdAt)}`}
                        onClick={() => setEditing(entry)}
                      >
                        <Pencil size={16} aria-hidden />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {(creating || editing) && (
        <GiftStockEntryDialog
          entry={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/** Trạng thái lúc tải màn, không theo tháng đang xem: ngừng cấp và hết hàng là chuyện của hiện tại. */
function ItemState({ item }: { item: GiftStockItem }) {
  if (!item.active) return <StatusTag tone="neutral">Đã ngưng cấp</StatusTag>;
  if (item.remaining <= 0) return <StatusTag tone="warn">Hết hàng</StatusTag>;
  return null;
}

async function exportGiftStock(data: GiftStockMonth) {
  const stock = { group: "TỒN KHO", groupColor: EXCEL_GROUP_COLORS.gift };
  const entryGroup = { group: "LẦN NHẬP", groupColor: EXCEL_GROUP_COLORS.gift };
  const staff = { group: "NGƯỜI NHẬP", groupColor: EXCEL_GROUP_COLORS.staff };
  const sum = <T,>(pick: (r: T) => number) => (rows: T[]) => rows.reduce((s, r) => s + pick(r), 0);

  const itemColumns: ExcelColumn<GiftStockItem>[] = [
    { header: "STT", ...stock, width: 6, total: (rows) => rows.length, value: (_r, i) => i + 1 },
    { header: "MÓN", ...stock, width: 22, value: (r) => r.name },
    { header: "TỒN ĐẦU THÁNG", ...stock, type: "number", width: 14, total: sum((r) => r.openingStock), value: (r) => r.openingStock },
    { header: "SỐ LẦN NHẬP", ...stock, type: "number", width: 12, total: sum((r) => r.entryCount), value: (r) => r.entryCount },
    { header: "SỐ LƯỢNG NHẬP", ...stock, type: "number", width: 14, total: sum((r) => r.entryQuantity), value: (r) => r.entryQuantity },
    { header: "SỐ LƯỢT PHÁT", ...stock, type: "number", width: 13, total: sum((r) => r.issued), value: (r) => r.issued },
    { header: "TỒN CUỐI THÁNG", ...stock, type: "number", width: 14, total: sum((r) => r.closingStock), value: (r) => r.closingStock },
  ];
  const entryColumns: ExcelColumn<GiftStockEntry>[] = [
    { header: "STT", ...entryGroup, width: 6, total: (rows) => rows.length, value: (_r, i) => i + 1 },
    { header: "NGÀY NHẬP", ...entryGroup, width: 18, value: (r) => formatDateTime(r.createdAt) },
    { header: "MÓN", ...entryGroup, width: 22, value: (r) => r.itemName },
    { header: "SỐ LƯỢNG", ...entryGroup, type: "number", width: 11, total: sum((r) => r.quantity), value: (r) => r.quantity },
    { header: "GHI CHÚ", ...entryGroup, type: "text", width: 30, value: (r) => r.note },
    { header: "NGƯỜI NHẬP", ...staff, width: 24, value: (r) => r.createdByName },
    { header: "MÃ NHÂN VIÊN", ...staff, type: "text", width: 15, value: (r) => r.createdByStaffCode },
    { header: "PHÒNG", ...staff, width: 24, value: (r) => r.createdByDepartmentName },
  ];

  // Hai sheet hai kiểu dòng; `exportExcelSheets` chỉ nhận một kiểu nên ép qua `unknown`.
  const sheets = [
    { sheetName: "Tồn kho", columns: itemColumns, rows: data.items },
    { sheetName: "Lần nhập", columns: entryColumns, rows: data.entries },
  ] as unknown as ExcelSheet<unknown>[];
  await exportExcelSheets({ fileName: `kho-qua-${data.month}.xlsx`, sheets });
}
