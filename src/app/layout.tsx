import type { Metadata, Viewport } from "next";
import { Alfa_Slab_One, Figtree } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

/**
 * Font tiêu đề.
 *
 * Design system gốc dùng Caprasimo — nhưng font đó KHÔNG có bộ ký tự tiếng Việt,
 * `Đ ă ậ ỉ ể ổ` rơi về font dự phòng làm chữ vỡ thành hai kiểu. Alfa Slab One
 * cùng chất slab dày và có đủ tiếng Việt.
 */
const fontTieuDe = Alfa_Slab_One({
  variable: "--font-tieu-de",
  subsets: ["latin", "vietnamese"],
  weight: "400",
  display: "swap",
});

const fontThan = Figtree({
  variable: "--font-than",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MGST — Nền tảng nội bộ",
  description: "Hệ thống nội bộ Minh Group ST: bảo hiểm, ngân hàng, dịch vụ",
};

/** Đội KD làm việc trên điện thoại — không khoá zoom, để họ phóng to được. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5ead8",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={`${fontTieuDe.variable} ${fontThan.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
