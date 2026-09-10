import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Bản dựng gói kèm đúng những gói máy chủ thật sự nạp, không chở cả
   * `node_modules`. Bắt buộc cho `Dockerfile` — thiếu nó thì image phình từ
   * ~200MB lên hơn 1GB vì `playwright` và toàn bộ devDependencies đi theo.
   *
   * `next start` vẫn chạy đúng: đây là thư mục `.next/standalone` sinh THÊM, không
   * thay bản dựng thường. Nó chỉ in một dòng cảnh báo `"next start" does not work
   * with "output: standalone"` — bỏ qua được, Next chỉ `log.warn` chứ không ném lỗi.
   */
  output: "standalone",
  /**
   * Nguồn được phép gọi tài nguyên dev của Next, ví dụ `/_next/webpack-hmr`.
   *
   * Next 16 chặn mọi nguồn khác `localhost` ở chế độ dev. Mở app qua một đường
   * hầm như ngrok để thử trên điện thoại thì trang tải HTML xong nhưng React
   * không chạy tiếp, và màn hình đứng ở trạng thái đang tải mà không báo lỗi.
   *
   * Khai theo tên miền có ký tự đại diện chứ không viết cứng một địa chỉ: đường
   * hầm đổi tên mỗi lần khởi động, viết cứng là mỗi lần phải sửa lại file này.
   * `DEV_ORIGIN` để dành cho đường hầm mang tên miền khác.
   *
   * CHỈ có tác dụng ở `next dev`. Bản dựng thật không đọc tới, nên danh sách này
   * không mở thêm đường nào trên máy chủ.
   */
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.trycloudflare.com",
    ...(process.env.DEV_ORIGIN ? [process.env.DEV_ORIGIN] : []),
  ],
  sassOptions: {
    loadPaths: [path.join(process.cwd(), "src/styles")],
    // Có sẵn `bp.$bp-*` ở mọi .module.scss mà không cần tự @use từng file.
    additionalData: `@use "breakpoints" as bp;`,
  },
};

export default nextConfig;
