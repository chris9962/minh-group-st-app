"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanLine, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { RowActions } from "@/components/ui/RowActions";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { SkeletonTable } from "@/components/ui/Skeleton";
import {
  fetchIdCardScan,
  removeIdCardScanOverride,
  saveIdCardScan,
  saveIdCardScanOverride,
  type IdCardScanOverride,
  type IdCardScanSetting,
} from "@/lib/api/ops";
import { fetchStaffOptions } from "@/lib/api/staff";
import { formatDateTime } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./IdCardScanCard.module.css";

const OPTIONS = [
  { value: "on", label: "Bật" },
  { value: "off", label: "Tắt" },
];

/**
 * P-99 · Chụp CCCD khi tạo khách: mức mặc định và ngoại lệ theo người (chốt
 * 2026-10-09). Tắt thì người dùng gõ tay như trước.
 */
export function IdCardScanCard() {
  const setting = useQuery({ queryKey: ["ops", "id-card-scan"], queryFn: fetchIdCardScan });

  const meta = setting.data?.updatedAt
    ? `Đổi lúc ${formatDateTime(setting.data.updatedAt)} - ${setting.data.updatedBy}`
    : undefined;

  return (
    <SectionCard title="Chụp CCCD khi tạo khách" icon={<ScanLine size={17} />} meta={meta}>
      {setting.isError ? (
        <ErrorState what="công tắc chụp CCCD" onRetry={setting.refetch} retrying={setting.isFetching} />
      ) : setting.isPending ? (
        <SkeletonTable rows={1} columns={2} />
      ) : (
        <div className={styles.body}>
          {/* Đổi `key` khi máy chủ trả giá trị mới, để ô chọn quay về đúng giá trị đã lưu. */}
          <IdCardScanForm key={`${setting.data.enabled}:${setting.data.updatedAt}`} setting={setting.data} />
          <IdCardScanOverrides overrides={setting.data.overrides} />
        </div>
      )}
    </SectionCard>
  );
}

function IdCardScanForm({ setting }: { setting: IdCardScanSetting }) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(setting.enabled);

  const save = useMutation({
    mutationFn: () => saveIdCardScan({ enabled }),
    onSuccess: () => {
      toast.ok(enabled ? "Đã bật chụp CCCD khi tạo khách." : "Đã tắt chụp CCCD, tạo khách gõ tay.");
      void queryClient.invalidateQueries({ queryKey: ["ops", "id-card-scan"] });
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được công tắc chụp CCCD.")),
  });

  return (
    <div className={styles.row}>
      <SegmentedTabs
        label="Mức mặc định"
        options={OPTIONS}
        value={enabled ? "on" : "off"}
        onChange={(v) => setEnabled(v === "on")}
      />
      <Button onClick={() => save.mutate()} disabled={enabled === setting.enabled || save.isPending}>
        Lưu
      </Button>
    </div>
  );
}

function IdCardScanOverrides({ overrides }: { overrides: IdCardScanOverride[] }) {
  const queryClient = useQueryClient();
  const staff = useQuery({
    queryKey: ["staff", "options", "active"],
    queryFn: () => fetchStaffOptions({ status: "active" }),
    retry: false,
  });
  const [userId, setUserId] = useState("");
  const [enabled, setEnabled] = useState(true);

  const taken = new Set(overrides.map((o) => o.userId));
  const staffOptions = (staff.data ?? [])
    .filter((s) => !taken.has(s.id))
    .map((s) => ({ value: s.id, label: s.departmentName ? `${s.fullName} - ${s.departmentName}` : s.fullName }));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ops", "id-card-scan"] });
  const save = useMutation({
    mutationFn: saveIdCardScanOverride,
    onSuccess: (_void, body) => {
      if (body.userId === userId) setUserId("");
      void refresh();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được ngoại lệ chụp CCCD.")),
  });
  const remove = useMutation({
    mutationFn: removeIdCardScanOverride,
    onSuccess: () => void refresh(),
    onError: (e) => toast.fail(errorMessage(e, "Không xoá được ngoại lệ chụp CCCD.")),
  });

  const columns: RankColumn<IdCardScanOverride>[] = [
    { key: "fullName", label: "Nhân viên", render: (o) => o.fullName },
    { key: "departmentName", label: "Phòng", render: (o) => o.departmentName },
    {
      key: "enabled",
      label: "Chụp CCCD",
      render: (o) => (
        <SegmentedTabs
          label={`Chụp CCCD của ${o.fullName}`}
          options={OPTIONS}
          value={o.enabled ? "on" : "off"}
          onChange={(v) => save.mutate({ userId: o.userId, enabled: v === "on" })}
        />
      ),
    },
    {
      key: "actions",
      label: "Thao tác",
      render: (o) => (
        <RowActions>
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
    <section className={styles.overrides} aria-label="Ngoại lệ theo người">
      <h3 className={styles.subTitle}>Ngoại lệ theo người</h3>
      <RankTable
        rows={overrides}
        columns={columns}
        rowKey={(o) => o.userId}
        defaultSort="fullName"
        caption="Người chụp CCCD theo cài đặt riêng, không theo mức mặc định"
        emptyText="Chưa có ngoại lệ."
      />
      <div className={styles.row}>
        <div className={styles.picker}>
          <Combobox
            label="Nhân viên"
            hideLabel
            value={userId}
            options={staffOptions}
            onChange={setUserId}
            placeholder="Chọn nhân viên"
            block
          />
        </div>
        <SegmentedTabs
          label="Chụp CCCD của người được thêm"
          options={OPTIONS}
          value={enabled ? "on" : "off"}
          onChange={(v) => setEnabled(v === "on")}
        />
        <Button
          variant="secondary"
          disabled={!userId || save.isPending}
          onClick={() => save.mutate({ userId, enabled })}
        >
          Thêm
        </Button>
      </div>
    </section>
  );
}
