import { compact } from "../text";

const chose = (label: string): boolean => label.startsWith("CHON") || label.startsWith("CHN");

/** Paddle hay rụng nguyên âm trong NHÃN UI; không sửa giá trị như mã RM/PGD. */
export function adaptMbPaddleText(values: string[]): string {
  const lines = values.map((value) => {
    const label = compact(value);
    if (label.startsWith("DANGKYTAIKH")) return "Đăng ký tài khoản";
    if (label.includes("MARM") && label.startsWith("MANG")) return "Mã người giới thiệu (Mã RM)";
    // Paddle rụng nguyên âm cả ở "Chọn" (CHN) lẫn ở "hỗ trợ" (HTR/HTRO), nên
    // hai nhãn này khớp lỏng. Thiếu chúng thì parser bỏ cả màn đăng ký, kể cả
    // khi Paddle đã đọc đúng mã RM mà Tesseract đọc sai.
    if (chose(label) && label.includes("THANHPH")) return "Chọn Tỉnh/Thành phố";
    if (chose(label) && label.includes("CHINHANH") && /HTRO?$/.test(label)) return "Chọn chi nhánh hỗ trợ";
    if ((label.startsWith("HOSO") || label.startsWith("HSO")) && label.endsWith("DUNG")) return "Hồ sơ người dùng";
    if (label.startsWith("TRUY") && label.includes("GIAOD")) return "Truy vấn giao dịch";
    if (label.includes("LICHSUGIAOD")) return "Lịch sử giao dịch";
    if (label.startsWith("THONGBAO") && label.includes("DONG") && label.endsWith("SDU")) return "Thông báo biến động số dư";
    return value;
  });
  // Paddle tách nhãn TIỀN RA và số tiền thành hai hộp chữ; parser MB chờ cùng dòng.
  for (let i = 0; i < lines.length - 1; i++) {
    if (compact(lines[i]) === "TIENRA" && /^[-~]\s*\d[\d.,]*\s*VND$/i.test(lines[i + 1])) {
      lines[i] += ` ${lines[i + 1]}`;
    }
  }
  return lines.join("\n");
}
