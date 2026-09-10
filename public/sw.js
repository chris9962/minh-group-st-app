/**
 * Service worker — chỉ làm đúng một việc: nhận thông báo đẩy và mở app khi bấm.
 *
 * KHÔNG lưu đệm gì cả. Lưu đệm một ứng dụng Next có đăng nhập là chuyện riêng,
 * làm nửa vời thì người dùng thấy dữ liệu cũ của phiên trước, hoặc thấy dữ liệu
 * của người vừa đăng xuất. Muốn chạy ngoại tuyến thì làm một lượt riêng.
 *
 * File đặt ở `public/` để phục vụ tại `/sw.js`, tức phạm vi gốc `/`. Đặt trong
 * `app/` là đường dẫn có tiền tố và service worker chỉ quản được nhánh con.
 */

self.addEventListener("install", () => {
  // Bỏ giai đoạn chờ. Không có bản cũ nào đang phục vụ nên không sợ tranh chấp.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Nhận quyền điều khiển các tab đang mở, khỏi bắt người dùng tải lại trang.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  // Thân request có thể rỗng hoặc không phải JSON. Vẫn phải hiện một thứ gì đó:
  // iOS thu hồi quyền đẩy của trang nào nhận `push` mà không hiện thông báo.
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Minh Group ST", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Minh Group ST";
  const options = {
    body: data.body || "",
    icon: "/brand/icon-192.png",
    badge: "/brand/icon-192.png",
    // Cùng `tag` thì thông báo sau thay chỗ thông báo trước, không xếp chồng.
    tag: data.tag || "mgst",
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // Đã có cửa sổ app đang mở thì đưa nó lên trước rồi điều hướng, không mở
      // thêm cửa sổ thứ hai.
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
