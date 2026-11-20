"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Layers, Minus, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { monthLabel } from "@/components/ui/MonthPicker";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { Select } from "@/components/ui/Select";
import { SkeletonText } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  departmentLeft,
  fetchStaffBlanks,
  receivedOf,
  remainingOf,
  saveStaffBlanks,
  targetPercent,
  type StaffBlankCell,
  type StaffBlanks,
} from "@/lib/api/insuranceBlanks";
import { MY_BLANKS_KEY } from "@/lib/api/myBlanks";
import { businessMonth, formatDateTime } from "@/lib/format";
import { digitsOnly } from "@/lib/numberField";
import { errorMessage, toast } from "@/lib/toast";
import { BlankAdjustDialog } from "./BlankAdjustDialog";
import { BlankLeft } from "./BlankLeft";
import { BlankMix } from "./BlankMix";
import styles from "./InsuranceBlanks.module.scss";

/** Màn Phát phôi bảo hiểm: Trưởng phòng nhập số đã phát và số còn lại của từng người. */
export function BlankSplitSection({ month }: { month: string }) {
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const queryKey = ["insurance-blanks", "staff", month, departmentId];
  const query = useQuery({
    queryKey,
    queryFn: () => fetchStaffBlanks(month, departmentId),
    placeholderData: keepPreviousData,
    // Mỗi lần tải lại là dựng lại form, mất số Trưởng phòng đang gõ dở.
    refetchOnWindowFocus: false,
  });
  if (query.isPending) return <SkeletonText lines={4} label="Đang tải phôi của nhân viên" />;
  if (query.isError)
    return <ErrorState what="phôi của nhân viên" onRetry={query.refetch} retrying={query.isFetching} />;
  return (
    <SplitForm
      key={`${query.data.month}-${query.data.departmentId}-${query.dataUpdatedAt}`}
      data={query.data}
      queryKey={queryKey}
      onDepartmentChange={setDepartmentId}
    />
  );
}

type Cell = StaffBlankCell & { userId: string; movedOut: boolean };

const keyOf = (userId: string, blankTypeId: string) => `${userId}:${blankTypeId}`;

function SplitForm({
  data,
  queryKey,
  onDepartmentChange,
}: {
  data: StaffBlanks;
  queryKey: unknown[];
  onDepartmentChange: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [typeId, setTypeId] = useState(data.types[0]?.id ?? "");
  const cells: Cell[] = data.rows.flatMap((r) => r.cells.map((c) => ({ userId: r.userId, movedOut: r.movedOut, ...c })));
  const initialIssued = Object.fromEntries(
    cells.map((c) => [keyOf(c.userId, c.blankTypeId), c.issued ? String(c.issued) : ""]),
  );
  const [issued, setIssued] = useState<Record<string, string>>(initialIssued);
  // Chỉ giữ ô Còn lại người dùng đã gõ; ô chưa gõ đi theo số đã phát đang nhập.
  const [typedRemaining, setTypedRemaining] = useState<Record<string, string>>({});
  const [adjusting, setAdjusting] = useState<{ key: string; fullName: string; sign: 1 | -1; max?: number } | null>(
    null,
  );

  const issuedOf = (key: string) => Number(issued[key] || 0);
  /** Ô Còn lại: dòng đã chuyển phòng là số phòng thực nhận lại, dòng khác là số người đó đang giữ. */
  const remainingNow = (c: Cell) =>
    c.movedOut ? c.returned : remainingOf({ ...c, issued: issuedOf(keyOf(c.userId, c.blankTypeId)) });
  const remainingMax = (c: Cell) =>
    c.movedOut ? c.opening + c.issued : receivedOf({ ...c, issued: issuedOf(keyOf(c.userId, c.blankTypeId)) });
  /** null là giữ số đã báo: gõ lại đúng số đang hiện cũng không tính là báo. */
  const remainingInput = (c: Cell): number | null => {
    const typed = typedRemaining[keyOf(c.userId, c.blankTypeId)];
    return typed === undefined || typed === String(remainingNow(c)) ? null : Number(typed);
  };
  const form = {
    rows: cells.map((c) => {
      const key = keyOf(c.userId, c.blankTypeId);
      return {
        userId: c.userId,
        blankTypeId: c.blankTypeId,
        issued: issued[key] !== initialIssued[key] ? issuedOf(key) : null,
        remaining: remainingInput(c),
        reportedAt: c.reportedAt,
      };
    }),
  };
  const changed = cells.some((c) => {
    const key = keyOf(c.userId, c.blankTypeId);
    return issued[key] !== initialIssued[key] || remainingInput(c) !== null;
  });
  const remainingBad = (c: Cell) => {
    const typed = typedRemaining[keyOf(c.userId, c.blankTypeId)];
    return typed !== undefined && (typed === "" || Number(typed) > remainingMax(c));
  };
  const remainingProblem = cells
    .map((c) => {
      if (!remainingBad(c)) return null;
      const typed = typedRemaining[keyOf(c.userId, c.blankTypeId)];
      const who = `${data.rows.find((r) => r.userId === c.userId)?.fullName}, ${data.types.find((t) => t.id === c.blankTypeId)?.name}`;
      return typed === "" ? `${who}: nhập số còn lại` : `${who}: tối đa ${remainingMax(c)} phôi`;
    })
    .find((problem) => problem !== null);

  const save = useMutation({
    mutationFn: () => saveStaffBlanks(data.month, data.departmentId, form),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
      queryClient.invalidateQueries({ queryKey: ["insurance-blanks"] });
      queryClient.invalidateQueries({ queryKey: MY_BLANKS_KEY });
      toast.ok(`Đã lưu phôi ${monthLabel(data.month).toLowerCase()}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được phôi.")),
  });

  const locked = !data.editable;
  // Còn lại báo vào tháng trước thì phần đã dùng tính hai lần; máy chủ cũng chặn.
  const reportable = !locked && data.month === businessMonth();
  const departmentName = data.departments.find((d) => d.id === data.departmentId)?.name ?? "";
  const issuedTotal = (blankTypeId: string) =>
    data.rows.reduce((s, r) => s + issuedOf(keyOf(r.userId, blankTypeId)), 0);
  /** Phôi phòng còn phát được: chưa phát đầu tháng + cấp - tổng đang nhập. Âm là phát vượt; máy chủ cũng chặn. */
  const leftOf = (blankTypeId: string) => {
    const cell = data.departmentCells.find((c) => c.blankTypeId === blankTypeId)!;
    return departmentLeft(cell, cell.allocated, issuedTotal(blankTypeId));
  };
  const showReturned = data.departmentCells.some((c) => c.returned > 0);
  const overIssued = data.types.some((t) => leftOf(t.id) < 0);
  const left = leftOf(typeId);
  const rows = data.rows.map((r) => {
    const cell = cells.find((c) => c.userId === r.userId && c.blankTypeId === typeId)!;
    return { ...r, cell, key: keyOf(r.userId, typeId), rowLocked: locked || r.movedOut };
  });
  const showGivenBack = rows.some((r) => r.cell.returned > 0);

  return (
    <>
      <SectionCard
        title={`Phôi của ${departmentName}`}
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
        <p className={styles.mixLine}>
          Tỉ lệ điện/xe của phòng: <BlankMix mix={data.departmentMix} target={data.target} wordy />
          {data.target && (
            <span className="text-muted">
              {" "}
              (mục tiêu {targetPercent(data.target).electric}/{targetPercent(data.target).motorbike})
            </span>
          )}
        </p>
        <div className={styles.scroll}>
          <table className={`table ${styles.table}`}>
            <thead>
              <tr>
                <th scope="col">Loại phôi</th>
                <th scope="col">Tồn tháng trước</th>
                <th scope="col">Cấp trong tháng</th>
                <th scope="col">Đã phát</th>
                {showReturned && <th scope="col">Nhận lại</th>}
                <th scope="col">Còn tại phòng</th>
              </tr>
            </thead>
            <tbody>
              {data.types.map((t) => {
                const cell = data.departmentCells.find((c) => c.blankTypeId === t.id)!;
                const issuedNow = issuedTotal(t.id);
                return (
                  <tr key={t.id}>
                    <th scope="row">{t.name}</th>
                    <td className={styles.number}>{cell.openingUnallocated}</td>
                    <td className={styles.number}>{cell.allocated}</td>
                    <td className={styles.number}>{issuedNow}</td>
                    {showReturned && <td className={styles.number}>{cell.returned}</td>}
                    <td className={styles.number}>
                      <BlankLeft value={departmentLeft(cell, cell.allocated, issuedNow)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Phôi của từng người" icon={<Users size={17} />}>
        <SegmentedTabs
          label="Loại phôi"
          value={typeId}
          onChange={setTypeId}
          options={data.types.map((t) => ({ value: t.id, label: t.name }))}
        />
        <p className={left < 0 ? styles.danger : styles.mixLine} aria-live="polite">
          {left < 0 ? `⚠ Phát vượt ${-left} phôi so với số phòng có` : `Còn tại phòng: ${left}`}
        </p>
        {remainingProblem && (
          <p className={styles.danger} role="alert">
            ⚠ {remainingProblem}
          </p>
        )}
        <div className={styles.scroll}>
          <table className={`table ${styles.table}`}>
            <thead>
              <tr>
                <th scope="col">Người</th>
                <th scope="col">Tồn tháng trước</th>
                <th scope="col">Đã phát</th>
                {showGivenBack && <th scope="col">Trả lại</th>}
                <th scope="col">Còn lại</th>
                <th scope="col">Báo lúc</th>
                <th scope="col">Điện/xe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId}>
                  <th scope="row">
                    {r.fullName}
                    <span className={`${styles.role} text-muted`}>{r.title}</span>
                    {r.movedOut && <StatusTag tone="neutral">Đã chuyển phòng</StatusTag>}
                  </th>
                  <td className={styles.number}>{r.cell.opening}</td>
                  <td>
                    <div className={styles.cellAdjust}>
                      {!r.rowLocked && (
                        <Button
                          variant="secondary"
                          icon
                          aria-label={`${r.fullName}: trừ phôi đã phát`}
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
                        aria-label={`${r.fullName}: số phôi đã phát`}
                        value={issued[r.key] ?? ""}
                        disabled={r.rowLocked}
                        onChange={(e) =>
                          setIssued((prev) => ({ ...prev, [r.key]: digitsOnly(e.target.value).slice(0, 9) }))
                        }
                      />
                      {!r.rowLocked && (
                        <Button
                          variant="secondary"
                          icon
                          aria-label={`${r.fullName}: phát thêm phôi`}
                          disabled={left <= 0}
                          onClick={() => setAdjusting({ key: r.key, fullName: r.fullName, sign: 1, max: left })}
                        >
                          <Plus size={16} aria-hidden />
                        </Button>
                      )}
                    </div>
                  </td>
                  {showGivenBack && <td className={styles.number}>{r.cell.returned}</td>}
                  <td>
                    <input
                      className={clsx("input", styles.cellInput, remainingBad(r.cell) && styles.cellInvalid)}
                      inputMode="numeric"
                      aria-label={r.movedOut ? `${r.fullName}: số phôi phòng nhận lại` : `${r.fullName}: số phôi còn lại`}
                      aria-invalid={remainingBad(r.cell) || undefined}
                      value={typedRemaining[r.key] ?? String(remainingNow(r.cell))}
                      disabled={!reportable}
                      onChange={(e) => {
                        const value = digitsOnly(e.target.value).slice(0, 9);
                        // Gõ đúng số đang tính thì bỏ ô gõ, để ô còn đi theo số đã phát.
                        setTypedRemaining((prev) => {
                          const next = { ...prev, [r.key]: value };
                          if (value === String(remainingNow(r.cell))) delete next[r.key];
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td className="tabular-nums">{r.cell.reportedAt ? formatDateTime(r.cell.reportedAt) : ""}</td>
                  <td>
                    <BlankMix mix={r.mix} target={data.target} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={showGivenBack ? 7 : 6} className="text-muted">
                    Phòng chưa có ai trong {monthLabel(data.month).toLowerCase()}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {!locked && (
        <div className={styles.saveBar}>
          <Button disabled={!changed || overIssued || !!remainingProblem || save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </div>
      )}

      {adjusting && (
        <BlankAdjustDialog
          title={`${adjusting.sign > 0 ? "Phát thêm phôi" : "Trừ phôi đã phát"} - ${adjusting.fullName}`}
          label={`Số phôi ${data.types.find((t) => t.id === typeId)?.name ?? ""} ${adjusting.sign > 0 ? "phát thêm" : "trừ ra"}`}
          submitLabel={adjusting.sign > 0 ? "Cộng thêm" : "Trừ ra"}
          max={adjusting.max}
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
