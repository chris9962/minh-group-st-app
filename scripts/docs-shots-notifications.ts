/**
 * Chụp ảnh trang Cá nhân cho bài "Nhận thông báo" (C-09) ở trang Hướng dẫn P-95.
 *
 * Tách khỏi `docs-shots.ts` vì cần ghi đè `Notification.permission`: Chromium
 * không đầu trả "denied" dù đã cấp quyền cho ngữ cảnh, và khối cài đặt khi đó
 * hiện dòng "Máy đang chặn" thay vì công tắc.
 *
 * Cùng cách đo toạ độ với `docs-shots.ts`: in JSON ra stdout, dán vào bài ở
 * `src/lib/docs/articles/daily.ts`. Cần dev server cổng 3002 và tài khoản test
 * từ `scripts/e2e-seed.ts`.
 *
 *   bun scripts/docs-shots-notifications.ts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:3002";
const OUT_DIR = path.join(process.cwd(), "public", "docs");
const VIEWPORT = { width: 1280, height: 800 };
const LOGIN = { username: "zz_e2e_director", password: "E2eTest!2026" };

type MarkerSpec = { n: number; target: Locator; label: string };
const pct = (v: number) => Math.round(v * 10) / 10;

async function shoot(page: Page, name: string, markers: MarkerSpec[]) {
  const box = { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height };
  const out: { n: number; x: number; y: number; label: string }[] = [];
  for (const m of markers) {
    const b = await m.target.boundingBox();
    if (!b) throw new Error(`Không thấy phần tử marker ${m.n} của ${name}`);
    out.push({
      n: m.n,
      x: pct(((b.x + b.width / 2 - box.x) / box.width) * 100),
      y: pct(((b.y + b.height / 2 - box.y) / box.height) * 100),
      label: m.label,
    });
  }
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), scale: "css" });
  console.log(`\n=== ${name}.png (${box.width}×${box.height})`);
  console.log(JSON.stringify(out, null, 2));
}

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT });
// `permissions: ["notifications"]` KHÔNG có tác dụng trên Chromium không đầu bản
// mới, nó vẫn trả "denied". Ghi đè thẳng thuộc tính: "default" là trạng thái
// người dùng mới thấy, công tắc hiện ra ở vị trí tắt.
await context.addInitScript(() => {
  Object.defineProperty(Notification, "permission", { get: () => "default" });
});
const page = await context.newPage();

try {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("Tài khoản").fill(LOGIN.username);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill(LOGIN.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL(`${BASE_URL}/`);

  await page.goto(`${BASE_URL}/profile`);
  // Ô input của Switch ẩn bằng CSS, nên nhắm vào nhãn (phần track nhìn thấy).
  const deviceSwitch = page.locator("label").filter({ hasText: "Nhận thông báo trên máy này" });
  await deviceSwitch.waitFor();
  await shoot(page, "profile-notifications", [
    { n: 1, target: deviceSwitch, label: "Công tắc Nhận thông báo — bật để máy này kêu khi có tin." },
    { n: 2, target: page.getByRole("heading", { name: "Loại thông báo" }), label: "Nhóm Loại thông báo — chọn loại tin muốn nhận." },
  ]);
} finally {
  await browser.close();
}
process.exit(0);
