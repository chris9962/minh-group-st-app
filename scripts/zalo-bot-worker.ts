/**
 * Worker bot Zalo chạy bằng tài khoản Zalo cá nhân qua zca-js (2026-09-25).
 *
 * Worker làm bốn việc:
 *   1. Đăng nhập bằng phiên đã lưu. Phiên hỏng thì tạo mã QR, ghi vào
 *      `zalo_bot_state` để màn Bot Zalo hiện ra cho người quản trị quét.
 *   2. Nghe tin nhắn riêng và tin nhắn nhóm, trả lời lệnh ở
 *      `src/server/zalo/commands.ts`.
 *   3. Gửi tin nhắn app đưa vào hàng chờ `zalo_outbox`. Tin theo số điện thoại
 *      thì tra uid trước, lưu ở `zalo_contacts` cho lần sau.
 *   4. Quên phiên khi màn Bot Zalo bấm đăng xuất. zca-js không có API đăng
 *      xuất, nên thiết bị vẫn hiện trong mục quản lý thiết bị của app Zalo.
 *   5. Tải danh sách nhóm, và mỗi phút gửi thông báo tự động tới nhóm đã cấu
 *      hình ở màn Bot Zalo. Điều kiện và nội dung ở `src/server/zalo/notifications.ts`.
 *
 * Phiên (cookie, IMEI, user agent) lưu ở `ZALO_SESSION_FILE`, mặc định
 * `.zalo/credentials.json`, ngoài git. File này thay cho mật khẩu Zalo.
 *
 * Mỗi tài khoản Zalo chỉ giữ một listener. Mở Zalo Web bằng cùng tài khoản là
 * worker mất kết nối, và ngược lại.
 *
 * Chạy: bun run zalo:worker
 * Trên máy chủ: container `mgst-zalo-worker`, dựng bằng `deploy/worker-zalo.sh`.
 *
 * Cờ:
 *   --check   kiểm kết nối database và các bảng của migration 0103, 0104, 0108 rồi
 *             thoát, không đăng nhập Zalo. Script deploy dùng để thử image.
 */

import fs from "node:fs";
import path from "node:path";
import {
  LoginQRCallbackEventType,
  ThreadType,
  Zalo,
  ZaloApiLoginQRAborted,
  type API,
  type Credentials,
  type Message,
} from "zca-js";
import { ZaloNotificationKind } from "../src/lib/api/zaloBot";
import { replyToCommand } from "../src/server/zalo/commands";
import { collectZaloNotice } from "../src/server/zalo/notifications";
import {
  beatZaloHeartbeat,
  currentZaloAccountId,
  enqueueZaloGroupText,
  finishZaloOutbox,
  forgetZaloContact,
  markZaloWorkerStopped,
  pendingZaloOutbox,
  replaceZaloGroups,
  routedZaloGroupIds,
  saveZaloContacts,
  takeZaloGroupsSyncRequest,
  takeZaloLogoutRequest,
  toLocalPhone,
  writeZaloState,
  zaloContactUid,
  zaloGroupOptions,
} from "../src/server/zaloBot";

const CREDENTIALS_PATH = path.resolve(
  process.env.ZALO_SESSION_FILE ?? ".zalo/credentials.json",
);
const POLL_MS = 3000;
const HEARTBEAT_MS = 30_000;
const OUTBOX_BATCH = 10;
const GROUP_INFO_BATCH = 50;
const NOTICE_EVERY_MS = 60_000;
const RELOGIN_MS = 60_000;
/** Mã 3000 và 3003: nơi khác đang mở Zalo Web. Nối lại sớm là giành kết nối qua lại với nơi đó. */
const KICK_CODES = new Set([3000, 3003]);
const KICKED_RELOGIN_MS = 5 * 60_000;

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

const describeError = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

let stopping = false;
let logoutRequested = false;
/** Kết thúc giai đoạn đang chờ: chờ quét QR, phiên đang nghe, hoặc lượt nghỉ trước khi đăng nhập lại. */
let interrupt: (() => void) | null = null;

function readCredentials(): Credentials | null {
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8")) as Credentials;
  } catch {
    return null;
  }
}

function saveCredentials(api: API): void {
  const ctx = api.getContext();
  const credentials: Credentials = {
    cookie: ctx.cookie.toJSON()?.cookies ?? [],
    imei: ctx.imei,
    userAgent: ctx.userAgent,
  };
  fs.mkdirSync(path.dirname(CREDENTIALS_PATH), { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials), { mode: 0o600 });
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      interrupt = null;
      resolve();
    };
    const timer = setTimeout(done, ms);
    interrupt = done;
  });
}

async function login(): Promise<API> {
  const zalo = new Zalo({ selfListen: false, checkUpdate: false, logging: false });
  const saved = readCredentials();
  if (saved) {
    try {
      return await zalo.login(saved);
    } catch (e) {
      log(`Phiên đã lưu không đăng nhập được: ${describeError(e)}. Chuyển sang mã QR.`);
    }
  }

  return zalo.loginQR({ userAgent: saved?.userAgent }, (event) => {
    switch (event.type) {
      case LoginQRCallbackEventType.QRCodeGenerated:
        interrupt = event.actions.abort;
        void writeZaloState({ status: "waiting-qr", qrImage: event.data.image, lastError: null })
          .then(() => log("Có mã QR mới trên màn Bot Zalo."))
          .catch((e) => log(`Không ghi được mã QR: ${describeError(e)}`));
        break;
      case LoginQRCallbackEventType.QRCodeScanned:
        void writeZaloState({ status: "qr-scanned", qrImage: null }).catch((e) =>
          log(`Không ghi được trạng thái: ${describeError(e)}`),
        );
        log(`${event.data.display_name} đã quét mã, chờ xác nhận trên điện thoại.`);
        break;
      // Huỷ lượt này để vòng ngoài thử lại phiên đã lưu trước khi tạo mã mới.
      case LoginQRCallbackEventType.QRCodeExpired:
      case LoginQRCallbackEventType.QRCodeDeclined:
        event.actions.abort();
        break;
    }
  });
}

async function answer(api: API, message: Message): Promise<void> {
  const content = message.data.content;
  if (message.isSelf || typeof content !== "string") return;

  const isGroup = message.type === ThreadType.Group;
  const reply = replyToCommand(content, { threadId: message.threadId, isGroup });
  if (!reply) return;

  try {
    await api.sendMessage({ msg: reply, quote: message.data }, message.threadId, message.type);
    log(`Trả lời "${content.trim()}" ở ${isGroup ? "nhóm" : "người"} ${message.threadId}.`);
  } catch (e) {
    log(`Không trả lời được ${message.threadId}: ${describeError(e)}`);
  }
}

/** Số điện thoại → uid của mọi bạn bè có số, lưu luôn vào `zalo_contacts`. */
async function loadFriends(api: API, accountId: string): Promise<Map<string, string>> {
  const byPhone = new Map<string, { uid: string; name: string }>();
  try {
    for (const f of await api.getAllFriends()) {
      if (f.phoneNumber && f.userId)
        byPhone.set(toLocalPhone(f.phoneNumber), {
          uid: f.userId,
          name: f.displayName || f.zaloName || "",
        });
    }
    await saveZaloContacts(accountId, [...byPhone].map(([phone, c]) => ({ phone, ...c })));
  } catch (e) {
    log(`Không đọc được danh sách bạn bè: ${describeError(e)}`);
  }
  return new Map([...byPhone].map(([phone, c]) => [phone, c.uid]));
}

async function uidForPhone(
  api: API,
  accountId: string,
  phone: string,
  friendUid: (phone: string) => Promise<string | undefined>,
): Promise<string | null> {
  const saved = await zaloContactUid(accountId, phone);
  if (saved) return saved;
  // findUser bị Zalo giới hạn số lần mỗi ngày, nên tra danh sách bạn bè trước.
  const friend = await friendUid(phone);
  if (friend) return friend;
  const found = await api.findUser(phone);
  if (!found?.uid) return null;
  await saveZaloContacts(accountId, [
    { phone, uid: found.uid, name: found.display_name || found.zalo_name || "" },
  ]);
  return found.uid;
}

async function sendOutbox(api: API, accountId: string): Promise<void> {
  let friends: Promise<Map<string, string>> | null = null;
  const friendUid = async (phone: string) => {
    friends ??= loadFriends(api, accountId);
    return (await friends).get(phone);
  };

  for (const job of await pendingZaloOutbox(OUTBOX_BATCH)) {
    let threadId = job.threadId;
    let error: string | null = null;
    try {
      threadId ??= job.phone ? await uidForPhone(api, accountId, job.phone, friendUid) : null;
      if (!threadId) throw new Error(`Không tìm thấy tài khoản Zalo của số ${job.phone}`);
      const type = job.threadType === "group" ? ThreadType.Group : ThreadType.User;
      await api.sendMessage(job.body, threadId, type);
    } catch (e) {
      error = describeError(e) || "Không rõ lỗi";
      // uid đã lưu có thể cũ, ví dụ người đó đổi tài khoản Zalo. Lần sau tra lại.
      if (job.phone) await forgetZaloContact(accountId, job.phone);
    }
    await finishZaloOutbox(job.id, error, threadId);
    log(`Hàng chờ ${job.id} → ${threadId ?? job.phone}: ${error ? `lỗi ${error}` : "đã gửi"}.`);
  }
}

/** Tải nhóm và bạn bè có số điện thoại. Bạn bè lưu trước, vì màn Bot Zalo đọc lại khi thấy giờ tải nhóm đổi. */
async function syncGroups(api: API, accountId: string): Promise<void> {
  const friends = await loadFriends(api, accountId);
  log(`Đã tải ${friends.size} bạn bè có số điện thoại.`);

  const { gridVerMap } = await api.getAllGroups();
  const ids = Object.keys(gridVerMap);
  const groups: { id: string; name: string; memberCount: number }[] = [];
  for (let i = 0; i < ids.length; i += GROUP_INFO_BATCH) {
    const { gridInfoMap } = await api.getGroupInfo(ids.slice(i, i + GROUP_INFO_BATCH));
    for (const [id, info] of Object.entries(gridInfoMap)) {
      groups.push({ id, name: info.name || id, memberCount: info.totalMember ?? 0 });
    }
  }
  await replaceZaloGroups(accountId, groups);
  log(`Đã tải ${groups.length} nhóm.`);
}

async function queueNotices(accountId: string): Promise<void> {
  for (const kind of ZaloNotificationKind.options) {
    const groupIds = await routedZaloGroupIds(accountId, kind);
    if (groupIds.length === 0) continue;
    const text = await collectZaloNotice(kind);
    if (!text) continue;
    await enqueueZaloGroupText(groupIds, text);
    log(`Thông báo ${kind} vào hàng chờ cho ${groupIds.length} nhóm.`);
  }
}

/** Nghe tới khi listener đóng hẳn. Trả `null` khi bị `interrupt` cắt ngang. */
async function runSession(api: API): Promise<{ code: number; reason: string } | null> {
  const accountId = api.getOwnId();
  let accountName = "";
  try {
    const { profile } = await api.fetchAccountInfo();
    accountName = profile.displayName || profile.zaloName;
  } catch (e) {
    log(`Không đọc được tên tài khoản: ${describeError(e)}`);
  }
  saveCredentials(api);
  await writeZaloState({ status: "connected", qrImage: null, accountId, accountName, lastError: null });
  log(`Đã đăng nhập ${accountName || accountId}.`);
  await takeZaloGroupsSyncRequest();
  await syncGroups(api, accountId).catch((e) =>
    log(`Không tải được danh sách nhóm: ${describeError(e)}`),
  );

  return new Promise((resolve) => {
    let done = false;
    let busy = false;
    let lastNoticeAt = 0;

    const timer = setInterval(async () => {
      if (busy || done) return;
      busy = true;
      try {
        if (await takeZaloGroupsSyncRequest()) await syncGroups(api, accountId);
        if (Date.now() - lastNoticeAt >= NOTICE_EVERY_MS) {
          lastNoticeAt = Date.now();
          await queueNotices(accountId);
        }
        await sendOutbox(api, accountId);
      } catch (e) {
        log(`Lỗi trong vòng quét: ${describeError(e)}`);
      } finally {
        busy = false;
      }
    }, POLL_MS);

    const finish = (result: { code: number; reason: string } | null) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      interrupt = null;
      api.listener.stop();
      resolve(result);
    };
    interrupt = () => finish(null);

    api.listener.on("connected", () => log("Listener đã kết nối."));
    api.listener.on("disconnected", (code, reason) =>
      log(`Listener mất kết nối (mã ${code}${reason ? `: ${reason}` : ""}).`),
    );
    api.listener.on("closed", (code, reason) => finish({ code, reason }));
    api.listener.on("error", (e) => log(`Listener báo lỗi: ${describeError(e)}`));
    api.listener.on("message", (message) => void answer(api, message));
    api.listener.start({ retryOnClose: true });
  });
}

async function forgetAccount(): Promise<void> {
  logoutRequested = false;
  fs.rmSync(CREDENTIALS_PATH, { force: true });
  await writeZaloState({
    status: "offline",
    qrImage: null,
    accountId: null,
    accountName: null,
    lastError: null,
  });
  log("Đã xoá phiên theo yêu cầu đăng xuất từ màn Bot Zalo.");
}

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  if (process.argv.includes("--check")) {
    await currentZaloAccountId();
    await zaloGroupOptions("");
    await routedZaloGroupIds("", "insurance-certificate-overdue");
    await zaloContactUid("", "");
    log(`Database và bảng Zalo đạt. Phiên lưu ở ${CREDENTIALS_PATH}.`);
    return;
  }

  const stop = () => {
    if (stopping) return;
    stopping = true;
    log("Nhận tín hiệu dừng.");
    interrupt?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await writeZaloState({ status: "offline", qrImage: null, lastError: null });
  const heartbeat = setInterval(() => {
    beatZaloHeartbeat().catch((e) => log(`Không ghi được nhịp tim: ${describeError(e)}`));
  }, HEARTBEAT_MS);

  let checkingLogout = false;
  const logoutPoll = setInterval(async () => {
    if (checkingLogout) return;
    checkingLogout = true;
    try {
      if (await takeZaloLogoutRequest()) {
        logoutRequested = true;
        interrupt?.();
      }
    } catch (e) {
      log(`Không đọc được yêu cầu đăng xuất: ${describeError(e)}`);
    } finally {
      checkingLogout = false;
    }
  }, POLL_MS);

  while (!stopping) {
    if (logoutRequested) {
      await forgetAccount();
      continue;
    }

    let api: API;
    try {
      api = await login();
    } catch (e) {
      interrupt = null;
      if (stopping || logoutRequested || e instanceof ZaloApiLoginQRAborted) continue;
      const reason = `Đăng nhập lỗi: ${describeError(e)}`;
      log(reason);
      await writeZaloState({ status: "error", qrImage: null, lastError: reason });
      await pause(RELOGIN_MS);
      continue;
    }
    interrupt = null;
    if (stopping || logoutRequested) continue;

    const closed = await runSession(api);
    if (!closed) continue;

    const kicked = KICK_CODES.has(closed.code);
    const reason = kicked
      ? "Tài khoản đang mở Zalo Web ở nơi khác."
      : `Listener đóng (mã ${closed.code}${closed.reason ? `: ${closed.reason}` : ""}).`;
    log(reason);
    await writeZaloState({ status: "error", lastError: reason });
    await pause(kicked ? KICKED_RELOGIN_MS : RELOGIN_MS);
  }

  clearInterval(heartbeat);
  clearInterval(logoutPoll);
  await markZaloWorkerStopped();
  log("Worker dừng.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
