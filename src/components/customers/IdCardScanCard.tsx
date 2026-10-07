"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanLine } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { fetchIdCardScan, saveIdCardScan, type IdCardScanSetting } from "@/lib/api/ops";
import { formatDateTime } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./IdCardScanCard.module.css";

const OPTIONS = [
  { value: "on", label: "Bật" },
  { value: "off", label: "Tắt" },
];

/** P-99 · Bật hoặc tắt bước chụp CCCD khi tạo khách. Tắt thì người dùng gõ tay như trước. */
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
        // Đổi `key` khi máy chủ trả giá trị mới, để ô chọn quay về đúng giá trị đã lưu.
        <IdCardScanForm key={`${setting.data.enabled}:${setting.data.updatedAt}`} setting={setting.data} />
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
        label="Chụp CCCD khi tạo khách"
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
