"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Ticket, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { RowActions } from "@/components/ui/RowActions";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { TextField } from "@/components/ui/TextField";
import { ACCOUNT_TYPE_LABEL, AccountType } from "@/lib/api/bankAccounts";
import {
  DraftLimits,
  fetchDraftLimit,
  removeDraftLimitOverride,
  saveDraftLimit,
  saveDraftLimitOverride,
  type DraftLimitOverride,
  type DraftLimitSetting,
} from "@/lib/api/ops";
import { fetchStaffOptions } from "@/lib/api/staff";
import { formatDateTime } from "@/lib/format";
import { digitsOnly } from "@/lib/numberField";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./DraftLimitCard.module.css";

type LimitDraft = Record<AccountType, string>;

const toDraft = (l: DraftLimits): LimitDraft => ({ none: String(l.none), CNKD: String(l.CNKD), HKD: String(l.HKD) });
const parseDraft = (d: LimitDraft) =>
  DraftLimits.safeParse({ none: Number(d.none), CNKD: Number(d.CNKD), HKD: Number(d.HKD) });

/**
 * P-99 · Giới hạn mã giới thiệu: số bản nháp mỗi nhân viên giữ cùng lúc ở một
 * ngân hàng, theo loại tài khoản. Mức mặc định và ngoại lệ theo người (chốt
 * 2026-10-09), cùng dạng với `IdCardScanCard`.
 */
export function DraftLimitCard() {
  const setting = useQuery({ queryKey: ["ops", "draft-limit"], queryFn: fetchDraftLimit });

  const meta = setting.data?.updatedAt
    ? `Đổi lúc ${formatDateTime(setting.data.updatedAt)} - ${setting.data.updatedBy}`
    : undefined;

  return (
    <SectionCard title="Giới hạn mã giới thiệu" icon={<Ticket size={17} />} meta={meta}>
      {setting.isError ? (
        <ErrorState what="giới hạn mã giới thiệu" onRetry={setting.refetch} retrying={setting.isFetching} />
      ) : setting.isPending ? (
        <SkeletonTable rows={1} columns={3} />
      ) : (
        <div className={styles.body}>
          {/* Đổi `key` khi máy chủ trả giá trị mới, để ô nhập quay về đúng giá trị đã lưu. */}
          <DraftLimitForm key={setting.data.updatedAt} setting={setting.data} />
          <DraftLimitOverrides overrides={setting.data.overrides} defaults={setting.data.limits} />
        </div>
      )}
    </SectionCard>
  );
}

function LimitInputs({ value, onChange }: { value: LimitDraft; onChange: (next: LimitDraft) => void }) {
  return (
    <>
      {AccountType.options.map((t) => (
        <div key={t} className={styles.limit}>
          <TextField
            label={ACCOUNT_TYPE_LABEL[t]}
            inputMode="numeric"
            maxLength={2}
            value={value[t]}
            onChange={(e) => onChange({ ...value, [t]: digitsOnly(e.target.value) })}
          />
        </div>
      ))}
    </>
  );
}

function DraftLimitForm({ setting }: { setting: DraftLimitSetting }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => toDraft(setting.limits));
  const parsed = parseDraft(draft);
  const unchanged =
    parsed.success && AccountType.options.every((t) => parsed.data[t] === setting.limits[t]);

  const save = useMutation({
    mutationFn: (limits: DraftLimits) => saveDraftLimit({ limits }),
    onSuccess: () => {
      toast.ok("Đã lưu giới hạn mã giới thiệu.");
      void queryClient.invalidateQueries({ queryKey: ["ops", "draft-limit"] });
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được giới hạn mã giới thiệu.")),
  });

  return (
    <section className={styles.section} aria-label="Mức mặc định">
      <h3 className={styles.subTitle}>Mức mặc định</h3>
      <div className={styles.row}>
        <LimitInputs value={draft} onChange={setDraft} />
        <Button
          onClick={() => parsed.success && save.mutate(parsed.data)}
          disabled={!parsed.success || unchanged || save.isPending}
        >
          Lưu
        </Button>
      </div>
    </section>
  );
}

function DraftLimitOverrides({
  overrides,
  defaults,
}: {
  overrides: DraftLimitOverride[];
  defaults: DraftLimits;
}) {
  const queryClient = useQueryClient();
  const staff = useQuery({
    queryKey: ["staff", "options", "active"],
    queryFn: () => fetchStaffOptions({ status: "active" }),
    retry: false,
  });
  const [userId, setUserId] = useState("");
  const [draft, setDraft] = useState(() => toDraft(defaults));
  const parsed = parseDraft(draft);

  const staffOptions = (staff.data ?? []).map((s) => ({
    value: s.id,
    label: [s.staffCode, s.fullName, s.departmentName].filter(Boolean).join(" - "),
  }));

  // Chọn người đã có ngoại lệ thì nạp trần đang lưu của họ, để Lưu là sửa chứ không gõ lại từ đầu.
  const pick = (id: string) => {
    setUserId(id);
    setDraft(toDraft(overrides.find((o) => o.userId === id)?.limits ?? defaults));
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ops", "draft-limit"] });
  const save = useMutation({
    mutationFn: saveDraftLimitOverride,
    onSuccess: () => {
      setUserId("");
      setDraft(toDraft(defaults));
      void refresh();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được ngoại lệ giới hạn mã giới thiệu.")),
  });
  const remove = useMutation({
    mutationFn: removeDraftLimitOverride,
    onSuccess: () => void refresh(),
    onError: (e) => toast.fail(errorMessage(e, "Không xoá được ngoại lệ giới hạn mã giới thiệu.")),
  });

  const columns: RankColumn<DraftLimitOverride>[] = [
    { key: "fullName", label: "Nhân viên", sortText: (o) => o.fullName, render: (o) => o.fullName },
    { key: "departmentName", label: "Phòng", render: (o) => o.departmentName },
    ...AccountType.options.map(
      (t): RankColumn<DraftLimitOverride> => ({
        key: t,
        label: ACCOUNT_TYPE_LABEL[t],
        render: (o) => o.limits[t],
      }),
    ),
    {
      key: "actions",
      label: "Thao tác",
      render: (o) => (
        <RowActions>
          <Button
            variant="secondary"
            icon
            tooltip="Sửa"
            aria-label={`Sửa giới hạn của ${o.fullName}`}
            onClick={() => pick(o.userId)}
          >
            <Pencil size={14} aria-hidden />
          </Button>
          <Button
            variant="secondary"
            icon
            tooltip="Bỏ ngoại lệ"
            aria-label={`Bỏ ngoại lệ của ${o.fullName}`}
            disabled={remove.isPending}
            onClick={() => remove.mutate(o.userId)}
          >
            <Trash2 size={14} aria-hidden />
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <section className={styles.section} aria-label="Ngoại lệ theo người">
      <h3 className={styles.subTitle}>Ngoại lệ theo người</h3>
      <RankTable
        rows={overrides}
        columns={columns}
        rowKey={(o) => o.userId}
        defaultSort="fullName"
        caption="Người có giới hạn mã giới thiệu riêng, không theo mức mặc định"
        emptyText="Chưa có ngoại lệ."
      />
      <div className={styles.row}>
        <div className={styles.picker}>
          <Combobox
            label="Nhân viên"
            hideLabel
            value={userId}
            options={staffOptions}
            onChange={pick}
            placeholder="Chọn nhân viên"
            block
          />
        </div>
        <LimitInputs value={draft} onChange={setDraft} />
        <Button
          variant="secondary"
          disabled={!userId || !parsed.success || save.isPending}
          onClick={() => parsed.success && save.mutate({ userId, limits: parsed.data })}
        >
          Lưu
        </Button>
      </div>
    </section>
  );
}
