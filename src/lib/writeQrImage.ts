/**
 * Vẽ mã QR từ một chuỗi, chạy Ở TRÌNH DUYỆT. Cùng thư viện và cùng lối nạp động
 * với `readQrImage.ts`.
 *
 * File wasm nằm ở `public/zxing_writer.wasm`, chép từ
 * `node_modules/zxing-wasm/dist/writer/`. Nâng `zxing-wasm` thì chép lại.
 */

let zxingReady = false;

/** Trả ảnh PNG của mã QR; null = thư viện không vẽ được. */
export async function writeQrImage(text: string): Promise<Blob | null> {
  const zxing = await import("zxing-wasm/writer");
  if (!zxingReady) {
    zxing.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? "/zxing_writer.wasm" : prefix + path,
      },
    });
    zxingReady = true;
  }
  const result = await zxing.writeBarcode(text, { format: "QRCode", scale: 8 });
  return result.image;
}
