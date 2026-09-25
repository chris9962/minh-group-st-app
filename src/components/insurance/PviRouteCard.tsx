"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Route } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { SkeletonTable } from "@/components/ui/Skeleton";
import {
  fetchPviRoute,
  PVI_ROUTE_MODE_LABEL,
  PviRouteMode,
  savePviRoute,
  type PviRouteSetting,
} from "@/lib/api/ops";
import { formatDateTime } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./PviRouteCard.module.css";

const MODE_OPTIONS = PviRouteMode.options.map((value) => ({
  value,
  label: PVI_ROUTE_MODE_LABEL[value],
}));

/**
 * P-99 · Chọn đường đi của đơn bảo hiểm mới: làm tay, API hoặc bot.
 *
 * Đơn tai nạn điện vẫn luôn làm tay dù chọn gì, luật đó nằm ở `createInsuranceOrders`.
 */
export function PviRouteCard() {
  const setting = useQuery({ queryKey: ["ops", "pvi-route"], queryFn: fetchPviRoute });

  const meta = setting.data?.updatedAt
    ? `Đổi lúc ${formatDateTime(setting.data.updatedAt)} - ${setting.data.updatedBy}`
    : undefined;

  return (
    <SectionCard title="Điều hướng đơn bảo hiểm" icon={<Route size={17} />} meta={meta}>
      {setting.isError ? (
        <ErrorState what="chế độ điều hướng" onRetry={setting.refetch} retrying={setting.isFetching} />
      ) : setting.isPending ? (
        <SkeletonTable rows={1} columns={3} />
      ) : (
        // Đổi `key` khi máy chủ trả chế độ mới, để ô chọn quay về đúng giá trị đã lưu.
        <PviRouteForm key={`${setting.data.mode}:${setting.data.updatedAt}`} setting={setting.data} />
      )}
    </SectionCard>
  );
}

function PviRouteForm({ setting }: { setting: PviRouteSetting }) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<PviRouteMode>(setting.mode);

  const save = useMutation({
    mutationFn: () => savePviRoute({ mode: picked }),
    onSuccess: () => {
      toast.ok(`Đơn mới đi đường ${PVI_ROUTE_MODE_LABEL[picked]}.`);
      void queryClient.invalidateQueries({ queryKey: ["ops", "pvi-route"] });
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được chế độ điều hướng đơn.")),
  });

  return (
    <div className={styles.row}>
      <SegmentedTabs
        label="Chế độ điều hướng đơn bảo hiểm"
        options={MODE_OPTIONS}
        value={picked}
        onChange={(v) => setPicked(PviRouteMode.catch(setting.mode).parse(v))}
      />
      <Button onClick={() => save.mutate()} disabled={picked === setting.mode || save.isPending}>
        Lưu
      </Button>
    </div>
  );
}
