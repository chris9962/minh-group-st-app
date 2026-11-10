import { devices, expect, test, type Page } from "@playwright/test";
import { TAG, login } from "./roles";

const CUSTOMER = "ZZE2E-KH B Đặng Văn Bốn";
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function toReview(page: Page) {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  await login(page, "director");
  await page.goto("/insurance?create=1");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tìm khách hàng").fill(CUSTOMER);
  await dialog.getByRole("button", { name: new RegExp(CUSTOMER) }).click();
  const options = await dialog.getByLabel("Gói bảo hiểm").locator("option").allInnerTexts();
  console.log("Gói:", options.join(" | "));
  await dialog.getByLabel("Gói bảo hiểm").selectOption({ label: "1 năm BH tai nạn điện" });
  await dialog.getByLabel("Số thành viên").fill("3");
  await dialog.getByLabel("Họ tên").fill("Nguyễn Văn Minh");
  await dialog.getByLabel("Ngày sinh").fill("01011990");
  await dialog.getByLabel("Địa chỉ").fill(`${TAG} dia chi`);
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: `${TAG}-ho-so.png`, mimeType: "image/png", buffer: PNG_1X1 });
  await dialog.getByRole("button", { name: "Tạo đơn", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Xác nhận với khách" });
  if (await ask.isVisible().catch(() => false)) await ask.getByRole("button", { name: "Đã xác nhận" }).click();
  await dialog.getByLabel("Ngày bắt đầu").fill("01012027");
  await page.screenshot({ path: `test-results/zz-before-submit-${test.info().title}.png`, fullPage: true });
  await dialog.getByRole("button", { name: "Tạo đơn", exact: true }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `test-results/zz-after-submit-${test.info().title}.png`, fullPage: true });
  console.log("Dialog đang mở:", await page.locator("dialog[open]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))));
  console.log("Thông báo:", await page.locator("[role=status], [role=alert], li[data-state]").allInnerTexts());
  return logs;
}

async function sample(page: Page, logs: string[]) {
  const review = page.getByRole("dialog", { name: "Kiểm tra lại trước khi tạo đơn" });
  const confirm = review.getByRole("button", { name: /Xác nhận, tạo đơn/ });
  await expect(confirm).toBeVisible();
  for (let i = 0; i < 16; i++) {
    console.log(`${(i / 2).toFixed(1)}s`, await confirm.innerText(), (await confirm.isDisabled()) ? "khoá" : "bấm được");
    await page.waitForTimeout(500);
  }
  console.log(logs.filter((l) => !l.includes("[HMR]") && !l.includes("Download the React DevTools")).join("\n"));
}

test("desktop", async ({ page }) => {
  const logs = await toReview(page);
  await sample(page, logs);
});

test.describe("iphone", () => {
  const { defaultBrowserType: _, ...iphone } = devices["iPhone 13"];
  test.use(iphone);
  test("iphone", async ({ page }) => {
    const logs = await toReview(page);
    await sample(page, logs);
  });
});
