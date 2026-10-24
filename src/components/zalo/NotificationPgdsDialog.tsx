"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { SearchField } from "@/components/ui/SearchField";
import {
  fetchZaloPeopleOptions,
  notificationPeople,
  saveZaloNotificationPgds,
  ZALO_NOTIFICATION_LABEL,
  type ZaloNotificationKind,
} from "@/lib/api/zaloBot";
import { formatPhone, isValidPhone, matchesSearch } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./NotificationGroupsDialog.module.css";

type Props = {
  kind: ZaloNotificationKind;
  initialUserIds: string[];
  onClose: () => void;
};

/**
 * Chọn người nhận riêng của một loại thông báo: mỗi người được chọn nhận một tin
 * riêng tới SĐT trên hồ sơ. Báo cáo ngày chỉ chọn Phó giám đốc đang làm, loại
 * khác chọn mọi người đang làm. Máy chủ kiểm lại khi lưu.
 *
 * Tìm ở trình duyệt được vì đây là hộp chọn trên danh sách đóng: người đang làm,
 * không lớn thêm theo ngày làm việc (AGENTS.md §5.1, điều 4).
 */
export function NotificationPgdsDialog({ kind, initialUserIds, onClose }: Props) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string[]>(initialUserIds);
  const [search, setSearch] = useState("");
  const who = notificationPeople(kind) === "pgd" ? "Phó giám đốc" : "người nhận";

  const options = useQuery({
    queryKey: ["zalo-bot", "people-options", kind],
    queryFn: () => fetchZaloPeopleOptions(kind),
  });

  const save = useMutation({
    mutationFn: () => saveZaloNotificationPgds(kind, { userIds: picked }),
    onSuccess: () => {
      toast.ok(`Đã lưu ${who}.`);
      void queryClient.invalidateQueries({ queryKey: ["zalo-bot", "notifications"] });
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, `Không lưu được danh sách ${who}.`)),
  });

  const shown = (options.data ?? []).filter((p) => matchesSearch(`${p.name} ${p.phone}`, search));

  const toggle = (id: string, checked: boolean) =>
    setPicked((prev) => (checked ? [...prev, id] : prev.filter((p) => p !== id)));

  return (
    <Dialog
      open
      title={ZALO_NOTIFICATION_LABEL[kind]}
      onClose={onClose}
      footerStart={<span className={styles.count}>Đã chọn {picked.length} người</span>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Thôi
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || options.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <SearchField
          label={`Tìm ${who}`}
          placeholder="Họ tên hoặc số điện thoại"
          value={search}
          onChange={setSearch}
          block
        />
        {options.isError ? (
          <ErrorState what={`danh sách ${who}`} onRetry={options.refetch} retrying={options.isFetching} />
        ) : options.isPending ? (
          <p className="text-muted">Đang tải danh sách {who}…</p>
        ) : options.data.length === 0 ? (
          <p className="text-muted">Chưa có {who} nào.</p>
        ) : shown.length === 0 ? (
          <p className="text-muted">Không ai khớp.</p>
        ) : (
          <ul className={styles.list}>
            {shown.map((p) => {
              const hasPhone = isValidPhone(p.phone);
              return (
                <li key={p.id}>
                  <Checkbox
                    checked={picked.includes(p.id)}
                    onCheckedChange={(checked) => toggle(p.id, checked)}
                    label={`${p.name} - ${hasPhone ? formatPhone(p.phone) : "Chưa có số điện thoại"}`}
                    // Vẫn bỏ chọn được người đã chọn trước khi số trên hồ sơ bị xoá.
                    disabled={!hasPhone && !picked.includes(p.id)}
                    block
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
