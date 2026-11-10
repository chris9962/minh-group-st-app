"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { ChevronDown, ChevronUp, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { ADVANCE_SUBMIT_CLOSE_HOUR, fetchMyAdvance, saveMyAdvance } from "@/lib/api/salaryAdvances";
import { formatVnd } from "@/lib/format";
import { toast } from "@/lib/toast";
import { usePrefs } from "@/store/prefs";
import { AdvanceAmountDialog } from "./AdvanceAmountDialog";
import { AdvanceHistoryDialog } from "./AdvanceHistoryDialog";
import { AdvanceStatusTag } from "./AdvanceStatusTag";
import styles from "./SalaryAdvanceCard.module.scss";

/**
 * Yêu cầu tạm ứng lương của chính mình ở màn Tổng quan. Ẩn khi chưa tới ngày 10
 * và chưa gửi yêu cầu nào trong tháng; gửi xong thì hiện trạng thái tới hết tháng.
 * Người dùng thu gọn được thẻ, sang tháng mới thẻ tự mở lại.
 */
export function SalaryAdvanceCard() {
  const queryClient = useQueryClient();
  const bodyId = useId();
  const [editing, setEditing] = useState<"create" | "edit" | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const collapsedMonth = usePrefs((s) => s.collapsedAdvanceMonth);
  const setCollapsedMonth = usePrefs((s) => s.setCollapsedAdvanceMonth);
  // Tải lại theo phút: Trưởng phòng duyệt hay qua giờ đóng gửi thì thẻ đổi theo mà người dùng không cần tải lại trang.
  const { data } = useQuery({ queryKey: ["salary-advance", "mine"], queryFn: fetchMyAdvance, refetchInterval: 60_000 });

  if (!data || (!data.request && !data.canCreate)) return null;
  const request = data.request;
  const collapsed = collapsedMonth === data.month;

  // Dòng tiêu đề chỉ có tên thẻ và nút thu gọn, để khổ điện thoại giữ được nút trên cùng hàng.
  return (
    <SectionCard
      title="Tạm ứng lương"
      icon={<HandCoins size={17} />}
      inlineAction
      action={
        <Button
          variant="ghost"
          icon
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : bodyId}
          aria-label="Chi tiết tạm ứng lương"
          onClick={() => setCollapsedMonth(collapsed ? "" : data.month)}
        >
          {collapsed ? <ChevronDown size={18} aria-hidden /> : <ChevronUp size={18} aria-hidden />}
        </Button>
      }
    >
      {!collapsed && (
        <div id={bodyId} className={styles.body}>
          {request && (
            <div className={styles.status}>
              <span className={`${styles.amount} tabular-nums`}>{formatVnd(request.amount)}</span>
              <AdvanceStatusTag status={request.status} />
            </div>
          )}
          {request?.rejectReason && <p className={styles.note}>Lý do từ chối: {request.rejectReason}</p>}
          <div className={styles.actions}>
            {data.canCreate && <Button onClick={() => setEditing("create")}>Yêu cầu tạm ứng</Button>}
            {data.canEdit && (
              <Button variant="secondary" onClick={() => setEditing("edit")}>
                Sửa số tiền
              </Button>
            )}
            {request && (
              <Button variant="ghost" onClick={() => setHistoryOf(request.id)}>
                Lịch sử
              </Button>
            )}
          </div>
          {(data.canCreate || data.canEdit) && (
            <p className={styles.note}>Hạn gửi {ADVANCE_SUBMIT_CLOSE_HOUR}:00</p>
          )}
        </div>
      )}

      {editing && (
        <AdvanceAmountDialog
          title={editing === "create" ? "Yêu cầu tạm ứng lương" : "Sửa số tiền tạm ứng"}
          initial={editing === "edit" ? (request?.amount ?? 0) : 0}
          submitLabel={editing === "create" ? "Gửi yêu cầu" : "Lưu"}
          onSubmit={(amount) => saveMyAdvance(amount, editing === "edit")}
          onDone={() => {
            toast.ok(editing === "create" ? "Đã gửi yêu cầu tạm ứng" : "Đã sửa số tiền tạm ứng");
            void queryClient.invalidateQueries({ queryKey: ["salary-advance"] });
          }}
          onFail={() => void queryClient.invalidateQueries({ queryKey: ["salary-advance"] })}
          onClose={() => setEditing(null)}
        />
      )}
      {historyOf && <AdvanceHistoryDialog id={historyOf} onClose={() => setHistoryOf(null)} />}
    </SectionCard>
  );
}
