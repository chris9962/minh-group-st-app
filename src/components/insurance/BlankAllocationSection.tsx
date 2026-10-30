"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Minus, Plus, Target } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { monthLabel } from "@/components/ui/MonthPicker";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { SkeletonText } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import { TextField } from "@/components/ui/TextField";
import {
  fetchDepartmentBlanks,
  saveDepartmentBlanks,
  type DepartmentBlanks,
} from "@/lib/api/insuranceBlanks";
import { digitsOnly } from "@/lib/numberField";
import { errorMessage, toast } from "@/lib/toast";
import { BlankAdjustDialog } from "./BlankAdjustDialog";
import { BlankLeft } from "./BlankLeft";
import { BlankMix } from "./BlankMix";
import styles from "./InsuranceBlanks.module.scss";

/** Màn Cấp phôi bảo hiểm: văn phòng cấp thêm phôi cho từng phòng và đặt mục tiêu điện/xe. */
export function BlankAllocationSection({ month }: { month: string }) {
  const query = useQuery({
    queryKey: ["insurance-blanks", "departments", month],
    queryFn: () => fetchDepartmentBlanks(month),
  });
  if (query.isPending) return <SkeletonText lines={4} label="Đang tải phôi của các phòng" />;
  if (query.isError)
    return <ErrorState what="phôi của các phòng" onRetry={query.refetch} retrying={query.isFetching} />;
  // `key` theo tháng và lần tải: lưu xong hay đổi tháng thì form lấy lại số từ máy chủ (AGENTS.md §7).
  return <AllocationForm key={`${month}-${query.dataUpdatedAt}`} data={query.data} />;
}

const keyOf = (departmentId: string, blankTypeId: string) => `${departmentId}:${blankTypeId}`;
const toText = (n: number | undefined) => (n ? String(n) : "");

function AllocationForm({ data }: { data: DepartmentBlanks }) {
  const queryClient = useQueryClient();
  const [typeId, setTypeId] = useState(data.types[0]?.id ?? "");
  const [electric, setElectric] = useState(toText(data.target?.electricParts));
  const [motorbike, setMotorbike] = useState(toText(data.target?.motorbikeParts));
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
    target: { electricParts: Number(electric || 0), motorbikeParts: Number(motorbike || 0) },
    rows: data.rows.flatMap((r) =>
      r.cells.map((c) => ({
        departmentId: r.departmentId,
        blankTypeId: c.blankTypeId,
        quantity: quantityOf(keyOf(r.departmentId, c.blankTypeId)),
      })),
    ),
  };
  const targetChanged =
    form.target.electricParts !== (data.target?.electricParts ?? 0) ||
    form.target.motorbikeParts !== (data.target?.motorbikeParts ?? 0);
  const changed = targetChanged || Object.keys(initial).some((key) => quantityOf(key) !== Number(initial[key] || 0));
  const targetMissing = form.target.electricParts + form.target.motorbikeParts === 0;

  const save = useMutation({
    mutationFn: () => saveDepartmentBlanks(data.month, form),
    onSuccess: (next) => {
      queryClient.setQueryData(["insurance-blanks", "departments", data.month], next);
      queryClient.invalidateQueries({ queryKey: ["insurance-blanks", "staff"] });
      toast.ok(`Đã lưu phôi ${monthLabel(data.month).toLowerCase()}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được phôi.")),
  });

  const locked = !data.editable;
  const rows = data.rows.map((r) => {
    const cell = r.cells.find((c) => c.blankTypeId === typeId)!;
    const key = keyOf(r.departmentId, typeId);
    const allocated = quantityOf(key);
    const closing = cell.openingUnallocated + allocated - cell.issued;
    // Trừ ra không được làm phòng còn ít hơn số đã phát cho nhân viên, cùng luật với `belowIssued`.
    return { ...r, cell, key, allocated, closing, removable: Math.max(0, Math.min(allocated, closing)) };
  });
  const sum = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
  // Hạ số cấp xuống dưới số phòng đã phát thì khoá Lưu ngay; máy chủ cũng chặn.
  const belowIssued = data.rows.some((r) =>
    r.cells.some((c) => c.openingUnallocated + quantityOf(keyOf(r.departmentId, c.blankTypeId)) - c.issued < 0),
  );

  return (
    <>
      <SectionCard
        title="Mục tiêu tỉ lệ đơn điện/xe"
        icon={<Target size={17} />}
        action={locked ? <StatusTag tone="neutral">Chỉ xem</StatusTag> : undefined}
      >
        <div className={styles.targetRow}>
          <TextField
            label="Điện"
            inputMode="numeric"
            value={electric}
            disabled={locked}
            onChange={(e) => setElectric(digitsOnly(e.target.value).slice(0, 3))}
          />
          <TextField
            label="Xe máy"
            inputMode="numeric"
            value={motorbike}
            disabled={locked}
            onChange={(e) => setMotorbike(digitsOnly(e.target.value).slice(0, 3))}
          />
        </div>
        {data.target && data.target.fromMonth !== data.month && (
          <p className={`${styles.note} text-muted`}>
            Đang dùng mục tiêu của {monthLabel(data.target.fromMonth).toLowerCase()}.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Cấp phôi cho phòng" icon={<Building2 size={17} />}>
        <SegmentedTabs
          label="Loại phôi"
          value={typeId}
          onChange={setTypeId}
          options={data.types.map((t) => ({ value: t.id, label: t.name }))}
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
                <th scope="col">Điện/xe</th>
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
                          aria-label={`${r.departmentName}: trừ phôi đã cấp`}
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
                        aria-label={`${r.departmentName}: số phôi cấp`}
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
                          aria-label={`${r.departmentName}: cấp thêm phôi`}
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
                  <td>
                    <BlankMix mix={r.mix} target={data.target} />
                  </td>
                </tr>
              ))}
              <tr className={styles.total}>
                <th scope="row">Tổng</th>
                <td className={styles.number}>{sum((r) => r.cell.openingUnallocated)}</td>
                <td className={styles.number}>{sum((r) => r.allocated)}</td>
                <td className={styles.number}>{sum((r) => r.cell.issued)}</td>
                <td className={styles.number}>{sum((r) => r.closing)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      {!locked && (
        <div className={styles.saveBar}>
          <Button disabled={!changed || targetMissing || belowIssued || save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </div>
      )}

      {adjusting && (
        <BlankAdjustDialog
          title={`${adjusting.sign > 0 ? "Cấp thêm phôi" : "Trừ phôi đã cấp"} - ${adjusting.departmentName}`}
          label={`Số phôi ${data.types.find((t) => t.id === typeId)?.name ?? ""} ${adjusting.sign > 0 ? "cấp thêm" : "trừ ra"}`}
          submitLabel={adjusting.sign > 0 ? "Cộng thêm" : "Trừ ra"}
          max={adjusting.max}
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
