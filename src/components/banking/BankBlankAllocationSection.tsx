"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { BlankAdjustDialog } from "@/components/insurance/BlankAdjustDialog";
import { BlankLeft } from "@/components/insurance/BlankLeft";
import styles from "@/components/insurance/InsuranceBlanks.module.scss";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { monthLabel } from "@/components/ui/MonthPicker";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { SkeletonText } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  fetchBankDepartmentBlanks,
  saveBankDepartmentBlanks,
  type BankDepartmentBlanks,
} from "@/lib/api/bankBlanks";
import { digitsOnly } from "@/lib/numberField";
import { errorMessage, toast } from "@/lib/toast";

/** Màn Cấp phiếu thông tin ngân hàng: văn phòng cấp thêm phiếu của từng ngân hàng cho từng phòng. */
export function BankBlankAllocationSection({ month }: { month: string }) {
  const query = useQuery({
    queryKey: ["bank-blanks", "departments", month],
    queryFn: () => fetchBankDepartmentBlanks(month),
  });
  if (query.isPending) return <SkeletonText lines={4} label="Đang tải phiếu của các phòng" />;
  if (query.isError)
    return <ErrorState what="phiếu của các phòng" onRetry={query.refetch} retrying={query.isFetching} />;
  return <AllocationForm key={`${month}-${query.dataUpdatedAt}`} data={query.data} />;
}

const keyOf = (departmentId: string, bankId: string) => `${departmentId}:${bankId}`;
const toText = (n: number | undefined) => (n ? String(n) : "");

function AllocationForm({ data }: { data: BankDepartmentBlanks }) {
  const queryClient = useQueryClient();
  const [bankId, setBankId] = useState(data.types[0]?.id ?? "");
  const initial = Object.fromEntries(
    data.rows.flatMap((r) => r.cells.map((c) => [keyOf(r.departmentId, c.blankTypeId), toText(c.allocated)])),
  );
  const [quantities, setQuantities] = useState<Record<string, string>>(initial);
  const quantityOf = (key: string) => Number(quantities[key] || 0);
  const [adjusting, setAdjusting] = useState<{
    key: string;
    departmentName: string;
    sign: 1 | -1;
    max?: number;
  } | null>(null);

  const form = {
    rows: data.rows.flatMap((r) =>
      r.cells.map((c) => ({
        departmentId: r.departmentId,
        blankTypeId: c.blankTypeId,
        quantity: quantityOf(keyOf(r.departmentId, c.blankTypeId)),
      })),
    ),
  };
  const changed = Object.keys(initial).some((key) => quantityOf(key) !== Number(initial[key] || 0));

  const save = useMutation({
    mutationFn: () => saveBankDepartmentBlanks(data.month, form),
    onSuccess: (next) => {
      queryClient.setQueryData(["bank-blanks", "departments", data.month], next);
      queryClient.invalidateQueries({ queryKey: ["bank-blanks", "staff"] });
      toast.ok(`Đã lưu phiếu ${monthLabel(data.month).toLowerCase()}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được phiếu.")),
  });

  const locked = !data.editable;
  const rows = data.rows.map((r) => {
    const cell = r.cells.find((c) => c.blankTypeId === bankId)!;
    const key = keyOf(r.departmentId, bankId);
    const allocated = quantityOf(key);
    const closing = cell.openingUnallocated + allocated - cell.issued;
    return { ...r, cell, key, allocated, closing, removable: Math.max(0, Math.min(allocated, closing)) };
  });
  const sum = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const belowIssued = data.rows.some((r) =>
    r.cells.some((c) => c.openingUnallocated + quantityOf(keyOf(r.departmentId, c.blankTypeId)) - c.issued < 0),
  );
  const bankCode = data.types.find((t) => t.id === bankId)?.code ?? "";

  return (
    <>
      <SectionCard
        title="Cấp phiếu cho phòng"
        icon={<Building2 size={17} />}
        action={locked ? <StatusTag tone="neutral">Chỉ xem</StatusTag> : undefined}
      >
        <SegmentedTabs
          label="Ngân hàng"
          value={bankId}
          onChange={setBankId}
          options={data.types.map((t) => ({ value: t.id, label: t.code }))}
        />
        <div className={styles.scroll}>
          <table className={`table ${styles.table}`}>
            <thead>
              <tr>
                <th scope="col">Phòng</th>
                <th scope="col">Tồn tháng trước</th>
                <th scope="col">Cấp trong tháng</th>
                <th scope="col">Đã phát</th>
                <th scope="col">Còn tại phòng</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.departmentId}>
                  <th scope="row">{r.departmentName}</th>
                  <td className={styles.number}>{r.cell.openingUnallocated}</td>
                  <td>
                    <div className={styles.cellAdjust}>
                      {!locked && (
                        <Button
                          variant="secondary"
                          icon
                          aria-label={`${r.departmentName}: trừ phiếu đã cấp`}
                          disabled={r.removable === 0}
                          onClick={() =>
                            setAdjusting({ key: r.key, departmentName: r.departmentName, sign: -1, max: r.removable })
                          }
                        >
                          <Minus size={16} aria-hidden />
                        </Button>
                      )}
                      <input
                        className={`input ${styles.cellInput}`}
                        inputMode="numeric"
                        aria-label={`${r.departmentName}: số phiếu cấp`}
                        value={quantities[r.key] ?? ""}
                        disabled={locked}
                        onChange={(e) =>
                          setQuantities((prev) => ({ ...prev, [r.key]: digitsOnly(e.target.value).slice(0, 9) }))
                        }
                      />
                      {!locked && (
                        <Button
                          variant="secondary"
                          icon
                          aria-label={`${r.departmentName}: cấp thêm phiếu`}
                          onClick={() => setAdjusting({ key: r.key, departmentName: r.departmentName, sign: 1 })}
                        >
                          <Plus size={16} aria-hidden />
                        </Button>
                      )}
                    </div>
                  </td>
                  <td className={styles.number}>{r.cell.issued}</td>
                  <td className={styles.number}>
                    <BlankLeft value={r.closing} />
                  </td>
                </tr>
              ))}
              <tr className={styles.total}>
                <th scope="row">Tổng</th>
                <td className={styles.number}>{sum((r) => r.cell.openingUnallocated)}</td>
                <td className={styles.number}>{sum((r) => r.allocated)}</td>
                <td className={styles.number}>{sum((r) => r.cell.issued)}</td>
                <td className={styles.number}>{sum((r) => r.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      {!locked && (
        <div className={styles.saveBar}>
          <Button disabled={!changed || belowIssued || save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </div>
      )}

      {adjusting && (
        <BlankAdjustDialog
          title={`${adjusting.sign > 0 ? "Cấp thêm phiếu" : "Trừ phiếu đã cấp"} - ${adjusting.departmentName}`}
          label={`Số phiếu ${bankCode} ${adjusting.sign > 0 ? "cấp thêm" : "trừ ra"}`}
          submitLabel={adjusting.sign > 0 ? "Cộng thêm" : "Trừ ra"}
          max={adjusting.max}
          unit="phiếu"
          onSubmit={(quantity) =>
            setQuantities((prev) => ({
              ...prev,
              [adjusting.key]: toText(Number(prev[adjusting.key] || 0) + adjusting.sign * quantity),
            }))
          }
          onClose={() => setAdjusting(null)}
        />
      )}
    </>
  );
}
