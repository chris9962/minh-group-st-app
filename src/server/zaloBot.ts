import { and, asc, count, desc, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { Page } from "@/lib/api/pagination";
import {
  ZALO_RECENT_OUTBOX,
  ZALO_THREAD_MESSAGES,
  ZALO_WORKER_STALE_SECONDS,
  ZaloBotStatus,
  ZaloNotificationKind,
  ZaloOutboxStatus,
  ZaloThreadType,
  type ZaloBotSummary,
  type ZaloContactRow,
  type ZaloContactSort,
  type ZaloGroupOption,
  type ZaloGroupRow,
  type ZaloGroupSort,
  type ZaloNotificationRoute,
  type ZaloOutboxRow,
  type ZaloSendBody,
} from "@/lib/api/zaloBot";
import { digitsOnly } from "@/lib/format";
import { searchTerms } from "@/lib/search";
import type { User } from "@/lib/types";
import { db } from "./db/client";
import {
  zaloBotState,
  zaloContacts,
  zaloGroups,
  zaloNotificationRoutes,
  zaloOutbox,
} from "./db/schema";
import type { PageArgs } from "./pagination";

/**
 * Bot Zalo, phần đọc ghi database. Cả app Next lẫn worker `zalo:worker` dùng
 * file này. File này KHÔNG import zca-js: app không được giữ phiên Zalo.
 */

const STATE_ID = 1;

export async function zaloBotSummary(): Promise<ZaloBotSummary> {
  const [state] = await db.select().from(zaloBotState).where(eq(zaloBotState.id, STATE_ID));
  const recent = await db
    .select()
    .from(zaloOutbox)
    .orderBy(desc(zaloOutbox.createdAt))
    .limit(ZALO_RECENT_OUTBOX);

  const heartbeat = state?.heartbeatAt?.getTime() ?? 0;
  const workerAlive = Date.now() - heartbeat < ZALO_WORKER_STALE_SECONDS * 1000;
  const status = ZaloBotStatus.catch("offline").parse(state?.status);

  return {
    status,
    workerAlive,
    // Worker chết giữa lúc chờ quét thì mã trong bảng đã hết hạn, quét cũng vô ích.
    qrImage:
      workerAlive && status === "waiting-qr" && state?.qrImage
        ? `data:image/png;base64,${state.qrImage}`
        : "",
    accountId: state?.accountId ?? "",
    accountName: state?.accountName ?? "",
    lastError: state?.lastError ?? "",
    logoutPending: !!state?.logoutRequestedAt,
    groupsSyncedAt: state?.groupsSyncedAt?.toISOString() ?? "",
    groupsSyncPending: !!state?.groupsSyncRequestedAt,
    recentOutbox: recent.map(toOutboxRow),
  };
}

function toOutboxRow(r: typeof zaloOutbox.$inferSelect): ZaloOutboxRow {
  return {
    id: r.id,
    threadId: r.threadId ?? "",
    phone: r.phone ?? "",
    threadType: ZaloThreadType.catch("group").parse(r.threadType),
    body: r.body,
    status: ZaloOutboxStatus.catch("failed").parse(r.status),
    error: r.error ?? "",
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Tin đã gửi tới một nơi nhận, cũ trước mới sau. Tin gửi theo số và tin gửi
 * theo uid của số đó là cùng một người, nên đọc cả hai.
 */
export async function zaloThreadMessages(
  accountId: string,
  to: { threadId: string } | { phone: string },
): Promise<ZaloOutboxRow[]> {
  const known = await db
    .select({ phone: zaloContacts.phone, uid: zaloContacts.uid })
    .from(zaloContacts)
    .where(
      and(
        eq(zaloContacts.accountId, accountId),
        "phone" in to ? eq(zaloContacts.phone, to.phone) : eq(zaloContacts.uid, to.threadId),
      ),
    );
  const threadIds = "phone" in to ? known.map((k) => k.uid) : [to.threadId];
  const phones = "phone" in to ? [to.phone] : known.map((k) => k.phone);

  const rows = await db
    .select()
    .from(zaloOutbox)
    .where(
      or(
        threadIds.length > 0 ? inArray(zaloOutbox.threadId, threadIds) : undefined,
        phones.length > 0 ? inArray(zaloOutbox.phone, phones) : undefined,
      ),
    )
    .orderBy(desc(zaloOutbox.createdAt))
    .limit(ZALO_THREAD_MESSAGES);
  return rows.reverse().map(toOutboxRow);
}

/** Mỗi từ khớp tên không dấu, một đoạn số điện thoại, hoặc một đoạn uid. */
function contactSearchWhere(raw: string): SQL | undefined {
  const terms = searchTerms(raw.trim());
  if (terms.length === 0) return undefined;
  return and(
    ...terms.map((term) =>
      or(
        sql`mgst_normalize(${zaloContacts.name}) like '%' || mgst_normalize(${likeEscape(term)}) || '%' escape '\\'`,
        sql`${zaloContacts.phone} like '%' || ${likeEscape(term)} || '%' escape '\\'`,
        sql`${zaloContacts.uid} like '%' || ${likeEscape(term)} || '%' escape '\\'`,
      ),
    ),
  );
}

const CONTACT_SORT_COLUMN = {
  name: zaloContacts.name,
  phone: zaloContacts.phone,
} as const;

export async function listZaloContacts(
  accountId: string,
  search: string,
  args: PageArgs<ZaloContactSort>,
): Promise<Page<ZaloContactRow>> {
  const where = and(eq(zaloContacts.accountId, accountId), contactSearchWhere(search));
  const order = args.dir === "asc" ? asc : desc;

  const rows = await db
    .select({ phone: zaloContacts.phone, uid: zaloContacts.uid, name: zaloContacts.name })
    .from(zaloContacts)
    .where(where)
    .orderBy(order(CONTACT_SORT_COLUMN[args.sort]), asc(zaloContacts.phone))
    .limit(args.limit)
    .offset(args.offset);
  const [{ total }] = await db.select({ total: count() }).from(zaloContacts).where(where);

  return { rows, total };
}

export async function requestZaloLogout(): Promise<void> {
  await db
    .update(zaloBotState)
    .set({ logoutRequestedAt: new Date(), updatedAt: new Date() })
    .where(eq(zaloBotState.id, STATE_ID));
}

/** ID Zalo của tài khoản đang đăng nhập trong worker. Rỗng khi chưa đăng nhập. */
export async function currentZaloAccountId(): Promise<string> {
  const [state] = await db
    .select({ accountId: zaloBotState.accountId })
    .from(zaloBotState)
    .where(eq(zaloBotState.id, STATE_ID));
  return state?.accountId ?? "";
}

export async function requestZaloGroupsSync(): Promise<void> {
  await db
    .update(zaloBotState)
    .set({ groupsSyncRequestedAt: new Date(), updatedAt: new Date() })
    .where(eq(zaloBotState.id, STATE_ID));
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Mỗi từ khớp tên nhóm không dấu hoặc một đoạn của Thread ID. */
function groupSearchWhere(raw: string): SQL | undefined {
  const terms = searchTerms(raw.trim());
  if (terms.length === 0) return undefined;
  return and(
    ...terms.map((term) =>
      or(
        sql`${zaloGroups.searchName} like '%' || mgst_normalize(${likeEscape(term)}) || '%' escape '\\'`,
        sql`${zaloGroups.id} like '%' || ${likeEscape(term)} || '%' escape '\\'`,
      ),
    ),
  );
}

const GROUP_SORT_COLUMN = {
  name: zaloGroups.name,
  memberCount: zaloGroups.memberCount,
} as const;

export async function listZaloGroups(
  accountId: string,
  search: string,
  args: PageArgs<ZaloGroupSort>,
): Promise<Page<ZaloGroupRow>> {
  const where = and(eq(zaloGroups.accountId, accountId), groupSearchWhere(search));
  const order = args.dir === "asc" ? asc : desc;

  const rows = await db
    .select({ id: zaloGroups.id, name: zaloGroups.name, memberCount: zaloGroups.memberCount })
    .from(zaloGroups)
    .where(where)
    .orderBy(order(GROUP_SORT_COLUMN[args.sort]), asc(zaloGroups.id))
    .limit(args.limit)
    .offset(args.offset);
  const [{ total }] = await db.select({ total: count() }).from(zaloGroups).where(where);

  return { rows, total };
}

/** Trọn nhóm của một tài khoản cho hộp chọn nhóm. Danh sách đóng, do Zalo quyết định. */
export async function zaloGroupOptions(accountId: string): Promise<ZaloGroupOption[]> {
  return db
    .select({ id: zaloGroups.id, name: zaloGroups.name })
    .from(zaloGroups)
    .where(eq(zaloGroups.accountId, accountId))
    .orderBy(asc(zaloGroups.name), asc(zaloGroups.id));
}

/** Nhóm nhận từng loại thông báo. Nhóm tài khoản đã rời không hiện, dù cấu hình còn giữ. */
export async function zaloNotificationRoutesFor(accountId: string): Promise<ZaloNotificationRoute[]> {
  const rows = await db
    .select({ kind: zaloNotificationRoutes.kind, id: zaloGroups.id, name: zaloGroups.name })
    .from(zaloNotificationRoutes)
    .innerJoin(
      zaloGroups,
      and(
        eq(zaloGroups.accountId, zaloNotificationRoutes.accountId),
        eq(zaloGroups.id, zaloNotificationRoutes.groupId),
      ),
    )
    .where(eq(zaloNotificationRoutes.accountId, accountId))
    .orderBy(asc(zaloGroups.name));

  return ZaloNotificationKind.options.map((kind) => ({
    kind,
    groups: rows.filter((r) => r.kind === kind).map(({ id, name }) => ({ id, name })),
  }));
}

export class ZaloRouteError extends Error {}

export async function saveZaloNotificationRoutes(
  actor: User,
  accountId: string,
  kind: ZaloNotificationKind,
  groupIds: string[],
): Promise<void> {
  const unique = [...new Set(groupIds)];
  if (unique.length > 0) {
    const known = await db
      .select({ id: zaloGroups.id })
      .from(zaloGroups)
      .where(and(eq(zaloGroups.accountId, accountId), inArray(zaloGroups.id, unique)));
    if (known.length !== unique.length)
      throw new ZaloRouteError("Có nhóm không thuộc tài khoản Zalo đang đăng nhập");
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(zaloNotificationRoutes)
      .where(
        and(eq(zaloNotificationRoutes.accountId, accountId), eq(zaloNotificationRoutes.kind, kind)),
      );
    if (unique.length > 0)
      await tx
        .insert(zaloNotificationRoutes)
        .values(unique.map((groupId) => ({ accountId, kind, groupId, createdBy: actor.id })));
  });
}

export async function enqueueZaloMessage(actor: User, input: ZaloSendBody): Promise<void> {
  await db.insert(zaloOutbox).values(
    input.target === "phone"
      ? { phone: input.phone, threadType: "user", body: input.body, createdBy: actor.id }
      : { threadId: input.threadId, threadType: input.target, body: input.body, createdBy: actor.id },
  );
}

/** Tin cá nhân theo số điện thoại. Worker tra uid lúc gửi, số không có Zalo thì dòng đó báo lỗi. */
export async function enqueueZaloPhoneText(phones: string[], body: string): Promise<void> {
  const unique = [...new Set(phones.map(toLocalPhone))];
  if (unique.length === 0) return;
  await db
    .insert(zaloOutbox)
    .values(unique.map((phone) => ({ phone, threadType: "user", body })));
}

/** Zalo trả số dạng `84xxxxxxxxx`, app lưu `0xxxxxxxxx`. */
export function toLocalPhone(raw: string): string {
  const d = digitsOnly(raw);
  return d.length === 11 && d.startsWith("84") ? `0${d.slice(2)}` : d;
}

// ─── Phía worker ────────────────────────────────────────────────────────────

export type ZaloStatePatch = {
  status: ZaloBotStatus;
  qrImage?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  lastError?: string | null;
};

export async function writeZaloState(patch: ZaloStatePatch): Promise<void> {
  await db
    .update(zaloBotState)
    .set({ ...patch, heartbeatAt: new Date(), updatedAt: new Date() })
    .where(eq(zaloBotState.id, STATE_ID));
}

/** Worker dừng hẳn. Xoá nhịp tim để màn báo worker không chạy ngay, không đợi 90 giây. */
export async function markZaloWorkerStopped(): Promise<void> {
  await db
    .update(zaloBotState)
    .set({ status: "offline", qrImage: null, heartbeatAt: null, updatedAt: new Date() })
    .where(eq(zaloBotState.id, STATE_ID));
}

export async function beatZaloHeartbeat(): Promise<void> {
  await db
    .update(zaloBotState)
    .set({ heartbeatAt: new Date() })
    .where(eq(zaloBotState.id, STATE_ID));
}

/** Xoá yêu cầu đăng xuất đang chờ. Trả `true` khi có yêu cầu. */
export async function takeZaloLogoutRequest(): Promise<boolean> {
  const rows = await db
    .update(zaloBotState)
    .set({ logoutRequestedAt: null })
    .where(and(eq(zaloBotState.id, STATE_ID), isNotNull(zaloBotState.logoutRequestedAt)))
    .returning({ id: zaloBotState.id });
  return rows.length > 0;
}

/** Xoá yêu cầu tải lại danh sách nhóm. Trả `true` khi có yêu cầu. */
export async function takeZaloGroupsSyncRequest(): Promise<boolean> {
  const rows = await db
    .update(zaloBotState)
    .set({ groupsSyncRequestedAt: null })
    .where(and(eq(zaloBotState.id, STATE_ID), isNotNull(zaloBotState.groupsSyncRequestedAt)))
    .returning({ id: zaloBotState.id });
  return rows.length > 0;
}

export async function replaceZaloGroups(accountId: string, groups: ZaloGroupRow[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(zaloGroups).where(eq(zaloGroups.accountId, accountId));
    if (groups.length > 0)
      await tx.insert(zaloGroups).values(groups.map((g) => ({ ...g, accountId })));
    await tx
      .update(zaloBotState)
      .set({ groupsSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(zaloBotState.id, STATE_ID));
  });
}

/** Nhóm của tài khoản đang nhận loại thông báo này, bỏ nhóm tài khoản đã rời. */
export async function routedZaloGroupIds(
  accountId: string,
  kind: ZaloNotificationKind,
): Promise<string[]> {
  const rows = await db
    .select({ id: zaloGroups.id })
    .from(zaloNotificationRoutes)
    .innerJoin(
      zaloGroups,
      and(
        eq(zaloGroups.accountId, zaloNotificationRoutes.accountId),
        eq(zaloGroups.id, zaloNotificationRoutes.groupId),
      ),
    )
    .where(
      and(eq(zaloNotificationRoutes.accountId, accountId), eq(zaloNotificationRoutes.kind, kind)),
    );
  return rows.map((r) => r.id);
}

/** Thông báo tự động đi qua hàng chờ như tin gửi tay, để hiện trong bảng tin gửi gần đây. */
export async function enqueueZaloGroupText(groupIds: string[], body: string): Promise<void> {
  if (groupIds.length === 0) return;
  await db
    .insert(zaloOutbox)
    .values(groupIds.map((threadId) => ({ threadId, threadType: "group", body })));
}

export type ZaloOutboxJob = {
  id: string;
  threadId: string | null;
  phone: string | null;
  threadType: ZaloThreadType;
  body: string;
};

export async function pendingZaloOutbox(limit: number): Promise<ZaloOutboxJob[]> {
  const rows = await db
    .select({
      id: zaloOutbox.id,
      threadId: zaloOutbox.threadId,
      phone: zaloOutbox.phone,
      threadType: zaloOutbox.threadType,
      body: zaloOutbox.body,
    })
    .from(zaloOutbox)
    .where(eq(zaloOutbox.status, "pending"))
    .orderBy(asc(zaloOutbox.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, threadType: ZaloThreadType.catch("group").parse(r.threadType) }));
}

/** `error` rỗng nghĩa là gửi được. `threadId` là uid worker vừa tra ra cho dòng gửi theo số. */
export async function finishZaloOutbox(
  id: string,
  error: string | null,
  threadId: string | null,
): Promise<void> {
  await db
    .update(zaloOutbox)
    .set(
      error
        ? { status: "failed", error, threadId }
        : { status: "sent", error: null, threadId, sentAt: new Date() },
    )
    .where(eq(zaloOutbox.id, id));
}

export async function zaloContactUid(accountId: string, phone: string): Promise<string | null> {
  const [row] = await db
    .select({ uid: zaloContacts.uid })
    .from(zaloContacts)
    .where(and(eq(zaloContacts.accountId, accountId), eq(zaloContacts.phone, phone)));
  return row?.uid ?? null;
}

export async function saveZaloContacts(
  accountId: string,
  contacts: { phone: string; uid: string; name: string }[],
): Promise<void> {
  if (contacts.length === 0) return;
  await db
    .insert(zaloContacts)
    .values(contacts.map((c) => ({ ...c, accountId })))
    .onConflictDoUpdate({
      target: [zaloContacts.accountId, zaloContacts.phone],
      set: { uid: sql`excluded.uid`, name: sql`excluded.name`, updatedAt: new Date() },
    });
}

export async function forgetZaloContact(accountId: string, phone: string): Promise<void> {
  await db
    .delete(zaloContacts)
    .where(and(eq(zaloContacts.accountId, accountId), eq(zaloContacts.phone, phone)));
}
