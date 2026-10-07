import convert from "heic-convert";
import jsQR from "jsqr";
import sharp from "sharp";
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
 */

/** Cạnh dài khi dò lượt đầu — cùng mức với `lib/readQrImage.ts`. */
const MAX_EDGE = 1600;

async function pixelsOf(src: Buffer, maxEdge: number | null) {
  let pipeline = sharp(src, { failOn: "none" }).rotate();
  if (maxEdge)
    pipeline = pipeline.resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    });
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

async function decodeAt(src: Buffer, maxEdge: number | null): Promise<string | null> {
  const pixels = await pixelsOf(src, maxEdge);
  const found = jsQR(pixels.data, pixels.width, pixels.height, {
    inversionAttempts: "attemptBoth",
  });
  return found?.data.trim() || null;
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

    // Thu về 1600 trước cho nhanh; ảnh chụp xa mà QR nhỏ thì thử lại ở cỡ gốc.
    text = await decodeAt(src, MAX_EDGE);
    if (!text) {
      const meta = await sharp(src, { failOn: "none" }).metadata();
      if (Math.max(meta.width ?? 0, meta.height ?? 0) > MAX_EDGE) text = await decodeAt(src, null);
    }
  } catch (e) {
    console.error("[idCardQr] không đọc được ảnh:", e);
    return { ok: false, message: ID_CARD_QR_UNREADABLE };
  }

  if (!text) return { ok: false, message: ID_CARD_QR_UNREADABLE };
  return parseIdCardQr(text);
}
