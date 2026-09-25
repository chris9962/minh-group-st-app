"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { SearchField } from "@/components/ui/SearchField";
import {
  fetchZaloGroupOptions,
  saveZaloNotificationRoutes,
  ZALO_NOTIFICATION_LABEL,
  type ZaloNotificationKind,
} from "@/lib/api/zaloBot";
import { matchesSearch } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./NotificationGroupsDialog.module.css";

type Props = {
  accountId: string;
  kind: ZaloNotificationKind;
  initialGroupIds: string[];
  onClose: () => void;
};

/**
 * Chọn nhóm Zalo nhận một loại thông báo. Nơi dùng gắn `key` theo loại thông
 * báo để mỗi lần mở là một lượt chọn mới.
 *
 * Tìm ở trình duyệt được vì đây là hộp chọn trên danh sách đóng: nhóm của một
 * tài khoản Zalo, không lớn thêm theo ngày làm việc (AGENTS.md §5.1, điều 4).
 */
export function NotificationGroupsDialog({ accountId, kind, initialGroupIds, onClose }: Props) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string[]>(initialGroupIds);
  const [search, setSearch] = useState("");

  const options = useQuery({
    queryKey: ["zalo-bot", "group-options", accountId],
    queryFn: fetchZaloGroupOptions,
  });

  const save = useMutation({
    mutationFn: () => saveZaloNotificationRoutes(kind, { groupIds: picked }),
    onSuccess: () => {
      toast.ok("Đã lưu nhóm nhận thông báo.");
      void queryClient.invalidateQueries({ queryKey: ["zalo-bot", "notifications"] });
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được nhóm nhận thông báo.")),
  });

  const shown = (options.data ?? []).filter((g) => matchesSearch(g.name, search));

  const toggle = (id: string, checked: boolean) =>
    setPicked((prev) => (checked ? [...prev, id] : prev.filter((p) => p !== id)));

  return (
    <Dialog
      open
      title={ZALO_NOTIFICATION_LABEL[kind]}
      onClose={onClose}
      footerStart={<span className={styles.count}>Đã chọn {picked.length} nhóm</span>}
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
          label="Tìm nhóm"
          placeholder="Tên nhóm"
          value={search}
          onChange={setSearch}
          block
        />
        {options.isError ? (
          <ErrorState what="danh sách nhóm" onRetry={options.refetch} retrying={options.isFetching} />
        ) : options.isPending ? (
          <p className="text-muted">Đang tải danh sách nhóm…</p>
        ) : shown.length === 0 ? (
          <p className="text-muted">Không nhóm nào khớp.</p>
        ) : (
          <ul className={styles.list}>
            {shown.map((g) => (
              <li key={g.id}>
                <Checkbox
                  checked={picked.includes(g.id)}
                  onCheckedChange={(checked) => toggle(g.id, checked)}
                  label={g.name}
                  block
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
