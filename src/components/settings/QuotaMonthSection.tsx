"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Landmark, Target } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { monthLabel } from "@/components/ui/MonthPicker";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonText } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import { TextField } from "@/components/ui/TextField";
import { ACCOUNT_TYPE_LABEL, AccountType } from "@/lib/api/bankAccounts";
import { fetchBanks, type Bank } from "@/lib/api/bankCatalog";
import {
  fetchQuotaMonth,
  saveQuotaMonth,
  type QuotaKindItem,
  type QuotaMonth,
} from "@/lib/api/quota";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./QuotaMonthSection.module.scss";

/**
 * Màn Chỉ tiêu tháng theo QĐ 145: số chỉ tiêu và danh sách tài khoản tính vào HKD, định hướng.
 *
 * TODO(lương CĐS, file mẫu CASA của Yên): ô CASA lưu được nhưng lương chưa dùng,
 * vì chưa có màn nhập danh sách CASA. Gỡ khi `server/salary.ts` đếm CASA.
 */
export function QuotaMonthSection({ month }: { month: string }) {
  const quota = useQuery({ queryKey: ["quota-month", month], queryFn: () => fetchQuotaMonth(month) });
  const banks = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });

  return (
    <>
      {(quota.isPending || banks.isPending) && <SkeletonText lines={4} label="Đang tải chỉ tiêu" />}
      {quota.isError && (
        <ErrorState what="chỉ tiêu tháng" onRetry={quota.refetch} retrying={quota.isFetching} />
      )}
      {banks.isError && (
        <ErrorState what="danh sách ngân hàng" onRetry={banks.refetch} retrying={banks.isFetching} />
      )}
      {quota.data && banks.data && (
        // `key` theo tháng và lần tải: đổi tháng hay lưu xong thì form lấy lại số
        // từ máy chủ, không giữ số đang gõ của tháng khác (AGENTS.md §7).
        <QuotaForm key={`${month}-${quota.dataUpdatedAt}`} data={quota.data} banks={banks.data} />
      )}
    </>
  );
}

type NumberText = string;

const toText = (value: number | null): NumberText => (value === null ? "" : String(value));
const toNumber = (text: NumberText): number | null => (text.trim() === "" ? null : Number(text));
const onlyDigits = (text: string): NumberText => text.replace(/\D/g, "").slice(0, 9);
const kindKey = (k: QuotaKindItem) => `${k.bankId}:${k.accountType}`;

function QuotaForm({ data, banks }: { data: QuotaMonth; banks: Bank[] }) {
  const queryClient = useQueryClient();
  const [staff, setStaff] = useState({
    hkd: toText(data.staffHkd),
    directed: toText(data.staffDirected),
    casa: toText(data.staffCasa),
  });
  const [rows, setRows] = useState(
    data.departments.map((d) => ({
      departmentId: d.departmentId,
      departmentName: d.departmentName,
      hkd: toText(d.hkd),
      directed: toText(d.directed),
      casa: toText(d.casa),
    })),
  );
  const [hkdKinds, setHkdKinds] = useState(new Set(data.hkdKinds.map(kindKey)));
  const [directedKinds, setDirectedKinds] = useState(new Set(data.directedKinds.map(kindKey)));

  const [confirming, setConfirming] = useState(false);
  const form = {
    staffHkd: toNumber(staff.hkd),
    staffDirected: toNumber(staff.directed),
    staffCasa: toNumber(staff.casa),
    departments: rows.map((r) => ({
      departmentId: r.departmentId,
      hkd: toNumber(r.hkd),
      directed: toNumber(r.directed),
      casa: toNumber(r.casa),
    })),
    hkdKinds: [...hkdKinds].sort().map(fromKey),
    directedKinds: [...directedKinds].sort().map(fromKey),
  };
  // Bản chép từ tháng trước chưa phải bản của tháng này, nên lưu y nguyên vẫn là một thay đổi.
  const changed = data.copiedFrom !== null || JSON.stringify(form) !== JSON.stringify(formOf(data));

  const save = useMutation({
    mutationFn: () => saveQuotaMonth(data.month, form),
    onSuccess: (next) => {
      setConfirming(false);
      queryClient.setQueryData(["quota-month", data.month], next);
      toast.ok(`Đã lưu chỉ tiêu ${monthLabel(data.month).toLowerCase()}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được chỉ tiêu tháng.")),
  });

  const locked = data.locked;
  const setRow = (departmentId: string, field: "hkd" | "directed" | "casa", text: string) =>
    setRows((prev) =>
      prev.map((r) => (r.departmentId === departmentId ? { ...r, [field]: onlyDigits(text) } : r)),
    );

  return (
    <>
      {data.copiedFrom && (
        <Alert tone="warning">
          {monthLabel(data.month)} chưa lưu chỉ tiêu riêng, lương đang dùng chỉ tiêu của{" "}
          {monthLabel(data.copiedFrom).toLowerCase()}.
        </Alert>
      )}

      <SectionCard
        title="Chỉ tiêu mỗi nhân viên HĐLĐ"
        icon={<Target size={17} />}
        action={locked ? <StatusTag tone="neutral">Đã chốt lương</StatusTag> : undefined}
      >
        <div className={styles.staffRow}>
          <TextField
            label="HKD"
            inputMode="numeric"
            value={staff.hkd}
            disabled={locked}
            onChange={(e) => setStaff((s) => ({ ...s, hkd: onlyDigits(e.target.value) }))}
          />
          <TextField
            label="Tài khoản định hướng"
            inputMode="numeric"
            value={staff.directed}
            disabled={locked}
            onChange={(e) => setStaff((s) => ({ ...s, directed: onlyDigits(e.target.value) }))}
          />
          <TextField
            label="CASA"
            inputMode="numeric"
            value={staff.casa}
            disabled={locked}
            onChange={(e) => setStaff((s) => ({ ...s, casa: onlyDigits(e.target.value) }))}
          />
        </div>
      </SectionCard>

      <SectionCard title="Chỉ tiêu phòng" icon={<Building2 size={17} />}>
        <div className={styles.scroll}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Phòng</th>
                <th scope="col">HKD</th>
                <th scope="col">Tài khoản định hướng</th>
                <th scope="col">CASA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.departmentId}>
                  <th scope="row">{r.departmentName}</th>
                  {(["hkd", "directed", "casa"] as const).map((field) => (
                    <td key={field}>
                      <input
                        className={`input ${styles.cellInput}`}
                        inputMode="numeric"
                        aria-label={`${r.departmentName}: ${FIELD_LABEL[field]}`}
                        value={r[field]}
                        disabled={locked}
                        onChange={(e) => setRow(r.departmentId, field, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <KindGrid
        title="Tài khoản định hướng"
        banks={banks}
        selected={directedKinds}
        onChange={setDirectedKinds}
        disabled={locked}
      />
      <KindGrid title="HKD" banks={banks} selected={hkdKinds} onChange={setHkdKinds} disabled={locked} />

      {/* Dính đáy khung cuộn: màn dài bốn khối, lưu ở cuối trang thì phải kéo qua hai bảng. */}
      <div className={styles.saveBar}>
        <Button disabled={locked || !changed || save.isPending} onClick={() => setConfirming(true)}>
          Lưu chỉ tiêu
        </Button>
      </div>

      {confirming && (
        <ConfirmDialog
          open
          title={`Lưu chỉ tiêu ${monthLabel(data.month).toLowerCase()}?`}
          consequence="Điểm tính lương và lương tạm tính của nhân viên HĐLĐ, Trưởng phòng, Phó phòng, Phó giám đốc thay đổi theo chỉ tiêu mới. Các tháng sau chưa lưu chỉ tiêu riêng cũng dùng số này."
          confirmLabel="Lưu"
          pending={save.isPending}
          onConfirm={() => save.mutate()}
          onClose={() => setConfirming(false)}
        >
          Chỉ tiêu và danh sách tài khoản của {monthLabel(data.month).toLowerCase()}.
        </ConfirmDialog>
      )}
    </>
  );
}

const FIELD_LABEL = { hkd: "HKD", directed: "Tài khoản định hướng", casa: "CASA" } as const;

/** Dạng gửi lên máy chủ của số đã tải, để so với số đang gõ. */
const formOf = (data: QuotaMonth) => ({
  staffHkd: data.staffHkd,
  staffDirected: data.staffDirected,
  staffCasa: data.staffCasa,
  departments: data.departments.map((d) => ({
    departmentId: d.departmentId,
    hkd: d.hkd,
    directed: d.directed,
    casa: d.casa,
  })),
  hkdKinds: data.hkdKinds.map(kindKey).sort().map(fromKey),
  directedKinds: data.directedKinds.map(kindKey).sort().map(fromKey),
});

const fromKey = (key: string): QuotaKindItem => {
  const [bankId, accountType] = key.split(":");
  return { bankId, accountType: AccountType.parse(accountType) };
};

function KindGrid({
  title,
  banks,
  selected,
  onChange,
  disabled,
}: {
  title: string;
  banks: Bank[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled: boolean;
}) {
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  return (
    <SectionCard title={title} icon={<Landmark size={17} />}>
      <div className={styles.scroll}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Ngân hàng</th>
              {AccountType.options.map((type) => (
                <th key={type} scope="col">
                  {ACCOUNT_TYPE_LABEL[type]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {banks
              .filter((b) => b.code)
              .map((b) => (
                <tr key={b.id}>
                  <th scope="row">{b.code}</th>
                  {AccountType.options.map((type) => {
                    const key = kindKey({ bankId: b.id, accountType: type });
                    return (
                      <td key={type}>
                        <input
                          type="checkbox"
                          className={styles.check}
                          aria-label={`${title}: ${b.code} ${ACCOUNT_TYPE_LABEL[type]}`}
                          checked={selected.has(key)}
                          disabled={disabled}
                          onChange={() => toggle(key)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
