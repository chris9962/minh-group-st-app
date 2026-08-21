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
  sassOptions: {
    loadPaths: [path.join(process.cwd(), "src/styles")],
    // Có sẵn `bp.$bp-*` ở mọi .module.scss mà không cần tự @use từng file.
    additionalData: `@use "breakpoints" as bp;`,
  },
};

export default nextConfig;
