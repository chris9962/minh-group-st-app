"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, RefreshCw } from "lucide-react";
import { useState } from "react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import { NotificationGroupsDialog } from "@/components/zalo/NotificationGroupsDialog";
import { ZaloChatPane } from "@/components/zalo/ZaloChatPane";
import {
  chatTargetKey,
  ZaloThreadList,
  type ZaloChatTarget,
} from "@/components/zalo/ZaloThreadList";
import {
  fetchZaloBot,
  fetchZaloNotificationRoutes,
  logoutZaloBot,
  syncZaloGroups,
  ZALO_BOT_STATUS_LABEL,
  ZALO_NOTIFICATION_LABEL,
  ZALO_OUTBOX_STATUS_LABEL,
  ZALO_SEND_TARGET_LABEL,
  ZALO_THREAD_TYPE_LABEL,
  type ZaloBotStatus,
  type ZaloNotificationKind,
  type ZaloOutboxRow,
  type ZaloOutboxStatus,
} from "@/lib/api/zaloBot";
import { formatDateTime, formatPhone } from "@/lib/format";
import { can } from "@/lib/permissions";
import { errorMessage, toast } from "@/lib/toast";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const STATUS_TONE: Record<ZaloBotStatus, "ok" | "warn" | "neutral" | "waiting"> = {
  connected: "ok",
  "waiting-qr": "waiting",
  "qr-scanned": "waiting",
  offline: "neutral",
  error: "warn",
};

const OUTBOX_TONE: Record<ZaloOutboxStatus, "ok" | "warn" | "waiting"> = {
  sent: "ok",
  pending: "waiting",
  failed: "warn",
};

const TABS = [
  { value: "chat", label: "Nhắn tin" },
  { value: "notices", label: "Thông báo tự động" },
  { value: "recent", label: "Tin nhắn gửi gần đây" },
] as const;
type Tab = (typeof TABS)[number]["value"];

const outboxColumns: RankColumn<ZaloOutboxRow>[] = [
  {
    key: "createdAt",
    label: "Thời gian",
    sortBy: (r) => new Date(r.createdAt).getTime(),
    render: (r) => formatDateTime(r.createdAt),
  },
  {
    key: "thread",
    label: "Gửi tới",
    render: (r) =>
      r.phone
        ? `${ZALO_SEND_TARGET_LABEL.phone} ${formatPhone(r.phone)}`
        : `${ZALO_THREAD_TYPE_LABEL[r.threadType]} ${r.threadId}`,
  },
  { key: "body", label: "Nội dung", render: (r) => r.body },
  {
    key: "status",
    label: "Trạng thái",
    render: (r) => (
      <>
        <StatusTag tone={OUTBOX_TONE[r.status]}>{ZALO_OUTBOX_STATUS_LABEL[r.status]}</StatusTag>
        {r.error && <span className={styles.error}>{r.error}</span>}
      </>
    ),
  },
];

export default function ZaloBotPage() {
  const user = useSession((s) => s.user);
  const canView = can(user, "system", "view-ops");
  const queryClient = useQueryClient();

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["zalo-bot"],
    queryFn: fetchZaloBot,
    enabled: canView,
    // Mã QR sống 100 giây và đổi sau mỗi lượt hết hạn, nên lúc chờ quét phải tải lại dày.
    refetchInterval: (query) => {
      const state = query.state.data;
      const waiting =
        state?.status === "waiting-qr" || state?.status === "qr-scanned" || state?.groupsSyncPending;
      return waiting ? 3000 : 15_000;
    },
  });

  const [tab, setTab] = useState<Tab>("chat");

  const accountId = data?.accountId ?? "";
  // Cấu hình đi theo tài khoản Zalo: đổi tài khoản là đổi khoá, màn đọc lại cấu hình của tài khoản mới.
  const routes = useQuery({
    queryKey: ["zalo-bot", "notifications", accountId],
    queryFn: fetchZaloNotificationRoutes,
    enabled: canView && !!accountId && tab === "notices",
  });
  const [editingKind, setEditingKind] = useState<ZaloNotificationKind | null>(null);
  const editingGroups = routes.data?.find((r) => r.kind === editingKind)?.groups ?? [];

  const [chatTarget, setChatTarget] = useState<ZaloChatTarget | null>(null);

  const syncGroups = useMutation({
    mutationFn: syncZaloGroups,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["zalo-bot"] }),
    onError: (e) => toast.fail(errorMessage(e, "Không gửi được yêu cầu tải lại danh sách nhóm.")),
  });

  const logout = useMutation({
    mutationFn: logoutZaloBot,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["zalo-bot"] }),
    onError: (e) => toast.fail(errorMessage(e, "Không gửi được yêu cầu đăng xuất.")),
  });

  const connected = !!data?.workerAlive && data.status === "connected";

  const logoutButton = data && (
    <Button
      variant="secondary"
      onClick={() => logout.mutate()}
      disabled={data.logoutPending || logout.isPending}
    >
      {data.logoutPending ? "Đang đăng xuất" : "Đăng xuất"}
    </Button>
  );

  return (
    <RequirePermission module="system" action="view-ops">
      <TopBar title="Bot Zalo" keepTitleOnMobile>
        {data && connected && (
          <>
            <span className={styles.accountName}>{data.accountName || data.accountId}</span>
            {logoutButton}
          </>
        )}
      </TopBar>

      <main className={connected && tab === "chat" ? `${styles.body} ${styles.fitView}` : styles.body}>
        {isPending && <SkeletonTable rows={4} columns={3} />}
        {isError && <ErrorState what="trạng thái bot Zalo" onRetry={refetch} retrying={isFetching} />}

        {data && !data.workerAlive && <Alert tone="warning">Worker bot Zalo không chạy.</Alert>}

        {data && data.workerAlive && !connected && (
          <section className={styles.login} aria-labelledby="zalo-login-title">
            <h2 id="zalo-login-title" className={styles.loginTitle}>
              Đăng nhập Zalo
            </h2>
            <StatusTag tone={STATUS_TONE[data.status]}>{ZALO_BOT_STATUS_LABEL[data.status]}</StatusTag>
            {data.qrImage && (
              // eslint-disable-next-line @next/next/no-img-element -- ảnh base64 đổi mỗi 100 giây, next/image không tối ưu được
              <img
                className={styles.qr}
                src={data.qrImage}
                alt="Mã QR đăng nhập Zalo"
                width={280}
                height={280}
              />
            )}
            {data.status === "error" && data.lastError && (
              <Alert tone="error">{data.lastError}</Alert>
            )}
            {data.status === "error" && logoutButton}
          </section>
        )}

        {data && connected && (
          <>
            <SectionTabs
              label="Bot Zalo"
              options={[...TABS]}
              value={tab}
              onChange={(v) => setTab(TABS.find((t) => t.value === v)?.value ?? "chat")}
            />

            {tab === "chat" && (
              <div className={styles.chat}>
                <ZaloThreadList
                  accountId={accountId}
                  syncedAt={data.groupsSyncedAt}
                  selected={chatTarget}
                  onSelect={setChatTarget}
                  action={
                    <Button
                      variant="ghost"
                      onClick={() => syncGroups.mutate()}
                      disabled={data.groupsSyncPending || syncGroups.isPending}
                      aria-label="Tải lại danh sách nhóm và cá nhân"
                    >
                      <RefreshCw size={16} aria-hidden />
                    </Button>
                  }
                />
                {chatTarget ? (
                  <ZaloChatPane
                    key={chatTargetKey(chatTarget)}
                    target={chatTarget}
                    connected={connected}
                    onBack={() => setChatTarget(null)}
                  />
                ) : (
                  <p className={styles.noChat}>Chưa chọn nhóm hoặc cá nhân.</p>
                )}
              </div>
            )}

            {tab === "notices" && (
              <SectionCard title="Nhóm nhận thông báo" icon={<Bell size={17} />}>
                {routes.isError ? (
                  <ErrorState
                    what="cấu hình thông báo"
                    onRetry={routes.refetch}
                    retrying={routes.isFetching}
                  />
                ) : routes.isPending ? (
                  <SkeletonTable rows={2} columns={2} />
                ) : (
                  <ul className={styles.notices}>
                    {routes.data.map((route) => (
                      <li key={route.kind} className={styles.notice}>
                        <div className={styles.noticeText}>
                          <span className={styles.noticeLabel}>
                            {ZALO_NOTIFICATION_LABEL[route.kind]}
                          </span>
                          <span className={styles.noticeGroups}>
                            {route.groups.length === 0
                              ? "Chưa chọn nhóm"
                              : route.groups.map((g) => g.name).join(", ")}
                          </span>
                        </div>
                        <Button variant="secondary" onClick={() => setEditingKind(route.kind)}>
                          Chọn nhóm
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            )}

            {tab === "recent" && (
              <RankTable
                rows={data.recentOutbox}
                columns={outboxColumns}
                rowKey={(r) => r.id}
                defaultSort="createdAt"
                caption="Tin nhắn gửi gần đây"
                emptyText="Chưa gửi tin nhắn nào."
              />
            )}
          </>
        )}
      </main>

      {editingKind && (
        <NotificationGroupsDialog
          key={`${accountId}:${editingKind}`}
          accountId={accountId}
          kind={editingKind}
          initialGroupIds={editingGroups.map((g) => g.id)}
          onClose={() => setEditingKind(null)}
        />
      )}
    </RequirePermission>
  );
}
