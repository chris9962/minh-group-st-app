import type { MetadataRoute } from "next";

/**
 * Next tự sinh `/manifest.webmanifest` và tự chèn thẻ `<link rel="manifest">`
 * từ file này. Không có middleware chặn đường đó — trình duyệt tải manifest
 * KHÔNG kèm cookie, nên nếu sau này thêm lớp chặn toàn site thì phải chừa
 * `/manifest.webmanifest` ra, không thì nút cài đặt biến mất.
 *
 * Icon sinh từ `public/brand/logo.png` (96×96). Logo gốc nhỏ nên bản 512 bị
 * nhoè — có file logo lớn hơn thì thay rồi sinh lại bộ icon.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // `id` cố định danh tính bản cài. Đổi nó = máy coi như ứng dụng khác.
    id: "/",
    name: "Minh Group ST",
    short_name: "Minh Group ST",
    description: "Hệ thống nội bộ Minh Group ST: bảo hiểm, ngân hàng, dịch vụ",
    lang: "vi",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f8f5f0",
    theme_color: "#f8f5f0",
    orientation: "any",
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Android cắt icon theo hình dạng của máy (tròn, vuông bo, giọt nước).
      // Bản này chừa lề rộng để phần chữ MG không bị cắt mất.
      {
        src: "/brand/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
