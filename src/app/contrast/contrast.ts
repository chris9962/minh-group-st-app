/**
 * Đo tương phản WCAG 2.1 ngay trên DOM đang hiển thị.
 *
 * Không nhận màu do người viết gõ vào: mọi giá trị đọc bằng `getComputedStyle`
 * từ chính phần tử đang vẽ. Gõ tay thì con số chỉ chứng minh phép tính đúng,
 * không chứng minh màn hình đúng — và bộ tối với bộ sáng cho hai kết quả khác
 * nhau trên cùng một dòng CSS.
 */

export type Rgb = { r: number; g: number; b: number; a: number };

/**
 * `getComputedStyle` trả `rgb()` / `rgba()`, còn `getPropertyValue` của biến
 * `--om-*` trả nguyên văn chuỗi trong file, thường là hex. Đọc được cả hai.
 */
export function parseColor(value: string): Rgb {
  const text = value.trim();
  if (!text || text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  if (text.startsWith("#")) {
    const hex = text.slice(1);
    const full = hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c).join("") : hex;
    const at = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return { r: at(0), g: at(2), b: at(4), a: full.length === 8 ? at(6) / 255 : 1 };
  }

  /**
   * `color-mix()` KHÔNG được trả về dạng `rgb()`. Chrome rút gọn nó thành
   * `color(srgb 0.93 0.94 0.97 / 0.6)` — kênh chạy 0–1 chứ không phải 0–255.
   * Đọc nhầm thang là mọi màu sáng ra gần đen, và `.table th` đo ra 1,19:1
   * thay vì số thật.
   */
  const parts = text.match(/[\d.]+%?/g) ?? [];
  const unit = text.startsWith("color(") ? 1 : 255;
  const num = (i: number, scale: number, from: number) => {
    const p = parts[i];
    if (p === undefined) return scale;
    return p.endsWith("%") ? (parseFloat(p) / 100) * scale : (parseFloat(p) / from) * scale;
  };
  return {
    r: num(0, 255, unit),
    g: num(1, 255, unit),
    b: num(2, 255, unit),
    a: parts[3] === undefined ? 1 : num(3, 1, 1),
  };
}

/** Đặt màu `top` (có thể trong suốt một phần) lên nền `bottom` đục. */
const over = (top: Rgb, bottom: Rgb): Rgb => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});

/**
 * Nền THẬT sau lưng một phần tử.
 *
 * Phải leo ngược lên cây và chồng từng lớp, vì màu nền hay khai bằng
 * `rgb(255 255 255 / 26%)` hoặc `color-mix(..., transparent)`. Lấy đúng
 * `backgroundColor` của một phần tử là đo trên lớp trong suốt và ra số sai
 * hoàn toàn — chip đếm ở tab là ca này.
 */
export function effectiveBackground(el: Element): Rgb {
  const layers: Rgb[] = [];
  let node: Element | null = el;

  while (node) {
    const color = parseColor(getComputedStyle(node).backgroundColor);
    if (color.a > 0) {
      layers.push(color);
      if (color.a >= 1) break;
    }
    node = node.parentElement;
  }

  const opaque = layers.length > 0 && layers[layers.length - 1].a >= 1 ? layers.pop()! : WHITE;
  return layers.reduceRight((acc, layer) => over(layer, acc), opaque);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 };

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const luminance = (c: Rgb) =>
  0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);

export function contrast(fg: Rgb, bg: Rgb): number {
  // Chữ cũng mờ được — `.table th` dùng color-mix 60%. Chồng nó lên nền trước.
  const solid = fg.a >= 1 ? fg : over(fg, bg);
  const a = luminance(solid);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Ngưỡng của WCAG AA. Chữ lớn được nới xuống 3,0 vì nét dày hơn thì mắt bù
 * lại được phần tương phản thiếu — 18,66px đậm hoặc 24px thường trở lên.
 */
export function thresholdOf(el: Element): number {
  const s = getComputedStyle(el);
  const size = parseFloat(s.fontSize);
  const weight = Number(s.fontWeight) || 400;
  return size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
}

export const toHex = (c: Rgb) =>
  `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
