"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Minus, Plus, Users } from "lucide-react";
import { useState } from "react";
import { BlankAdjustDialog } from "@/components/insurance/BlankAdjustDialog";
import { BlankLeft } from "@/components/insurance/BlankLeft";
import styles from "@/components/insurance/InsuranceBlanks.module.scss";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { monthLabel } from "@/components/ui/MonthPicker";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { Select } from "@/components/ui/Select";
import { SkeletonText } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import { fetchBankStaffBlanks, saveBankStaffBlanks, type BankStaffBlanks } from "@/lib/api/bankBlanks";
import { digitsOnly } from "@/lib/numberField";
import { errorMessage, toast } from "@/lib/toast";
import { ROLE_LABEL } from "@/lib/types";

/** Màn Phát phiếu thông tin ngân hàng: Trưởng phòng, Phó phòng nhập số đã phát và đã sử dụng của từng người. */
export function BankBlankSplitSection({ month }: { month: string }) {
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["bank-blanks", "staff", month, departmentId],
    queryFn: () => fetchBankStaffBlanks(month, departmentId),
    placeholderData: keepPreviousData,
  });
  if (query.isPending) return <SkeletonText lines={4} label="Đang tải phiếu của nhân viên" />;
  if (query.isError)
    return <ErrorState what="phiếu của nhân viên" onRetry={query.refetch} retrying={query.isFetching} />;
  return (
    <SplitForm
      key={`${query.data.month}-${query.data.departmentId}-${query.dataUpdatedAt}`}
      data={query.data}
      onDepartmentChange={setDepartmentId}
    />
  );
}

const keyOf = (userId: string, bankId: string) => `${userId}:${bankId}`;

function SplitForm({ data, onDepartmentChange }: { data: BankStaffBlanks; onDepartmentChange: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [bankId, setBankId] = useState(data.types[0]?.id ?? "");
  const cells = data.rows.flatMap((r) => r.cells.map((c) => ({ userId: r.userId, ...c })));
  const initialIssued = Object.fromEntries(
    cells.map((c) => [keyOf(c.userId, c.blankTypeId), c.issued ? String(c.issued) : ""]),
  );
  const initialUsed = Object.fromEntries(
    cells.map((c) => [keyOf(c.userId, c.blankTypeId), c.used === null ? "" : String(c.used)]),
  );
  const [issued, setIssued] = useState<Record<string, string>>(initialIssued);
  const [used, setUsed] = useState<Record<string, string>>(initialUsed);
  const [adjusting, setAdjusting] = useState<{ key: string; fullName: string; sign: 1 | -1; max?: number } | null>(
    null,
  );

  const issuedOf = (key: string) => Number(issued[key] || 0);
  const usedInput = (key: string) => (used[key] ?? "") === "" ? null : Number(used[key]);
  const form = {
    rows: cells.map((c) => {
      const key = keyOf(c.userId, c.blankTypeId);
      return { userId: c.userId, blankTypeId: c.blankTypeId, issued: issuedOf(key), used: usedInput(key) };
    }),
  };
  const changed = cells.some((c) => {
    const key = keyOf(c.userId, c.blankTypeId);
    return issued[key] !== initialIssued[key] || used[key] !== initialUsed[key];
  });

  const save = useMutation({
    mutationFn: () => saveBankStaffBlanks(data.month, data.departmentId, form),
    onSuccess: (next) => {
      queryClient.setQueryData(["bank-blanks", "staff", data.month, data.departmentId], next);
      queryClient.invalidateQueries({ queryKey: ["bank-blanks"] });
      toast.ok(`Đã lưu phiếu ${monthLabel(data.month).toLowerCase()}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được phiếu.")),
  });

  const locked = !data.editable;
  const departmentName = data.departments.find((d) => d.id === data.departmentId)?.name ?? "";
  const issuedTotal = (id: string) => data.rows.reduce((s, r) => s + issuedOf(keyOf(r.userId, id)), 0);
  const leftOf = (id: string) => {
    const cell = data.departmentCells.find((c) => c.blankTypeId === id)!;
    return cell.openingUnallocated + cell.allocated - issuedTotal(id);
  };
  const overIssued = data.types.some((t) => leftOf(t.id) < 0);
  const hasBlanks = data.types.length > 0;
  const left = hasBlanks ? leftOf(bankId) : 0;
  const bankCode = data.types.find((t) => t.id === bankId)?.code ?? "";
  const rows = hasBlanks
    ? data.rows.map((r) => {
        const cell = r.cells.find((c) => c.blankTypeId === bankId)!;
        const key = keyOf(r.userId, bankId);
        const usedNow = usedInput(key) ?? cell.usedAccounts;
        return { ...r, cell, key, closing: cell.opening + issuedOf(key) - usedNow };
      })
    : [];

  return (
    <>
      <SectionCard
        title={`Phiếu của ${departmentName}`}
        icon={<Layers size={17} />}
        action={locked ? <StatusTag tone="neutral">Chỉ xem</StatusTag> : undefined}
      >
        {data.departments.length > 1 && (
          <div className={styles.toolbar}>
            <Select
              label="Phòng"
              value={data.departmentId}
              options={data.departments.map((d) => ({ value: d.id, label: d.name }))}
              onChange={onDepartmentChange}
            />
          </div>
        )}
        {hasBlanks ? (
          <div className={styles.scroll}>
            <table className={`table ${styles.table}`}>
              <thead>
                <tr>
                  <th scope="col">Ngân hàng</th>
                  <th scope="col">Tồn tháng trước</th>
                  <th scope="col">Cấp trong tháng</th>
                  <th scope="col">Đã phát</th>
                  <th scope="col">Còn tại phòng</th>
                </tr>
              </thead>
              <tbody>
                {data.types.map((t) => {
                  const cell = data.departmentCells.find((c) => c.blankTypeId === t.id)!;
                  const issuedNow = issuedTotal(t.id);
                  return (
                    <tr key={t.id}>
                      <th scope="row">{t.code}</th>
                      <td className={styles.number}>{cell.openingUnallocated}</td>
                      <td className={styles.number}>{cell.allocated}</td>
                      <td className={styles.number}>{issuedNow}</td>
                      <td className={styles.number}>
                        <BlankLeft value={cell.openingUnallocated + cell.allocated - issuedNow} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">Phòng chưa có phiếu nào trong {monthLabel(data.month).toLowerCase()}.</p>
        )}
      </SectionCard>

      {hasBlanks && (
        <SectionCard title="Phiếu của từng người" icon={<Users size={17} />}>
          <SegmentedTabs
            label="Ngân hàng"
            value={bankId}
            onChange={setBankId}
            options={data.types.map((t) => ({ value: t.id, label: t.code }))}
          />
          <p className={left < 0 ? styles.danger : styles.mixLine} aria-live="polite">
            {left < 0 ? `⚠ Phát vượt ${-left} phiếu so với số phòng có` : `Còn tại phòng: ${left}`}
          </p>
          <div className={styles.scroll}>
            <table className={`table ${styles.table}`}>
              <thead>
                <tr>
                  <th scope="col">Người</th>
                  <th scope="col">Tồn tháng trước</th>
                  <th scope="col">Đã phát</th>
                  <th scope="col">Đã sử dụng</th>
                  <th scope="col">Tài khoản đã mở</th>
                  <th scope="col">Còn lại</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId}>
                    <th scope="row">
                      {r.fullName}
                      <span className={`${styles.role} text-muted`}>{ROLE_LABEL[r.role]}</span>
                    </th>
                    <td className={styles.number}>{r.cell.opening}</td>
                    <td>
                      <div className={styles.cellAdjust}>
                        {!locked && (
                          <Button
                            variant="secondary"
                            icon
                            aria-label={`${r.fullName}: trừ phiếu đã phát`}
                            disabled={issuedOf(r.key) === 0}
                            onClick={() =>
                              setAdjusting({ key: r.key, fullName: r.fullName, sign: -1, max: issuedOf(r.key) })
                            }
                          >
                            <Minus size={16} aria-hidden />
                          </Button>
                        )}
                        <input
                          className={`input ${styles.cellInput}`}
                          inputMode="numeric"
                          aria-label={`${r.fullName}: số phiếu đã phát`}
                          value={issued[r.key] ?? ""}
                          disabled={locked}
                          onChange={(e) =>
                            setIssued((prev) => ({ ...prev, [r.key]: digitsOnly(e.target.value).slice(0, 9) }))
                          }
                        />
                        {!locked && (
                          <Button
                            variant="secondary"
                            icon
                            aria-label={`${r.fullName}: phát thêm phiếu`}
                            disabled={left <= 0}
                            onClick={() => setAdjusting({ key: r.key, fullName: r.fullName, sign: 1, max: left })}
                          >
                            <Plus size={16} aria-hidden />
                          </Button>
                        )}
                      </div>
                    </td>
                    <td>
                      <input
                        className={`input ${styles.cellInput}`}
                        inputMode="numeric"
                        aria-label={`${r.fullName}: số phiếu đã sử dụng, để trống thì dùng số tài khoản đã mở`}
                        placeholder={String(r.cell.usedAccounts)}
                        value={used[r.key] ?? ""}
                        disabled={locked}
                        onChange={(e) =>
                          setUsed((prev) => ({ ...prev, [r.key]: digitsOnly(e.target.value).slice(0, 9) }))
                        }
                      />
                    </td>
                    <td className={styles.number}>{r.cell.usedAccounts}</td>
                    <td className={styles.number}>{r.closing}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-muted">
                      Phòng chưa có ai trong {monthLabel(data.month).toLowerCase()}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {!locked && hasBlanks && (
        <div className={styles.saveBar}>
          <Button disabled={!changed || overIssued || save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </div>
      )}

      {adjusting && (
        <BlankAdjustDialog
          title={`${adjusting.sign > 0 ? "Phát thêm phiếu" : "Trừ phiếu đã phát"} - ${adjusting.fullName}`}
          label={`Số phiếu ${bankCode} ${adjusting.sign > 0 ? "phát thêm" : "trừ ra"}`}
          submitLabel={adjusting.sign > 0 ? "Cộng thêm" : "Trừ ra"}
          max={adjusting.max}
          unit="phiếu"
          onSubmit={(quantity) =>
            setIssued((prev) => {
              const next = Number(prev[adjusting.key] || 0) + adjusting.sign * quantity;
              return { ...prev, [adjusting.key]: next ? String(next) : "" };
            })
          }
          onClose={() => setAdjusting(null)}
        />
      )}
    </>
  );
}
