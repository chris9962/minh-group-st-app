"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { MonthPicker, monthLabel, thisMonth } from "@/components/ui/MonthPicker";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { fetchCasaMonth, type CasaPreviewRow } from "@/lib/api/casa";
import {
  VPA_TARGET_FILE_COLUMNS,
  VPA_TARGET_MAX_ROWS,
  importVpaTargets,
  isQualifiedValue,
  type StaffDeduction,
  type UnqualifiedRow,
  type VpaTargetFileRow,
  type VpaTargetImportResult,
} from "@/lib/api/vpaTargets";
import { formatPoints } from "@/lib/format";
import { shiftMonth } from "@/lib/period";
import { readExcelRows } from "@/lib/readExcelRows";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./VpaTargetImportDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
};

type Checked = { rows: VpaTargetFileRow[]; result: VpaTargetImportResult };

type View = "staff" | "unqualified" | "casa" | "errors";

const PAGE_SIZE = 10;

const fileSize = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("vi-VN")} KB`;

const isNewCasa = (r: CasaPreviewRow) => r.errors.length === 0 && r.importedMonth === null && !r.skipped;

// Giá trị lạ ở cột TMDK thường do đọc nhầm cột hoặc ngân hàng đổi định dạng ô.
function qualifiedWarnings(rows: VpaTargetFileRow[]): string[] {
  const odd = rows.map((r) => r.qualified.trim()).filter((v) => v !== "" && !isQualifiedValue(v));
  const samples = [...new Set(odd)]
    .slice(0, 3)
    .map((v) => `"${v}"`)
    .join(", ");
  return [
    ...(odd.length > 0
      ? [`Cột TMDK có ${odd.length.toLocaleString("vi-VN")} dòng ghi khác số 1: ${samples}. Các dòng này tính là không đạt.`]
      : []),
    ...(rows.some((r) => isQualifiedValue(r.qualified))
      ? []
      : [`Không dòng nào có TMDK là 1. Cả ${rows.length.toLocaleString("vi-VN")} dòng tính là không đạt.`]),
  ];
}

function CasaProblems({ errors, differences, importedMonth }: CasaPreviewRow) {
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

function UnqualifiedResult({ errors, note, points, casaRemovedMonth }: UnqualifiedRow) {
  const lines = [
    ...errors.map((e) => ({ text: `Lỗi: ${e}`, error: true })),
    ...(note ? [{ text: note, error: false }] : []),
    ...(points !== null ? [{ text: `Trừ ${formatPoints(points)} điểm`, error: false }] : []),
    ...(casaRemovedMonth
      ? [{ text: `Bỏ CASA lương ${monthLabel(casaRemovedMonth).toLowerCase()}`, error: false }]
      : []),
  ];
  return (
    <ul className={styles.problems}>
      {lines.map((l) => (
        <li key={l.text} className={l.error ? styles.error : undefined}>
          {l.text}
        </li>
      ))}
    </ul>
  );
}

const staffColumns: RankColumn<StaffDeduction>[] = [
  { key: "staffCode", label: "Mã nhân viên", sortText: (r) => r.staffCode, render: (r) => r.staffCode || "—" },
  { key: "fullName", label: "Nhân viên", sortText: (r) => r.fullName, render: (r) => r.fullName || "—" },
  { key: "accounts", label: "Tài khoản không đạt", sortBy: (r) => r.accounts, render: (r) => r.accounts },
  { key: "points", label: "Điểm trừ", sortBy: (r) => r.points, render: (r) => formatPoints(r.points) },
];

const unqualifiedColumns: RankColumn<UnqualifiedRow>[] = [
  { key: "row", label: "Dòng", render: (r) => r.row },
  { key: "fullName", label: "Khách", render: (r) => r.fullName || "—" },
  { key: "idNumber", label: "CCCD", render: (r) => (r.idNumberTail ? `…${r.idNumberTail}` : "—") },
  { key: "staffCode", label: "Mã nhân viên", render: (r) => r.staffCode || "—" },
  { key: "ownerCode", label: "Người lập hồ sơ", render: (r) => r.ownerCode || "—" },
  { key: "accountNumber", label: "STK VPa", render: (r) => r.accountNumber || "—" },
  { key: "status", label: "Kết quả kiểm", render: (r) => <UnqualifiedResult {...r} /> },
];

const casaColumns: RankColumn<CasaPreviewRow>[] = [
  { key: "row", label: "Dòng", render: (r) => r.row },
  { key: "fullName", label: "Khách", render: (r) => r.fullName || "—" },
  { key: "idNumber", label: "CCCD", render: (r) => (r.idNumberTail ? `…${r.idNumberTail}` : "—") },
  { key: "staffCode", label: "Mã nhân viên", render: (r) => r.staffCode || "—" },
  { key: "accountNumber", label: "STK VPa", render: (r) => r.accountNumber || "—" },
  { key: "status", label: "Kết quả kiểm", render: (r) => <CasaProblems {...r} /> },
];

/**
 * Nhập file chốt chỉ tiêu VPBank (sheet "DS T09") vào lương một tháng, chốt
 * 2026-11-15. Một file cho ra hai việc: điểm trừ của người lập hồ sơ có tài
 * khoản VPa không đạt TMDK, và danh sách CASA. Có một dòng lỗi thì không ghi.
 */
export function VpaTargetImportDialog({ open, onClose }: Props) {
  const monthLabelId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const pickFile = () => fileInput.current?.click();
  const [dragging, setDragging] = useState(false);
  const queryClient = useQueryClient();
  // File tháng M về sau khi chốt lương tháng M, nên ghi vào lương tháng trước tháng hiện tại.
  const [month, setMonth] = useState(() => shiftMonth(thisMonth(), -1));
  const salary = useQuery({ queryKey: ["casa-month", month], queryFn: () => fetchCasaMonth(month) });
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [view, setView] = useState<View>("staff");

  const check = useMutation({
    mutationFn: async (): Promise<Checked> => {
      if (!file) throw new Error("Chưa chọn file.");
      const rows = (await readExcelRows(file, VPA_TARGET_FILE_COLUMNS, {
        anySheet: true,
        headerAcrossRows: true,
      })) as VpaTargetFileRow[];
      if (rows.length === 0) throw new Error("File không có dòng dữ liệu nào.");
      if (rows.length > VPA_TARGET_MAX_ROWS)
        throw new Error(`File có ${rows.length} dòng, mỗi lượt nhập tối đa ${VPA_TARGET_MAX_ROWS} dòng.`);
      return { rows, result: await importVpaTargets(month, { rows, commit: false }) };
    },
    onSuccess: (next) => {
      setChecked(next);
      const hasErrors =
        next.result.unqualified.some((r) => r.errors.length > 0) || next.result.casa.some((r) => r.errors.length > 0);
      setView(hasErrors ? "errors" : "staff");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đọc được file này.")),
  });

  const save = useMutation({
    mutationFn: (target: Checked) => importVpaTargets(month, { rows: target.rows, commit: true }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["casa-month", month] });
      // Lương ở P-51/P-52 đọc điểm trừ và số CASA của tháng: ghi xong phải thấy ngay ở đó.
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      queryClient.invalidateQueries({ queryKey: ["person"] });
      toast.ok(
        `Đã trừ điểm ${result.written.staff} nhân viên, ghi ${result.written.casa} tài khoản CASA, bỏ ${result.written.casaRemoved} tài khoản CASA.`,
      );
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không ghi được file này.")),
  });

  const result = checked?.result;
  const unqualified = result?.unqualified ?? [];
  const casa = result?.casa ?? [];
  const staff = result?.staff ?? [];
  const unqualifiedErrors = unqualified.filter((r) => r.errors.length > 0);
  const casaErrors = casa.filter((r) => r.errors.length > 0);
  const errorRows = unqualifiedErrors.length + casaErrors.length;
  const newCasa = casa.filter(isNewCasa).length;
  const casaRemoved = unqualified.filter((r) => r.casaRemovedMonth !== null).length;
  const deductedAccounts = unqualified.filter((r) => r.points !== null).length;
  const totalPoints = staff.reduce((sum, s) => sum + s.points, 0);
  const nothingNew = deductedAccounts === 0 && newCasa === 0 && casaRemoved === 0;
  const warnings = checked ? qualifiedWarnings(checked.rows) : [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!save.isPending}
      full={checked !== null}
      title={
        checked ? `Nhập file chốt chỉ tiêu VPa lương ${monthLabel(month).toLowerCase()}` : "Nhập file chốt chỉ tiêu VPa"
      }
      footerStart={
        checked && (
          <BackButton
            disabled={save.isPending}
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
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Huỷ
          </Button>
          {checked ? (
            <Button disabled={errorRows > 0 || nothingNew || save.isPending} onClick={() => save.mutate(checked)}>
              Ghi
            </Button>
          ) : (
            <Button
              disabled={file === null || !salary.data || salary.data.locked || check.isPending}
              onClick={() => check.mutate()}
            >
              Kiểm tra
            </Button>
          )}
        </>
      }
    >
      {checked && result ? (
        <div className={styles.body}>
          <p className={errorRows > 0 ? styles.error : styles.summary} role="status">
            {errorRows > 0
              ? `File có ${errorRows} dòng lỗi.`
              : `Trừ ${formatPoints(totalPoints)} điểm của ${staff.length} nhân viên. ${newCasa} tài khoản CASA mới.`}
            {casaRemoved > 0 && ` Bỏ CASA ${casaRemoved} tài khoản.`}
          </p>
          {warnings.map((w) => (
            <Alert key={w} tone="warning">
              {w}
            </Alert>
          ))}
          <p className={styles.summary}>Lý do điểm trừ: {result.reason}</p>
          <SegmentedTabs
            label="Lọc dòng"
            value={view}
            onChange={(v) => setView(v as View)}
            options={[
              { value: "staff", label: "Điểm trừ", count: staff.length },
              { value: "unqualified", label: "TMDK không đạt", count: unqualified.length },
              { value: "casa", label: "CASA", count: casa.length },
              ...(errorRows > 0 ? [{ value: "errors", label: "Lỗi", count: errorRows }] : []),
            ]}
          />
          {view === "staff" && (
            <RankTable
              rows={staff}
              columns={staffColumns}
              rowKey={(r) => r.userId}
              defaultSort="points"
              caption="Điểm trừ của từng nhân viên"
              pageSize={PAGE_SIZE}
              emptyText="Không có nhân viên nào bị trừ điểm."
            />
          )}
          {(view === "unqualified" || (view === "errors" && unqualifiedErrors.length > 0)) && (
            <RankTable
              rows={view === "errors" ? unqualifiedErrors : unqualified}
              columns={unqualifiedColumns}
              rowKey={(r) => String(r.row)}
              defaultSort="row"
              caption="Kết quả kiểm từng dòng TMDK không đạt"
              pageSize={PAGE_SIZE}
              emptyText="Không có dòng TMDK không đạt."
            />
          )}
          {(view === "casa" || (view === "errors" && casaErrors.length > 0)) && (
            <RankTable
              rows={view === "errors" ? casaErrors : casa}
              columns={casaColumns}
              rowKey={(r) => String(r.row)}
              defaultSort="row"
              caption="Kết quả kiểm từng dòng CASA"
              pageSize={PAGE_SIZE}
              emptyText="Không có tài khoản CASA."
            />
          )}
        </div>
      ) : (
        <div className={styles.body}>
          <div className={styles.monthRow}>
            <div className={styles.stack}>
              <span id={monthLabelId} className={styles.title}>
                Tháng lương
              </span>
              {salary.data?.locked && (
                <span className={styles.error} role="status">
                  Lương {monthLabel(month).toLowerCase()} đã chốt
                </span>
              )}
            </div>
            <div role="group" aria-labelledby={monthLabelId}>
              <MonthPicker value={month} onChange={setMonth} />
            </div>
          </div>
          {salary.isError && (
            <ErrorState what="tháng lương" onRetry={salary.refetch} retrying={salary.isFetching} />
          )}

          {file ? (
            <div className={styles.fileCard}>
              <span className={styles.fileIcon} aria-hidden>
                <FileSpreadsheet size={20} />
              </span>
              <div className={styles.stack}>
                <span className={styles.fileName}>{file.name}</span>
                <span className={styles.meta}>{fileSize(file.size)}</span>
              </div>
              <Button variant="secondary" onClick={pickFile}>
                Đổi file
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className={dragging ? `${styles.drop} ${styles.dropActive}` : styles.drop}
              onClick={pickFile}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const dropped = e.dataTransfer.files[0];
                if (dropped) setFile(dropped);
              }}
            >
              <span className={styles.fileIcon} aria-hidden>
                <FileSpreadsheet size={22} />
              </span>
              <span className={styles.title}>Chọn file Excel</span>
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) setFile(picked);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </Dialog>
  );
}
