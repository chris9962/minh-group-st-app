import { readFile } from "node:fs/promises";
import path from "node:path";
import convert from "heic-convert";
import sharp from "sharp";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { ID_CARD_QR_UNREADABLE, parseIdCardQr, type IdCardQr } from "@/lib/idCardQr";
import { imageExtOf } from "./storage";

/**
 * Đọc QR trên ảnh thẻ CCCD — chạy Ở MÁY CHỦ.
 *
 * Trình duyệt đã đọc một lần để điền sẵn ba ô (`lib/readQrImage.ts`), nhưng ba
 * giá trị đó quay về máy chủ trong JSON và sửa được bằng tay. Máy chủ đọc lại
 * từ chính ảnh gửi lên rồi ghi đè, nên thứ nằm trong database là thứ in trên
 * thẻ (chốt 2026-10-06).
 *
 * Đọc từ bytes GỐC, trước khi `putImage` ép về WebP 1600px: QR chiếm một góc
 * nhỏ của thẻ, nén thêm một lượt là mất ô.
 *
 * Cùng thư viện `zxing-wasm` với trình duyệt (đổi từ `jsqr` 2026-10-07): khác
 * thư viện thì có ảnh trình duyệt đọc được mà máy chủ từ chối.
 */

let zxingReady: Promise<void> | null = null;

// Wasm đọc từ `public/` vì Dockerfile chép nguyên thư mục đó vào image, còn
// `.next/standalone` không mang theo file này.
const prepareZxing = () =>
  (zxingReady ??= readFile(path.join(process.cwd(), "public", "zxing_reader.wasm")).then((wasm) => {
    prepareZXingModule({
      overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) },
    });
  }));

async function decode(src: Buffer): Promise<string | null> {
  await prepareZxing();
  const { data, info } = await sharp(src, { failOn: "none" })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
    colorSpace: "srgb",
  } as ImageData;
  const [found] = await readBarcodes(pixels, { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 1 });
  return found?.text.trim() || null;
}

export async function readIdCardQr(bytes: Uint8Array): Promise<IdCardQr> {
  const ext = imageExtOf(bytes);
  if (!ext)
    return { ok: false, message: "File này không phải ảnh. Chỉ nhận JPG, PNG, WEBP hoặc HEIC." };

  let text: string | null = null;
  try {
    // HEIC của iPhone đi qua `heic-convert` trước, cùng lý do ở `toWebpOnServer`:
    // `sharp` treo vô hạn khi đọc HEVC trên image production.
    const src =
      ext === "heic"
        ? Buffer.from(await convert({ buffer: Buffer.from(bytes), format: "JPEG", quality: 0.92 }))
        : Buffer.from(bytes);
    // Màn chụp chỉ gửi ô vuông QR đã cắt (chốt 2026-10-08), nên đọc cả ảnh là đủ.
    text = await decode(src);
  } catch (e) {
    console.error("[idCardQr] không đọc được ảnh:", e);
    return { ok: false, message: ID_CARD_QR_UNREADABLE };
  }

  if (!text) return { ok: false, message: ID_CARD_QR_UNREADABLE };
  return parseIdCardQr(text);
}
