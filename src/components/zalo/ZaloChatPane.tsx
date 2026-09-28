"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Phone, Send, User, Users } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyValue";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  fetchZaloMessages,
  sendZaloMessage,
  ZALO_BODY_MAX,
  ZALO_OUTBOX_STATUS_LABEL,
  ZALO_SEND_TARGET_LABEL,
  ZaloSendBody,
  type ZaloOutboxStatus,
} from "@/lib/api/zaloBot";
import { formatCount, formatDateTime, formatPhone } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import { chatTargetKey, type ZaloChatTarget } from "./ZaloThreadList";
import styles from "./ZaloChatPane.module.scss";

const OUTBOX_TONE: Record<ZaloOutboxStatus, "ok" | "warn" | "waiting"> = {
  sent: "ok",
  pending: "waiting",
  failed: "warn",
};

type Props = {
  /** Nơi dùng gắn `key` theo nơi nhận để đổi nơi nhận là xoá tin đang soạn. */
  target: ZaloChatTarget;
  connected: boolean;
  /** Điện thoại: khung chat phủ toàn màn hình, nút này đóng khung để về danh sách. */
  onBack: () => void;
};

function describe(target: ZaloChatTarget) {
  switch (target.kind) {
    case "group":
      return {
        icon: <Users size={18} aria-hidden />,
        name: target.name,
        sub: `${ZALO_SEND_TARGET_LABEL.group} - ${formatCount(target.memberCount)} thành viên`,
        threadId: target.id,
      };
    case "user":
      return {
        icon: <User size={18} aria-hidden />,
        name: target.name || formatPhone(target.phone),
        sub: `${ZALO_SEND_TARGET_LABEL.user} - ${formatPhone(target.phone)}`,
        threadId: target.id,
      };
    case "phone":
      return {
        icon: <Phone size={18} aria-hidden />,
        name: formatPhone(target.phone),
        sub: ZALO_SEND_TARGET_LABEL.phone,
        threadId: "",
      };
  }
}

export function ZaloChatPane({ target, connected, onBack }: Props) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const head = describe(target);

  const messages = useQuery({
    queryKey: ["zalo-bot", "messages", chatTargetKey(target)],
    queryFn: () =>
      fetchZaloMessages(target.kind === "phone" ? { phone: target.phone } : { threadId: target.id }),
    // Tin chờ gửi đổi trạng thái sau vài giây, nên lúc đó phải tải lại dày.
    refetchInterval: (query) =>
      query.state.data?.some((m) => m.status === "pending") ? 3000 : 15_000,
  });

  const send = useMutation({
    mutationFn: sendZaloMessage,
    onSuccess: () => {
      setText("");
      void queryClient.invalidateQueries({ queryKey: ["zalo-bot"] });
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đưa được tin nhắn vào hàng chờ.")),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ZaloSendBody.safeParse(
      target.kind === "phone"
        ? { target: "phone", phone: target.phone, body: text }
        : { target: target.kind, threadId: target.id, body: text },
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Nội dung không hợp lệ");
      return;
    }
    setError("");
    send.mutate(parsed.data);
  };

  // Enter gửi, Shift+Enter xuống dòng. Bỏ qua Enter lúc bộ gõ tiếng Việt còn đang ghép chữ.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  };

  const canSend = connected && !send.isPending && text.trim() !== "";

  return (
    <section className={styles.pane} aria-label={`Tin nhắn gửi tới ${head.name}`}>
      <header className={styles.head}>
        <span className={styles.back}>
          <Button variant="ghost" onClick={onBack} aria-label="Quay lại danh sách">
            <ArrowLeft size={18} aria-hidden />
          </Button>
        </span>
        <span className={styles.avatar}>{head.icon}</span>
        <div className={styles.headText}>
          <h3 className={styles.name}>{head.name}</h3>
          <p className={styles.sub}>{head.sub}</p>
        </div>
        {head.threadId && (
          <span className={styles.threadId}>
            <span className="tabular-nums">{head.threadId}</span>
            <CopyButton value={head.threadId} label={`Thread ID ${head.threadId}`} quiet />
          </span>
        )}
      </header>

      {/* column-reverse trên khung cuộn giữ thanh cuộn ở đáy mà không cần effect cuộn. */}
      <div className={styles.scroll}>
        {messages.isError ? (
          <ErrorState what="tin nhắn" onRetry={messages.refetch} retrying={messages.isFetching} />
        ) : messages.isPending ? (
          <SkeletonTable rows={3} columns={1} />
        ) : messages.data.length === 0 ? (
          <p className={styles.empty}>Chưa có tin nhắn.</p>
        ) : (
          <ol className={styles.log}>
            {messages.data.map((m) => (
              <li key={m.id} className={styles.message}>
                <p className={styles.bubble}>{m.body}</p>
                <p className={styles.meta}>
                  <time dateTime={m.createdAt}>{formatDateTime(m.createdAt)}</time>
                  <StatusTag tone={OUTBOX_TONE[m.status]}>{ZALO_OUTBOX_STATUS_LABEL[m.status]}</StatusTag>
                </p>
                {m.error && <p className={styles.messageError}>{m.error}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>

      <form className={styles.composer} onSubmit={onSubmit} noValidate>
        <label htmlFor={inputId} className="sr-only">
          Nội dung tin nhắn
        </label>
        <textarea
          id={inputId}
          className={`input ${styles.input}`}
          rows={2}
          maxLength={ZALO_BODY_MAX}
          placeholder="Nhập tin nhắn"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
        />
        <Button type="submit" disabled={!canSend}>
          <Send size={16} aria-hidden />
          Gửi
        </Button>
      </form>
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
