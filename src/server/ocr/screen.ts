import sharp from "sharp";

/**
 * Nhận ra MÀN nào trước khi OCR, bằng màu, không tốn Tesseract.
 *
 * Màn hình chính app TPBank là màn duy nhất có một khối tím liền chiếm phần
 * lớn phía trên. Màn khác của TPBank cũng có tím nhưng chỉ là dải mỏng: thanh
 * trạng thái cao 4-6%, nút cao 5%, banner quảng cáo cao 10%.
 *
 * Đo 2026-09-14 trên 63 ảnh màn hình chính có nhãn và 261 ảnh đủ loại màn
 * (48 màn hình chính): tổng số điểm tím KHÔNG tách được, vì ảnh chụp lại bằng
 * máy khác trong tối chỉ có 9,7% tím còn screenshot màn chuyển khoản Android
 * lên 14,5%. Khối liền lớn nhất thì tách được 324/324.
 */

/** Ảnh thu về cạnh này trước khi đếm; đủ để thấy khối, đủ nhỏ để chạy 28 ms. */
const SAMPLE_WIDTH = 240;

/**
 * Tím của nền header: hue 250-265. Tím của nút và banner ở màn khác có hue
 * 270-280 nên bị loại ngay ở đây; nhờ vậy độ sáng chỉ cần >= 0,2, đủ nhận cả
 * screenshot máy hiển thị tối (ảnh 009-4 bộ benchmark, sáng 0,3) lẫn ảnh chụp
 * lại trong tối.
 */
function isTpbPurple(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max ? (max - min) / max : 0;
  if (v < 0.2 || s < 0.35) return false;
  const d = max - min;
  let h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  return h >= 240 && h <= 268;
}

type Blob = { area: number; height: number; width: number };

/** Khối liền lớn nhất trong mặt nạ, đo theo tỉ lệ của ảnh. */
function largestBlob(mask: Uint8Array, width: number, height: number): Blob {
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  let best: Blob = { area: 0, height: 0, width: 0 };
  let bestCount = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let count = 0;
    let minY = height;
    let maxY = 0;
    let minX = width;
    let maxX = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      count++;
      const y = Math.floor(p / width);
      const x = p - y * width;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      const next = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width];
      for (const q of next) {
        if (q < 0 || q >= mask.length || seen[q] || !mask[q]) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (count > bestCount) {
      bestCount = count;
      best = { area: count / mask.length, height: (maxY - minY + 1) / height, width: (maxX - minX + 1) / width };
    }
  }
  return best;
}

/**
 * Giãn mặt nạ 2 điểm mỗi hướng để chữ trắng và icon trong header không cắt
 * khối tím thành nhiều mảnh.
 */
function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0;
      for (let dy = -2; dy <= 2 && !on; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < width && mask[yy * width + xx]) {
            on = 1;
            break;
          }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

/**
 * Ảnh có phải màn hình chính app TPBank không.
 *
 * Ngưỡng theo số đo 2026-09-14: màn hình chính thấp nhất là khối 9,0% diện
 * tích, cao 27%, rộng 33%; màn khác cao nhất là 7,8% diện tích nhưng rộng 17%,
 * còn lại đều cao dưới 15%. Ảnh chụp từ máy khác vẫn đạt vì khối tím vẫn liền,
 * chỉ nhỏ hơn.
 */
export async function isTpbHomeScreen(image: Buffer): Promise<boolean> {
  const { data, info } = await sharp(image)
    .rotate()
    .resize({ width: SAMPLE_WIDTH })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const mask = new Uint8Array(width * height);
  for (let p = 0; p < mask.length; p++) {
    mask[p] = isTpbPurple(data[p * 3], data[p * 3 + 1], data[p * 3 + 2]) ? 1 : 0;
  }
  const blob = largestBlob(dilate(mask, width, height), width, height);
  return blob.area >= 0.08 && blob.height >= 0.2 && blob.width >= 0.3;
}
