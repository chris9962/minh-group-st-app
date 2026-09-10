"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SettingsAction, SettingsGroup, SettingsRow } from "@/components/ui/SettingsList";
import { Switch } from "@/components/ui/Switch";
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABEL,
  NOTIFICATION_KIND_NEEDS,
  type NotificationKind,
  fetchNotificationPrefs,
  saveNotificationPref,
} from "@/lib/api/notificationPrefs";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import {
  fetchPushPublicKey,
  sendTestPush,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/api/push";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./NotificationSettings.module.css";

/**
 * Cài đặt thông báo — một công tắc cho THIẾT BỊ, và một công tắc cho mỗi LOẠI.
 *
 * Hai tầng khác nhau và cố ý tách:
 *
 *   thiết bị  quyền của trình duyệt trên đúng máy này, lưu ở `push_subscriptions`
 *   loại      lựa chọn của người dùng, lưu ở `notification_prefs`, áp cho mọi máy
 *
 * Tắt thiết bị là máy này im, máy khác vẫn nhận. Tắt một loại là loại đó im trên
 * mọi máy.
 *
 * ⚠️ TRÊN IPHONE chỉ chạy khi người dùng đã thêm trang vào Màn hình chính. Mở
 * trong tab Safari thì thiếu hẳn `PushManager`, nên khối hiện dòng hướng dẫn
 * thay cho công tắc. Giới hạn của Apple từ iOS 16.4.
 */

/**
 * Khoá VAPID là base64url; `applicationServerKey` đòi mảng byte.
 *
 * Trả `ArrayBuffer` chứ không trả `Uint8Array`: kiểu của `Uint8Array` trong
 * TypeScript mới mang tham số đệm, và đệm đó có thể là `SharedArrayBuffer` mà
 * `BufferSource` không nhận.
 */
function keyToBytes(base64url: string): ArrayBuffer {
  const padded = base64url.padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), "=");
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

type DeviceState = "dang-doc" | "khong-ho-tro" | "chua-cai-iphone" | "bi-tu-choi" | "tat" | "bat";

/** Safari trên iPhone chỉ mở `PushManager` khi trang chạy từ Màn hình chính. */
const standalone = (): boolean =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (window.navigator as { standalone?: boolean }).standalone === true;

/** Ngoài component vì nó không đọc state nào; để trong thì hook lint từ chối. */
async function save(sub: PushSubscription) {
  const json = sub.toJSON();
  await subscribeToPush({
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
  });
}

export function NotificationSettings() {
  const [device, setDevice] = useState<DeviceState>("dang-doc");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const user = useSession((s) => s.user);

  /**
   * Chỉ bày loại thông báo người này có thể nhận.
   *
   * Nhân viên không có `insurance:handle-fallback` thì không bao giờ nhận
   * "Đơn chuyển sang làm tay", nên bày công tắc đó ra chỉ làm họ tưởng đã bật
   * mà không thấy gì.
   */
  const kinds = NOTIFICATION_KINDS.filter((kind) => {
    const need = NOTIFICATION_KIND_NEEDS[kind];
    return !need || need.actions.some((action) => can(user, need.module, action));
  });

  const { data: prefs } = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: fetchNotificationPrefs,
  });

  /**
   * Khoá công khai hỏi TỪ MÁY CHỦ, không đọc từ `process.env`.
   *
   * Trình duyệt không có `process.env`, nên Next thay biến `NEXT_PUBLIC_*` bằng
   * chuỗi nguyên văn lúc `next build`. Bản dựng của máy chủ chạy trong Docker,
   * nơi `.dockerignore` đã loại `.env.*`, nên chuỗi đóng băng là rỗng và cả khối
   * này biến mất. Máy người viết code không dính vì bản dựng ở đó đọc thẳng
   * `.env.local` trên đĩa. Xem `app/api/push/key/route.ts`.
   *
   * `staleTime: Infinity` vì khoá chỉ đổi khi máy chủ khởi động lại.
   */
  const { data: publicKey, isPending: keyPending } = useQuery({
    queryKey: ["push-key"],
    queryFn: fetchPushPublicKey,
    staleTime: Infinity,
  });

  const savePref = useMutation({
    mutationFn: saveNotificationPref,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-prefs"] }),
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được cài đặt thông báo")),
  });

  useEffect(() => {
    // Chưa đọc xong khoá thì chưa kết luận được máy này nhận thông báo được hay
    // không. `device` vẫn là "dang-doc", và khối chưa vẽ ra.
    if (keyPending) return;

    let alive = true;
    const key = publicKey ?? "";

    async function read() {
      if (!key) return alive && setDevice("khong-ho-tro");
      if (!("serviceWorker" in navigator) || !("Notification" in window)) {
        return alive && setDevice("khong-ho-tro");
      }
      // iPhone mở trong tab Safari: thiếu hẳn `PushManager`.
      if (!("PushManager" in window)) {
        return alive && setDevice(standalone() ? "khong-ho-tro" : "chua-cai-iphone");
      }
      /**
       * Quyền bị chặn từ Cài đặt của máy: dọn luôn dòng trong database.
       *
       * Không dọn thì máy chủ còn giữ một thiết bị đã chết cho tới lượt gửi kế
       * tiếp, và mỗi lượt gửi tốn một lệnh gọi mạng vô ích. Đây là lúc SỚM NHẤT
       * mình biết được, vì dịch vụ đẩy không có đường báo ngược lại.
       */
      if (Notification.permission === "denied") {
        const stale = await navigator.serviceWorker
          .getRegistration()
          .then((r) => r?.pushManager.getSubscription() ?? null)
          .catch(() => null);
        if (stale) await unsubscribeFromPush({ endpoint: stale.endpoint }).catch(() => {});
        return alive && setDevice("bi-tu-choi");
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      if (!alive) return;
      setDevice(existing ? "bat" : "tat");

      /**
       * Đăng ký cũ vẫn còn thì gửi lại lên máy chủ.
       *
       * iOS tự huỷ đăng ký khi lâu không mở app, và dịch vụ đẩy cũng đổi
       * `endpoint` theo thời gian. Ghi đè theo `endpoint` nên lượt gửi này
       * không sinh dòng thừa, chỉ cập nhật `last_seen_at`.
       */
      if (existing) await save(existing);
    }

    read().catch(() => alive && setDevice("khong-ho-tro"));
    return () => {
      alive = false;
    };
  }, [keyPending, publicKey]);

  async function toggleDevice(on: boolean) {
    setBusy(true);
    try {
      if (on) {
        // Lời xin quyền PHẢI nằm trong lượt bấm của người dùng. Gọi lúc tải
        // trang thì trình duyệt bỏ qua mà không báo gì.
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setDevice(permission === "denied" ? "bi-tu-choi" : "tat");
          return;
        }
        const registration = await navigator.serviceWorker.register("/sw.js");
        const sub = await registration.pushManager.subscribe({
          // Chuẩn đòi mọi thông báo phải hiện ra cho người dùng thấy. Safari
          // thu hồi quyền của trang nào nhận gói tin mà không hiện gì.
          userVisibleOnly: true,
          applicationServerKey: keyToBytes(publicKey ?? ""),
        });
        await save(sub);
        setDevice("bat");
      } else {
        const registration = await navigator.serviceWorker.ready;
        const sub = await registration.pushManager.getSubscription();
        if (sub) {
          await unsubscribeFromPush({ endpoint: sub.endpoint });
          await sub.unsubscribe();
        }
        setDevice("tat");
      }
    } catch (e) {
      toast.fail(errorMessage(e, "Không đổi được cài đặt thông báo"));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const result = await sendTestPush();
      if (result.sent > 0) toast.ok(`Đã gửi tới ${result.sent} thiết bị`);
      else toast.warn("Không thiết bị nào nhận. Bật lại thông báo rồi thử lần nữa.");
    } catch (e) {
      toast.fail(errorMessage(e, "Không gửi được thông báo thử"));
    } finally {
      setBusy(false);
    }
  }

  if (device === "dang-doc" || device === "khong-ho-tro") return null;

  const on = device === "bat";

  /**
   * Hai nhóm chứ không phải một, vì hai nhóm có phạm vi khác nhau.
   *
   * Tiêu đề nhóm mang luôn phạm vi, nên từng dòng không phải giải thích lại
   * mình áp cho một máy hay cho cả tài khoản.
   */
  return (
    <>
      <SettingsGroup title="Thiết bị này">
        {device === "chua-cai-iphone" ? (
          <SettingsRow
            label="Nhận thông báo"
            detail="Mở nút Chia sẻ trong Safari, chọn Thêm vào Màn hình chính, rồi mở app từ biểu tượng đó."
          />
        ) : device === "bi-tu-choi" ? (
          <SettingsRow
            label="Nhận thông báo"
            detail="Máy đang chặn. Vào Cài đặt của máy, bật thông báo cho trang này rồi quay lại."
          />
        ) : (
          <SettingsRow
            label="Nhận thông báo"
            control={
              <Switch
                checked={on}
                onCheckedChange={toggleDevice}
                label="Nhận thông báo trên máy này"
                hideLabel
                disabled={busy}
              />
            }
          />
        )}

        {on && <SettingsAction label="Gửi thông báo thử" onClick={test} disabled={busy} />}
      </SettingsGroup>

      {kinds.length > 0 && (
        <SettingsGroup title="Loại thông báo">
          {kinds.map((kind: NotificationKind) => (
            <SettingsRow
              key={kind}
              label={
                <span className={on ? undefined : styles.dim}>{NOTIFICATION_KIND_LABEL[kind]}</span>
              }
              control={
                <Switch
                  checked={prefs?.[kind] ?? true}
                  onCheckedChange={(enabled) => savePref.mutate({ kind, enabled })}
                  label={NOTIFICATION_KIND_LABEL[kind]}
                  hideLabel
                  // Máy này tắt thì mọi loại đều im, nên công tắc loại mờ đi. Giá
                  // trị vẫn giữ nguyên để bật lại là dùng lại được.
                  disabled={!on || savePref.isPending}
                />
              }
            />
          ))}
        </SettingsGroup>
      )}
    </>
  );
}
