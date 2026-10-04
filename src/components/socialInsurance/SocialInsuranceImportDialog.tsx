"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { useId, useRef, useState } from "react";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog } from "@/components/ui/Dialog";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { Select } from "@/components/ui/Select";
import {
  IMPORT_MAX_ROWS,
  importReconciliation,
  importRecords,
  KIND_LABEL,
  PLAN_LABEL,
  RECONCILE_FILE_COLUMNS,
  RECORD_FILE_COLUMNS,
  SocialInsuranceKind,
  type ReconcileFileRow,
  type ReconcilePreviewRow,
  type RecordFileRow,
  type RecordPreviewRow,
} from "@/lib/api/socialInsurance";
import { fetchProvinces } from "@/lib/api/wardCatalog";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { formatCents, formatRate } from "@/lib/money";
import { readExcelRows } from "@/lib/readExcelRows";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./SocialInsuranceImportDialog.module.scss";

export type ImportMode = "records" | "reconcile";

type Props = {
  open: boolean;
  mode: ImportMode;
  onClose: () => void;
};

const TITLE: Record<ImportMode, string> = {
  records: "Nhập file hồ sơ",
  reconcile: "Nhập file đối chiếu",
};

type Checked =
  | {
      mode: "records";
      kind: SocialInsuranceKind;
      provinceId: string;
      rows: RecordFileRow[];
      preview: RecordPreviewRow[];
    }
  | { mode: "reconcile"; kind: SocialInsuranceKind; rows: ReconcileFileRow[]; preview: ReconcilePreviewRow[] };

const PAGE_SIZE = 10;

const money = (cents: number | null) => (cents === null ? "—" : formatCents(cents));
const monthText = (month: string) => (month ? `${month.slice(5)}/${month.slice(0, 4)}` : "—");

function Problems({ errors, differences = [] }: { errors: string[]; differences?: string[] }) {
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

const recordColumns: RankColumn<RecordPreviewRow>[] = [
  { key: "row", label: "Dòng", render: (r) => r.row },
  { key: "receiptMonth", label: "Tháng biên lai", render: (r) => monthText(r.receiptMonth) },
  { key: "fullName", label: "Họ tên", render: (r) => r.fullName || "—" },
  { key: "idNumber", label: "CCCD", render: (r) => (r.idNumberTail ? `…${r.idNumberTail}` : "—") },
  {
    key: "customer",
    label: "Khách",
    render: (r) => (r.customer === "existing" ? "Có sẵn" : r.customer === "new" ? "Tạo mới" : "—"),
  },
  { key: "wardName", label: "Xã", render: (r) => r.wardName || "—" },
  { key: "plan", label: "Phương án", render: (r) => (r.plan ? PLAN_LABEL[r.plan] : "—") },
  { key: "months", label: "Số tháng", render: (r) => r.months ?? "—" },
  { key: "collected", label: "Thu", render: (r) => money(r.collectedCents) },
  { key: "paid", label: "Chi", render: (r) => money(r.paidCents) },
  { key: "staffName", label: "Nhân viên ATM", render: (r) => r.staffName || "—" },
  { key: "status", label: "Kết quả kiểm", render: (r) => <Problems errors={r.errors} /> },
];

/** Dòng lỗi lên đầu, giữ thứ tự dòng trong từng nhóm: file 3.000 dòng có 2 dòng lỗi thì thấy ngay. */
const errorsFirst = <T extends { errors: string[] }>(rows: T[]) =>
  [...rows].sort((a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0));

const reconcileColumns: RankColumn<ReconcilePreviewRow>[] = [
  { key: "row", label: "Dòng", render: (r) => r.row },
  { key: "receiptMonth", label: "Tháng biên lai", render: (r) => monthText(r.receiptMonth) },
  { key: "fullName", label: "Họ tên", render: (r) => r.fullName || "—" },
  { key: "identity", label: "CCCD/BHXH", render: (r) => r.identity || "—" },
  { key: "plan", label: "Phương án", render: (r) => (r.plan ? PLAN_LABEL[r.plan] : "—") },
  { key: "months", label: "Số tháng", render: (r) => r.months ?? "—" },
  { key: "collected", label: "Thu", render: (r) => money(r.collectedCents) },
  { key: "received", label: "Nhận", render: (r) => money(r.receivedCents) },
  { key: "rate", label: "% nhận", render: (r) => (r.receivedRate === null ? "—" : formatRate(r.receivedRate)) },
  {
    key: "status",
    label: "Kết quả kiểm",
    render: (r) => <Problems errors={r.errors} differences={r.differences} />,
  },
];

/**
 * Nhập file 1 hoặc file 2 của trang BHYT/BHXH. Bước 1 chọn loại, tỉnh (file 1) và file;
 * bước 2 là bảng máy chủ kiểm từng dòng. Có một dòng lỗi thì không ghi được
 * (chốt 2026-10-04): người dùng sửa file rồi tải lại.
 */
export function SocialInsuranceImportDialog({ open, mode, onClose }: Props) {
  const fileLabelId = useId();
  const fileNameId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<SocialInsuranceKind>("bhyt");
  const [provinceId, setProvinceId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);

  const check = useMutation({
    mutationFn: async (): Promise<Checked> => {
      if (!file) throw new Error("Chưa chọn file.");
      if (mode === "records") {
        const rows = (await readExcelRows(file, RECORD_FILE_COLUMNS)) as RecordFileRow[];
        if (rows.length === 0) throw new Error("File không có dòng dữ liệu nào.");
        if (rows.length > IMPORT_MAX_ROWS)
          throw new Error(`File có ${rows.length} dòng, mỗi lượt nhập tối đa ${IMPORT_MAX_ROWS} dòng.`);
        const result = await importRecords({ kind, provinceId, rows, commit: false });
        return { mode, kind, provinceId, rows, preview: result.rows };
      }
      const rows = (await readExcelRows(file, RECONCILE_FILE_COLUMNS)) as ReconcileFileRow[];
      if (rows.length === 0) throw new Error("File không có dòng dữ liệu nào.");
      if (rows.length > IMPORT_MAX_ROWS)
        throw new Error(`File có ${rows.length} dòng, mỗi lượt nhập tối đa ${IMPORT_MAX_ROWS} dòng.`);
      const result = await importReconciliation({ kind, rows, commit: false });
      return { mode, kind, rows, preview: result.rows };
    },
    onSuccess: setChecked,
    onError: (e) => toast.fail(errorMessage(e, "Không đọc được file này.")),
  });

  const save = useMutation({
    mutationFn: async (target: Checked) =>
      target.mode === "records"
        ? importRecords({ kind: target.kind, provinceId: target.provinceId, rows: target.rows, commit: true })
        : importReconciliation({ kind: target.kind, rows: target.rows, commit: true }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["social-insurance"] });
      queryClient.invalidateQueries({ queryKey: ["services"] });
      invalidateKpi(queryClient);
      toast.ok(`Đã ghi ${result.written} dòng.`);
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không ghi được file này.")),
  });

  const { data: provinces = [] } = useQuery({
    queryKey: ["provinces"],
    queryFn: fetchProvinces,
    enabled: open && mode === "records",
  });
  const ready = file !== null && (mode === "reconcile" || provinceId !== "");

  const errorRows = checked?.preview.filter((r) => r.errors.length > 0).length ?? 0;
  const differenceRows =
    checked?.mode === "reconcile" ? checked.preview.filter((r) => r.differences.length > 0).length : 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      full={checked !== null}
      title={checked ? `${TITLE[mode]} ${KIND_LABEL[checked.kind]}` : TITLE[mode]}
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
              disabled={errorRows > 0 || save.isPending}
              onClick={() => save.mutate(checked)}
            >
              Ghi {checked.preview.length} dòng
            </Button>
          ) : (
            <Button disabled={!ready || check.isPending} onClick={() => check.mutate()}>
              Kiểm tra
            </Button>
          )}
        </>
      }
    >
      {checked ? (
        <div className={styles.body}>
          <p className={errorRows > 0 ? styles.error : styles.summary} role="status">
            {errorRows > 0
              ? `File có ${errorRows} dòng lỗi.`
              : `${checked.preview.length} dòng hợp lệ.`}
            {differenceRows > 0 && ` ${differenceRows} dòng lệch file hồ sơ.`}
          </p>
          {checked.mode === "records" ? (
            <RankTable
              rows={errorsFirst(checked.preview)}
              columns={recordColumns}
              rowKey={(r) => String(r.row)}
              defaultSort="row"
              caption="Kết quả kiểm từng dòng của file hồ sơ"
              pageSize={PAGE_SIZE}
            />
          ) : (
            <RankTable
              rows={errorsFirst(checked.preview)}
              columns={reconcileColumns}
              rowKey={(r) => String(r.row)}
              defaultSort="row"
              caption="Kết quả kiểm từng dòng của file đối chiếu"
              pageSize={PAGE_SIZE}
            />
          )}
        </div>
      ) : (
        <div className={styles.body}>
          <Select
            block
            label="Loại"
            value={kind}
            onChange={(v) => setKind(SocialInsuranceKind.parse(v))}
            options={SocialInsuranceKind.options.map((v) => ({ value: v, label: KIND_LABEL[v] }))}
          />
          {mode === "records" && (
            <Combobox
              block
              label="Tỉnh/thành phố"
              placeholder="Gõ để tìm tỉnh/thành phố…"
              value={provinceId}
              onChange={setProvinceId}
              options={provinces.map((p) => ({ value: p.id, label: p.name }))}
            />
          )}
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
