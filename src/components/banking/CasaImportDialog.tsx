"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { useId, useRef, useState } from "react";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { MonthPicker, monthLabel, thisMonth } from "@/components/ui/MonthPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import {
  CASA_FILE_COLUMNS,
  CASA_IMPORT_MAX_ROWS,
  fetchCasaMonth,
  importCasa,
  type CasaFileRow,
  type CasaImportResult,
  type CasaPreviewRow,
} from "@/lib/api/casa";
import { shiftMonth } from "@/lib/period";
import { readExcelRows } from "@/lib/readExcelRows";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./CasaImportDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
};

type Checked = { rows: CasaFileRow[]; result: CasaImportResult };

type View = "all" | "errors" | "differences" | "imported";

const PAGE_SIZE = 10;

const isNew = (r: CasaPreviewRow) => r.errors.length === 0 && r.importedMonth === null;

function Problems({ errors, differences, importedMonth }: CasaPreviewRow) {
  if (importedMonth) return <>Đã nhập lương {monthLabel(importedMonth).toLowerCase()}</>;
  if (errors.length === 0 && differences.length === 0) return <>Hợp lệ</>;
  return (
    <ul className={styles.problems}>
      {errors.map((e) => (
        <li key={e} className={styles.error}>
          Lỗi: {e}
        </li>
      ))}
      {differences.map((d) => (
        <li key={d}>Lệch: {d}</li>
      ))}
    </ul>
  );
}

const columns: RankColumn<CasaPreviewRow>[] = [
  { key: "row", label: "Dòng", render: (r) => r.row },
  { key: "fullName", label: "Khách", render: (r) => r.fullName || "—" },
  { key: "idNumber", label: "CCCD", render: (r) => (r.idNumberTail ? `…${r.idNumberTail}` : "—") },
  { key: "staffCode", label: "Mã nhân viên", render: (r) => r.staffCode || "—" },
  { key: "accountNumber", label: "STK VPa", render: (r) => r.accountNumber || "—" },
  { key: "status", label: "Kết quả kiểm", render: (r) => <Problems {...r} /> },
];

/** Dòng lỗi lên đầu, rồi dòng lệch, rồi dòng đã nhập, giữ thứ tự dòng trong từng nhóm. */
const problemsFirst = (rows: CasaPreviewRow[]) =>
  [...rows].sort(
    (a, b) =>
      Number(b.errors.length > 0) - Number(a.errors.length > 0) ||
      Number(b.differences.length > 0) - Number(a.differences.length > 0) ||
      Number(b.importedMonth !== null) - Number(a.importedMonth !== null),
  );

/**
 * Nhập sheet "CHI TIẾT CASA ĐẠT" vào lương một tháng. Bước 1 chọn tháng lương
 * và file, bước 2 là bảng máy chủ kiểm từng dòng. Có một dòng lỗi thì không ghi
 * được, cùng luật với hộp thoại nhập file BHYT/BHXH. Tài khoản đã nhập ở tháng
 * lương nào thì chỉ hiện ở tab "Đã nhập", không ghi lại.
 */
export function CasaImportDialog({ open, onClose }: Props) {
  const monthLabelId = useId();
  const fileLabelId = useId();
  const fileNameId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  // File T09 nhập vào lương tháng 10 lúc 2026-11-09, nên mặc định là tháng trước.
  const [month, setMonth] = useState(() => shiftMonth(thisMonth(), -1));
  const casa = useQuery({ queryKey: ["casa-month", month], queryFn: () => fetchCasaMonth(month) });
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [view, setView] = useState<View>("all");

  const check = useMutation({
    mutationFn: async (): Promise<Checked> => {
      if (!file) throw new Error("Chưa chọn file.");
      const rows = (await readExcelRows(file, CASA_FILE_COLUMNS, { anySheet: true })) as CasaFileRow[];
      if (rows.length === 0) throw new Error("File không có dòng dữ liệu nào.");
      if (rows.length > CASA_IMPORT_MAX_ROWS)
        throw new Error(`File có ${rows.length} dòng, mỗi lượt nhập tối đa ${CASA_IMPORT_MAX_ROWS} dòng.`);
      return { rows, result: await importCasa(month, { rows, commit: false }) };
    },
    onSuccess: (next) => {
      setChecked(next);
      setView(next.result.rows.some((r) => r.errors.length > 0) ? "errors" : "all");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đọc được file này.")),
  });

  const save = useMutation({
    mutationFn: (target: Checked) => importCasa(month, { rows: target.rows, commit: true }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["casa-month", month] });
      // Lương ở P-51/P-52 đọc số CASA của tháng: ghi xong phải thấy ngay ở đó.
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["person"] });
      toast.ok(`Đã ghi ${result.written} tài khoản CASA.`);
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không ghi được file này.")),
  });

  const preview = checked?.result.rows ?? [];
  const errorRows = preview.filter((r) => r.errors.length > 0).length;
  const differenceRows = preview.filter((r) => r.differences.length > 0).length;
  const importedRows = preview.filter((r) => r.importedMonth !== null).length;
  const newRows = preview.filter(isNew).length;
  const shown =
    view === "errors"
      ? preview.filter((r) => r.errors.length > 0)
      : view === "differences"
        ? preview.filter((r) => r.differences.length > 0)
        : view === "imported"
          ? preview.filter((r) => r.importedMonth !== null)
          : problemsFirst(preview);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      full={checked !== null}
      title={checked ? `Nhập file CASA lương ${monthLabel(month).toLowerCase()}` : "Nhập file CASA"}
      footerStart={
        checked && (
          <BackButton
            onClick={() => {
              setChecked(null);
              setFile(null);
            }}
          >
            Chọn file khác
          </BackButton>
        )
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          {checked ? (
            <Button
              disabled={errorRows > 0 || newRows === 0 || save.isPending}
              onClick={() => save.mutate(checked)}
            >
              Ghi {newRows} tài khoản
            </Button>
          ) : (
            <Button
              disabled={file === null || !casa.data || casa.data.locked || check.isPending}
              onClick={() => check.mutate()}
            >
              Kiểm tra
            </Button>
          )}
        </>
      }
    >
      {checked ? (
        <div className={styles.body}>
          <p className={errorRows > 0 ? styles.error : styles.summary} role="status">
            {errorRows > 0 ? `File có ${errorRows} dòng lỗi.` : `${newRows} dòng mới.`}
            {importedRows > 0 && ` ${importedRows} dòng đã nhập.`}
            {differenceRows > 0 && ` ${differenceRows} dòng lệch.`}
          </p>
          {(errorRows > 0 || differenceRows > 0 || importedRows > 0) && (
            <SegmentedTabs
              label="Lọc dòng"
              value={view}
              onChange={(v) => setView(v as View)}
              options={[
                { value: "all", label: "Tất cả", count: preview.length },
                ...(errorRows > 0 ? [{ value: "errors", label: "Lỗi", count: errorRows }] : []),
                ...(differenceRows > 0 ? [{ value: "differences", label: "Lệch", count: differenceRows }] : []),
                ...(importedRows > 0 ? [{ value: "imported", label: "Đã nhập", count: importedRows }] : []),
              ]}
            />
          )}
          <RankTable
            rows={shown}
            columns={columns}
            rowKey={(r) => String(r.row)}
            defaultSort="row"
            caption="Kết quả kiểm từng dòng của file CASA"
            pageSize={PAGE_SIZE}
          />
        </div>
      ) : (
        <div className={styles.body}>
          <div className={styles.field}>
            <span id={monthLabelId} className={styles.label}>
              Tháng lương
            </span>
            <div role="group" aria-labelledby={monthLabelId}>
              <MonthPicker value={month} onChange={setMonth} />
            </div>
            {casa.data && (
              <p className={casa.data.locked ? styles.error : styles.summary} role="status">
                {casa.data.locked
                  ? `Lương ${monthLabel(month).toLowerCase()} đã chốt.`
                  : `Đã nhập ${casa.data.count} tài khoản.`}
              </p>
            )}
            {casa.isError && (
              <ErrorState what="tài khoản CASA" onRetry={casa.refetch} retrying={casa.isFetching} />
            )}
          </div>
          <div className={styles.field}>
            <span id={fileLabelId} className={styles.label}>
              File Excel
            </span>
            {/* Ô file gốc hiện chữ theo ngôn ngữ trình duyệt ("Choose file"), nên ẩn đi và mở bằng nút của app. */}
            <div className={styles.filePick}>
              <Button
                variant="secondary"
                aria-labelledby={fileLabelId}
                aria-describedby={fileNameId}
                onClick={() => fileInput.current?.click()}
              >
                <FileSpreadsheet size={16} aria-hidden />
                Chọn file
              </Button>
              <span id={fileNameId} className={file ? styles.fileName : styles.fileEmpty}>
                {file ? file.name : "Chưa chọn file"}
              </span>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) setFile(picked);
                // Dọn ô để chọn lại đúng file đó vẫn phát `change`.
                e.target.value = "";
              }}
            />
          </div>
        </div>
      )}
    </Dialog>
  );
}
