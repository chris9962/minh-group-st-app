"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Users } from "lucide-react";
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
  fetchStaffBlanks,
  saveStaffBlanks,
  targetPercent,
  type StaffBlanks,
} from "@/lib/api/insuranceBlanks";
import { digitsOnly } from "@/lib/numberField";
import { errorMessage, toast } from "@/lib/toast";
import { ROLE_LABEL } from "@/lib/types";
import { BlankLeft } from "./BlankLeft";
import { BlankMix } from "./BlankMix";
import styles from "./InsuranceBlanks.module.scss";

/** Màn Phát phôi bảo hiểm: Trưởng phòng nhập số đã phát và đã sử dụng của từng người. */
export function BlankSplitSection({ month }: { month: string }) {
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["insurance-blanks", "staff", month, departmentId],
    queryFn: () => fetchStaffBlanks(month, departmentId),
    placeholderData: keepPreviousData,
  });
  if (query.isPending) return <SkeletonText lines={4} label="Đang tải phôi của nhân viên" />;
  if (query.isError)
    return <ErrorState what="phôi của nhân viên" onRetry={query.refetch} retrying={query.isFetching} />;
  return (
    <SplitForm
      key={`${query.data.month}-${query.data.departmentId}-${query.dataUpdatedAt}`}
      data={query.data}
      onDepartmentChange={setDepartmentId}
    />
  );
}

const keyOf = (userId: string, blankTypeId: string) => `${userId}:${blankTypeId}`;

function SplitForm({ data, onDepartmentChange }: { data: StaffBlanks; onDepartmentChange: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [typeId, setTypeId] = useState(data.types[0]?.id ?? "");
  const cells = data.rows.flatMap((r) => r.cells.map((c) => ({ userId: r.userId, ...c })));
  const initialIssued = Object.fromEntries(
    cells.map((c) => [keyOf(c.userId, c.blankTypeId), c.issued ? String(c.issued) : ""]),
  );
  const initialUsed = Object.fromEntries(
    cells.map((c) => [keyOf(c.userId, c.blankTypeId), c.used === null ? "" : String(c.used)]),
  );
  const [issued, setIssued] = useState<Record<string, string>>(initialIssued);
  const [used, setUsed] = useState<Record<string, string>>(initialUsed);

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
    mutationFn: () => saveStaffBlanks(data.month, data.departmentId, form),
    onSuccess: (next) => {
      queryClient.setQueryData(["insurance-blanks", "staff", data.month, data.departmentId], next);
      queryClient.invalidateQueries({ queryKey: ["insurance-blanks"] });
      toast.ok(`Đã lưu phôi ${monthLabel(data.month).toLowerCase()}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được phôi.")),
  });

  const locked = !data.editable;
  const departmentName = data.departments.find((d) => d.id === data.departmentId)?.name ?? "";
  const issuedTotal = (blankTypeId: string) =>
    data.rows.reduce((s, r) => s + issuedOf(keyOf(r.userId, blankTypeId)), 0);
  /** Phôi phòng còn phát được: chưa phát đầu tháng + cấp - tổng đang nhập. Âm là phát vượt; máy chủ cũng chặn. */
  const leftOf = (blankTypeId: string) => {
    const cell = data.departmentCells.find((c) => c.blankTypeId === blankTypeId)!;
    return cell.openingUnallocated + cell.allocated - issuedTotal(blankTypeId);
  };
  const overIssued = data.types.some((t) => leftOf(t.id) < 0);
  const left = leftOf(typeId);
  const rows = data.rows.map((r) => {
    const cell = r.cells.find((c) => c.blankTypeId === typeId)!;
    const key = keyOf(r.userId, typeId);
    const usedNow = usedInput(key) ?? cell.usedOrders;
    return { ...r, cell, key, closing: cell.opening + issuedOf(key) - usedNow };
  });

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
                    <td className={styles.number}>
                      <BlankLeft value={cell.openingUnallocated + cell.allocated - issuedNow} />
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
        <div className={styles.scroll}>
          <table className={`table ${styles.table}`}>
            <thead>
              <tr>
                <th scope="col">Người</th>
                <th scope="col">Tồn tháng trước</th>
                <th scope="col">Đã phát</th>
                <th scope="col">Đã sử dụng</th>
                <th scope="col">Đơn hoàn thành</th>
                <th scope="col">Còn lại</th>
                <th scope="col">Điện/xe</th>
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
                    <input
                      className={`input ${styles.cellInput}`}
                      inputMode="numeric"
                      aria-label={`${r.fullName}: số phôi đã phát`}
                      value={issued[r.key] ?? ""}
                      disabled={locked}
                      onChange={(e) =>
                        setIssued((prev) => ({ ...prev, [r.key]: digitsOnly(e.target.value).slice(0, 9) }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      className={`input ${styles.cellInput}`}
                      inputMode="numeric"
                      aria-label={`${r.fullName}: số phôi đã sử dụng, để trống thì dùng số đơn hoàn thành`}
                      placeholder={String(r.cell.usedOrders)}
                      value={used[r.key] ?? ""}
                      disabled={locked}
                      onChange={(e) =>
                        setUsed((prev) => ({ ...prev, [r.key]: digitsOnly(e.target.value).slice(0, 9) }))
                      }
                    />
                  </td>
                  <td className={styles.number}>{r.cell.usedOrders}</td>
                  <td className={styles.number}>{r.closing}</td>
                  <td>
                    <BlankMix mix={r.mix} target={data.target} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted">
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
          <Button disabled={!changed || overIssued || save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </div>
      )}
    </>
  );
}
