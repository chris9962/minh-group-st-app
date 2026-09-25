"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, MessageCircle, Send, Smartphone, Users } from "lucide-react";
import { useRef, useState } from "react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyValue";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { NotificationGroupsDialog } from "@/components/zalo/NotificationGroupsDialog";
import { EMPTY_PAGE, PAGE_SIZE } from "@/lib/api/pagination";
import {
  fetchZaloBot,
  fetchZaloGroups,
  fetchZaloNotificationRoutes,
  logoutZaloBot,
  sendZaloMessage,
  syncZaloGroups,
  ZALO_BODY_MAX,
  ZALO_BOT_STATUS_LABEL,
  ZALO_NOTIFICATION_LABEL,
  ZALO_OUTBOX_STATUS_LABEL,
  ZALO_THREAD_TYPE_LABEL,
  ZaloSendBody,
  ZaloThreadType,
  type ZaloBotStatus,
  type ZaloGroupRow,
  type ZaloGroupSort,
  type ZaloNotificationKind,
  type ZaloOutboxRow,
  type ZaloOutboxStatus,
} from "@/lib/api/zaloBot";
import { formatCount, formatDateTime } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
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

const THREAD_TYPE_OPTIONS = ZaloThreadType.options.map((value) => ({
  value,
  label: ZALO_THREAD_TYPE_LABEL[value],
}));

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
    render: (r) => `${ZALO_THREAD_TYPE_LABEL[r.threadType]} ${r.threadId}`,
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

type SendErrors = Partial<Record<"threadId" | "body", string>>;

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

  const [groupSearch, setGroupSearch] = useState("");
  const groupQuery = useDebouncedValue(groupSearch);
  const [groupPage, setGroupPage] = useState(0);
  const [groupSort, setGroupSort] = useState<ZaloGroupSort>("name");
  const [groupDir, setGroupDir] = useState<"asc" | "desc">("asc");

  const groups = useQuery({
    // `groupsSyncedAt` trong khoá: worker tải xong lượt mới thì bảng tự đọc lại.
    queryKey: [
      "zalo-bot",
      "groups",
      data?.accountId,
      data?.groupsSyncedAt,
      groupPage,
      groupSort,
      groupDir,
      groupQuery,
    ],
    queryFn: () =>
      fetchZaloGroups({ page: groupPage, sort: groupSort, dir: groupDir }, groupQuery),
    enabled: canView,
    placeholderData: keepPreviousData,
  });

  const accountId = data?.accountId ?? "";
  // Cấu hình đi theo tài khoản Zalo: đổi tài khoản là đổi khoá, màn đọc lại cấu hình của tài khoản mới.
  const routes = useQuery({
    queryKey: ["zalo-bot", "notifications", accountId],
    queryFn: fetchZaloNotificationRoutes,
    enabled: canView && !!accountId,
  });
  const [editingKind, setEditingKind] = useState<ZaloNotificationKind | null>(null);
  const editingGroups = routes.data?.find((r) => r.kind === editingKind)?.groups ?? [];

  const [threadType, setThreadType] = useState<ZaloThreadType>("group");
  const [threadId, setThreadId] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<SendErrors>({});

  const send = useMutation({
    mutationFn: sendZaloMessage,
    onSuccess: () => {
      setBody("");
      toast.ok("Đã đưa tin nhắn vào hàng chờ gửi.");
      void queryClient.invalidateQueries({ queryKey: ["zalo-bot"] });
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đưa được tin nhắn vào hàng chờ.")),
  });

  const syncGroups = useMutation({
    mutationFn: syncZaloGroups,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["zalo-bot"] }),
    onError: (e) => toast.fail(errorMessage(e, "Không gửi được yêu cầu tải lại danh sách nhóm.")),
  });

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const pickGroup = (group: ZaloGroupRow) => {
    setThreadType("group");
    setThreadId(group.id);
    setErrors({});
    bodyRef.current?.focus();
  };

  const groupColumns: RankColumn<ZaloGroupRow>[] = [
    { key: "name", label: "Tên nhóm", sortable: true, render: (r) => r.name },
    {
      key: "id",
      label: "Thread ID",
      render: (r) => (
        <span className={styles.idCell}>
          <span className="tabular-nums">{r.id}</span>
          <CopyButton value={r.id} label={`Thread ID của nhóm ${r.name}: ${r.id}`} quiet />
        </span>
      ),
    },
    {
      key: "memberCount",
      label: "Thành viên",
      sortable: true,
      align: "left",
      render: (r) => formatCount(r.memberCount),
    },
    {
      key: "pick",
      label: "Gửi thử",
      render: (r) => (
        <Button variant="ghost" onClick={() => pickGroup(r)} aria-label={`Chọn nhóm ${r.name} để gửi thử`}>
          Chọn
        </Button>
      ),
    },
  ];

  const logout = useMutation({
    mutationFn: logoutZaloBot,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["zalo-bot"] }),
    onError: (e) => toast.fail(errorMessage(e, "Không gửi được yêu cầu đăng xuất.")),
  });

  const onSend = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ZaloSendBody.safeParse({ threadType, threadId, body });
    if (!parsed.success) {
      const next: SendErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if ((field === "threadId" || field === "body") && !next[field]) next[field] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    send.mutate(parsed.data);
  };

  const connected = !!data?.workerAlive && data.status === "connected";

  return (
    <RequirePermission module="system" action="view-ops">
      <TopBar title="Bot Zalo" keepTitleOnMobile />

      <main className={styles.body}>
        {isPending && <SkeletonTable rows={4} columns={3} />}
        {isError && <ErrorState what="trạng thái bot Zalo" onRetry={refetch} retrying={isFetching} />}

        {!isPending && !isError && data && (
          <>
            <SectionCard title="Tài khoản Zalo" icon={<Smartphone size={17} />}>
              {!data.workerAlive ? (
                <Alert tone="warning">Worker bot Zalo không chạy.</Alert>
              ) : (
                <div className={styles.account}>
                  <div className={styles.statusRow}>
                    <StatusTag tone={STATUS_TONE[data.status]}>
                      {ZALO_BOT_STATUS_LABEL[data.status]}
                    </StatusTag>
                    {data.status === "connected" && (
                      <span>
                        {data.accountName || "Không rõ tên"} - ID {data.accountId}
                      </span>
                    )}
                  </div>

                  {data.status === "error" && data.lastError && (
                    <Alert tone="error">{data.lastError}</Alert>
                  )}

                  {data.qrImage && (
                    // eslint-disable-next-line @next/next/no-img-element -- ảnh base64 đổi mỗi 100 giây, next/image không tối ưu được
                    <img
                      className={styles.qr}
                      src={data.qrImage}
                      alt="Mã QR đăng nhập Zalo"
                      width={240}
                      height={240}
                    />
                  )}

                  {(data.status === "connected" || data.status === "error") && (
                    <div>
                      <Button
                        variant="secondary"
                        onClick={() => logout.mutate()}
                        disabled={data.logoutPending || logout.isPending}
                      >
                        {data.logoutPending ? "Đang đăng xuất" : "Đăng xuất"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </SectionCard>

            {accountId && (
              <SectionCard title="Thông báo tự động" icon={<Bell size={17} />}>
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

            <SectionCard
              title="Nhóm Zalo"
              icon={<Users size={17} />}
              meta={
                data.groupsSyncedAt ? `Tải lúc ${formatDateTime(data.groupsSyncedAt)}` : "Chưa tải"
              }
              action={
                <Button
                  variant="ghost"
                  onClick={() => syncGroups.mutate()}
                  disabled={!connected || data.groupsSyncPending || syncGroups.isPending}
                >
                  {data.groupsSyncPending ? "Đang tải lại" : "Tải lại"}
                </Button>
              }
            >
              <div className={styles.searchRow}>
                <SearchField
                  label="Tìm nhóm"
                  placeholder="Tên nhóm hoặc Thread ID"
                  value={groupSearch}
                  onChange={(v) => {
                    setGroupSearch(v);
                    setGroupPage(0);
                  }}
                />
              </div>
              {groups.isError ? (
                <ErrorState
                  what="danh sách nhóm"
                  onRetry={groups.refetch}
                  retrying={groups.isFetching}
                />
              ) : groups.isPending ? (
                <SkeletonTable rows={6} columns={4} />
              ) : (
                <RankTable
                  rows={(groups.data ?? EMPTY_PAGE).rows}
                  columns={groupColumns}
                  rowKey={(r) => r.id}
                  defaultSort="name"
                  caption="Nhóm Zalo của tài khoản bot"
                  emptyText={groupQuery ? "Không nhóm nào khớp." : "Chưa có nhóm nào."}
                  server={{
                    sort: groupSort,
                    dir: groupDir,
                    page: groupPage,
                    total: groups.data?.total ?? 0,
                    pageSize: PAGE_SIZE,
                    onSortChange: (sort, dir) => {
                      setGroupSort(sort === "memberCount" ? "memberCount" : "name");
                      setGroupDir(dir);
                      setGroupPage(0);
                    },
                    onPageChange: setGroupPage,
                  }}
                />
              )}
            </SectionCard>

            <SectionCard title="Gửi thử tin nhắn" icon={<Send size={17} />}>
              <form className={styles.form} onSubmit={onSend} noValidate>
                <Select
                  label="Gửi tới"
                  value={threadType}
                  options={THREAD_TYPE_OPTIONS}
                  onChange={(v) => setThreadType(ZaloThreadType.catch("group").parse(v))}
                />
                <TextField
                  label="Thread ID"
                  required
                  inputMode="numeric"
                  value={threadId}
                  onChange={(e) => setThreadId(e.target.value)}
                  error={errors.threadId}
                />
                <TextArea
                  ref={bodyRef}
                  label="Nội dung"
                  required
                  rows={3}
                  maxLength={ZALO_BODY_MAX}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  error={errors.body}
                />
                <div>
                  <Button type="submit" disabled={!connected || send.isPending}>
                    Gửi
                  </Button>
                </div>
              </form>
            </SectionCard>

            <SectionCard title="Tin nhắn gửi gần đây" icon={<MessageCircle size={17} />}>
              <RankTable
                rows={data.recentOutbox}
                columns={outboxColumns}
                rowKey={(r) => r.id}
                defaultSort="createdAt"
                caption="Tin nhắn gửi gần đây"
                emptyText="Chưa gửi tin nhắn nào."
              />
            </SectionCard>
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
