import { adaptMbPaddleText } from "./banks/mbFallback";
import { compact, levenshtein } from "./text";
import type { CheckedItem } from "./types";

/**
 * Dòng CHỈ CÓ nhãn, không kèm giá trị, cho sai vài ký tự vì Paddle rụng nguyên
 * âm. Khác `hasLabel` ở chỗ đòi cả dòng khớp: dòng "Xin chào NGUYEN VAN A" mà
 * thay bằng nhãn chuẩn là mất luôn tên khách.
 */
const only = (label: string, expected: string): boolean =>
  levenshtein(label, expected) <= Math.max(1, Math.floor(expected.length / 6));

/**
 * Trần ảnh một lượt Paddle. `PHOTO_MAX` cho phép 20 ảnh mỗi loại, nên không
 * đặt trần thì một tài khoản nộp thừa ảnh chiếm hàng đợi Paddle hàng phút.
 * Tám ảnh phủ hết tài khoản trong bộ đo 2026-09-13 và cả LPB bảy ảnh.
 */
const MAX_RETRY_PHOTOS = 8;

/**
 * Ảnh gửi sang PaddleOCR: mọi ảnh của mục KHÔNG ĐẠT, bất kể lý do.
 *
 * Chốt 2026-09-13 sau khi đo 50 tài khoản MB. Bản trước bỏ qua mục có lỗi
 * "không khớp" vì cho rằng chữ đã đọc rõ thì đọc lại cũng ra vậy. Sai: hai tài
 * khoản có Tesseract đọc `EE40` và `PGD Cai Lay co`, Paddle đọc đúng `E640` và
 * `PGD Cai Lậy`. Đọc rõ không đồng nghĩa đọc đúng.
 *
 * Ảnh đã phục vụ một mục ĐẠT thì bỏ qua: mục đó xong rồi, đọc lại không đổi gì.
 *
 * Mục `fail` biết chính xác ảnh nào nên xếp trước. Mục `missing` không biết
 * ảnh nào, lấy mọi ảnh chưa mục nào nhận ra.
 */
export function fallbackPhotoIndexes(items: CheckedItem[], photoCount: number): number[] {
  const passed = new Set(
    items.filter((item) => item.verdict === "pass").map((item) => item.photoIndex)
      .filter((index) => index !== undefined),
  );
  const failing = items.filter((item) => item.verdict !== "pass");

  const picked: number[] = [];
  const add = (index: number) => {
    if (!picked.includes(index)) picked.push(index);
  };
  for (const item of failing) if (item.photoIndex !== undefined) add(item.photoIndex);
  if (failing.some((item) => item.photoIndex === undefined)) {
    for (let index = 0; index < photoCount; index++) if (!passed.has(index)) add(index);
  }
  return picked.slice(0, MAX_RETRY_PHOTOS);
}

/** Chuẩn hóa nhãn giao diện cho parser đang có; giá trị OCR vẫn giữ nguyên. */
export function adaptPaddleText(bankCode: string, lines: string[]): string {
  if (bankCode === "MB") return adaptMbPaddleText(lines);
  const bank = bankCode.startsWith("MSB") ? "MSB" : bankCode;
  const normalized = lines.map((line) => {
    const label = compact(line);
    // TPBank in chú thích trong ngoặc sau nhãn: "Mã ưu đãi/giới thiệu (nếu có)".
    const bare = compact(line.replace(/\(.*?\)/g, ""));
    if (bank === "LPB") {
      if (label.startsWith("NGAYM") && label.includes("TAIKH") && !/\d{1,2}\/\d{2}\/\d{4}/.test(line)) return "Ngày mở tài khoản";
      if (label === "CHUTAIKHOAN" || label === "CHUTAIKHON") return "Chủ tài khoản";
      if (label.startsWith("NGUOIGIOITHIEUCUATOI")) return "Người giới thiệu của tôi";
      if (label.startsWith("THONGTINNGUOIGIOITHIEU")) return "Thông tin người giới thiệu";
      if (label.startsWith("BIENDONGSODU") || label.startsWith("BINDONGSDU")) return "Biến động số dư";
    }
    if (bank === "MSB") {
      if (label === "BOSUNGTHONGTIN") return "Bổ sung thông tin";
      if (label === "CHINHANHPGD") return "Chi nhánh/PGD";
      if (label === "MAGIOITHIEU") return "Mã giới thiệu";
      if (label === "MACHUONGTRINH") return "Mã chương trình";
      if (label === "CHUTAIKHOAN") return "Chủ tài khoản";
      if (label === "MAGIAODICH") return "Mã giao dịch";
    }
    if (bank === "TPB") {
      if (only(bare, "MOTAIKHOANTHANHCONG")) return "Mở tài khoản thành công";
      if (only(bare, "TENDANGNHAP")) return "Tên đăng nhập:";
      if (only(bare, "SOTAIKHOANTHANHTOAN")) return "Số tài khoản thanh toán:";
      if (only(bare, "MAUUDAIGIOITHIEU") || only(bare, "MAGIOITHIEU")) return "Mã giới thiệu";
      if (only(bare, "XINCHAO")) return "Xin chào";
      if (only(bare, "LICHSUGIAODICH")) return "Lịch sử giao dịch";
    }
    return line;
  });
  if (bank === "LPB") {
    for (let i = 0; i < normalized.length - 1; i++) {
      if (normalized[i] === "Chủ tài khoản" &&
          /^[\p{L}\s]{4,}$/u.test(normalized[i + 1]) &&
          !/tài khoản|chi nhánh|ngày mở/i.test(normalized[i + 1])) {
        normalized[i] += ` ${normalized[i + 1]}`;
      }
      if (normalized[i] === "Ngày mở tài khoản" && /^\d{1,2}\/\d{2}\/\d{4}$/.test(normalized[i + 1])) {
        normalized[i] += `: ${normalized[i + 1]}`;
      }
    }
  }
  /**
   * TPBank: Paddle tách NHÃN và GIÁ TRỊ thành hai hộp chữ, còn `pickField` đòi
   * chúng cùng một dòng. Ghép dòng nhãn không có chữ số với dòng sau có chữ số.
   * Đo 2026-09-13: thiếu bước này thì cả 38 ảnh đọc lại đều ra rỗng trường.
   */
  if (bank === "TPB") {
    const LABELS = ["Tên đăng nhập:", "Số tài khoản thanh toán:", "Mã giới thiệu"];
    for (let i = 0; i < normalized.length - 1; i++) {
      if (!LABELS.includes(normalized[i])) continue;
      if (!/^[A-Z0-9][\dA-Z /]*$/i.test(normalized[i + 1].trim())) continue;
      normalized[i] += ` ${normalized[i + 1]}`;
    }
  }
  // Paddle tách số tiền sang hộp chữ riêng; parser giao dịch có thể chờ cùng dòng.
  for (let i = 0; i < normalized.length - 1; i++) {
    if (["TIENRA", "SOTIEN"].includes(compact(normalized[i])) &&
        /^[-+]?\s*\d[\d.,]*\s*VND$/i.test(normalized[i + 1])) {
      normalized[i] += ` ${normalized[i + 1]}`;
    }
  }
  return normalized.join("\n");
}
