import { and, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { db } from "./db/client";
import { pushSubscriptions } from "./db/schema";

/**
 * Thông báo đẩy qua Web Push — chuẩn chung của mọi trình duyệt.
 *
 * Một bộ khoá VAPID phục vụ cả iPhone, Android lẫn máy tính. Không cần tài
 * khoản nhà phát triển của Apple, không mất phí.
 *
 * ⚠️ TRÊN IPHONE, người dùng phải thêm trang vào Màn hình chính trước. Mở trong
 * tab Safari thì `Notification.requestPermission` chạy được nhưng không máy nào
 * nhận được gói tin. Đây là giới hạn của Apple từ iOS 16.4.
 */

/** Ai chịu trách nhiệm nếu dịch vụ đẩy cần liên hệ. Chuẩn đòi `mailto:` hoặc địa chỉ web. */
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@mgst.com.vn";

export type PushMessage = {
  title: string;
  body: string;
  /** Đường dẫn mở ra khi người dùng bấm vào thông báo. */
  url?: string;
  /** Cùng `tag` thì thông báo sau thay chỗ thông báo trước trên màn hình. */
  tag?: string;
};

/**
 * Đọc cấu hình, trả `null` khi chưa cấu hình.
 *
 * Trả `null` chứ không ném lỗi: máy chưa đặt khoá vẫn phải chạy được mọi thứ
 * khác. Nơi gọi tự quyết định im lặng bỏ qua hay báo cho người dùng.
 */
function readVapid(): { publicKey: string; privateKey: string } | null {
  const publicKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY ?? "").trim();
  return publicKey && privateKey ? { publicKey, privateKey } : null;
}

export const pushConfigured = (): boolean => readVapid() !== null;

/**
 * Khoá công khai cho trình duyệt đăng ký. Chuỗi rỗng nghĩa là chưa cấu hình.
 *
 * Đòi ĐỦ CẢ CẶP mới trả về, vì `readVapid` trả `null` khi thiếu khoá riêng.
 * Thiếu khoá riêng thì máy chủ không gửi được gói tin nào, nên cho trình duyệt
 * đăng ký chỉ dựng thêm một dòng chết trong `push_subscriptions`.
 */
export const vapidPublicKey = (): string => readVapid()?.publicKey ?? "";

export type SubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
};

/**
 * Ghi đăng ký của MỘT thiết bị.
 *
 * Ghi đè theo `endpoint` chứ không thêm dòng mới: trình duyệt trả đúng chuỗi cũ
 * cho cùng một máy, nên thêm mới là mỗi lần mở app lại sinh một dòng rác.
 *
 * `user_id` nằm trong phần ghi đè vì một máy dùng chung đổi người đăng nhập thì
 * thông báo phải theo người mới, không theo người cũ.
 */
export async function savePushSubscription(
  userId: string,
  input: SubscriptionInput,
): Promise<void> {
  const now = new Date();
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent.slice(0, 300),
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent.slice(0, 300),
        lastSeenAt: now,
      },
    });
}

/** Người dùng tắt thông báo trên đúng máy đang dùng. */
export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(
      and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)),
    );
}

export async function countPushSubscriptions(userId: string): Promise<number> {
  const rows = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return rows.length;
}

export type PushResult = { sent: number; removed: number; failed: number };

/**
 * Gửi tới MỌI thiết bị của một người.
 *
 * Dịch vụ đẩy trả 404 hoặc 410 khi đăng ký đã chết — người dùng gỡ ứng dụng,
 * hoặc iOS tự huỷ vì lâu không mở. Hai mã đó là câu trả lời dứt khoát, nên xoá
 * dòng ngay. Mã khác thì giữ lại và thử ở lần sau: 429 và 5xx là sự cố tạm thời
 * bên dịch vụ đẩy, xoá đi là mất đăng ký của một máy vẫn còn sống.
 */
export async function sendPushToUser(userId: string, message: PushMessage): Promise<PushResult> {
  const vapid = readVapid();
  if (!vapid) return { sent: 0, removed: 0, failed: 0 };

  webpush.setVapidDetails(SUBJECT, vapid.publicKey, vapid.privateKey);

  const rows = await db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  const payload = JSON.stringify(message);
  const dead: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload,
        );
        sent += 1;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(row.endpoint);
        else failed += 1;
      }
    }),
  );

  if (dead.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, dead));
  }

  return { sent, removed: dead.length, failed };
}
