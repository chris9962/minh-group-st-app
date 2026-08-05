import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

/**
 * Tiêu đề dùng font hệ thống, không tải font display riêng — font slab dày cũ
 * làm mọi tiêu đề nặng bằng nhau nên mất thứ bậc. Thứ bậc giờ đi bằng cỡ chữ
 * và weight, xem `--font-heading` trong organic.css.
 */
const fontSans = Figtree({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MGST — Nền tảng nội bộ",
  description: "Hệ thống nội bộ Minh Group ST: bảo hiểm, ngân hàng, dịch vụ",
  /**
   * Trỏ thẳng vào file logo đang dùng, KHÔNG chép sang `src/app/icon.png`.
   *
   * Next có quy ước đặt file tên `icon.png` trong `app/` là tự sinh thẻ link,
   * nhưng như vậy là hai bản cùng một hình: đổi bộ nhận diện mà chỉ sửa một
   * chỗ thì tab trình duyệt mang logo cũ, và không ai để ý.
   *
   * `apple` là biểu tượng khi thêm vào màn hình chính iOS — đội KD dùng điện
   * thoại nên đường vào nhanh đó có người dùng thật. Thiếu nó thì iOS chụp màn
   * hình trang làm biểu tượng.
   */
  icons: {
    icon: "/brand/logo.png",
    apple: "/brand/logo.png",
  },
};

/** Đội KD làm việc trên điện thoại — không khoá zoom, để họ phóng to được. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f5f0" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1826" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: script dưới đây CỐ Ý sửa thẻ html trước khi
    // React so khớp, nên máy chủ không có data-theme còn trình duyệt thì có.
    // Đây là lệch có chủ đích và chỉ nằm trên đúng thẻ này.
    <html
      lang="vi"
      className={fontSans.variable}
      suppressHydrationWarning
    >
      <head>
        {/*
          Gắn data-theme TRƯỚC khi vẽ. Để React gắn trong effect thì khung hình
          đầu tiên luôn là bộ sáng, ai chọn bộ tối sẽ thấy chớp trắng mỗi lần
          tải trang.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=JSON.parse(localStorage.getItem("mgst-theme")||"{}").state?.theme;if(t)document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
