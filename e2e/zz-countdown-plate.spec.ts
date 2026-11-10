import { expect, test, type Page } from "@playwright/test";
import { TAG, login } from "./roles";

const CUSTOMER = "ZZE2E-KH B Đặng Văn Bốn";
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function toPlateWarning(page: Page) {
  await login(page, "director");
  await page.goto("/insurance?create=1");
  const picker = page.getByRole("dialog");
  await picker.getByLabel("Tìm khách hàng").fill(CUSTOMER);
  await picker.getByRole("button", { name: new RegExp(CUSTOMER) }).click();
  const dialog = page.getByRole("dialog", { name: "Tạo đơn bảo hiểm" });
  await dialog.getByLabel("Gói bảo hiểm").selectOption({ label: "1 năm BH xe máy" });
  await dialog.getByLabel("Biển số xe").fill("59X1-54");
  await dialog.getByLabel("Họ tên").fill("Nguyễn Văn Minh");
  await dialog.getByLabel("Địa chỉ").fill(`${TAG} dia chi`);
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: `${TAG}-ho-so.png`, mimeType: "image/png", buffer: PNG_1X1 });
  await dialog.getByRole("button", { name: "Tạo đơn", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Xác nhận với khách" });
  if (await ask.isVisible().catch(() => false)) await ask.getByRole("button", { name: "Đã xác nhận" }).click();
  await dialog.getByLabel("Ngày bắt đầu").fill("01012027");
  await dialog.getByRole("button", { name: "Tạo đơn", exact: true }).click();
  await page.waitForTimeout(1500);
  console.log("Dialog đang mở:", await page.locator("dialog[open]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))));
  await page.screenshot({ path: `test-results/zz-plate-${test.info().title}.png` });
}

async function sample(page: Page) {
  const review = page.getByRole("dialog", { name: "Kiểm tra lại trước khi tạo đơn" });
  const confirm = review.getByRole("button", { name: /Xác nhận, tạo đơn/ });
  await expect(confirm).toBeVisible();
  for (let i = 0; i < 16; i++) {
    console.log(`${(i / 2).toFixed(1)}s`, await confirm.innerText(), (await confirm.isDisabled()) ? "khoá" : "bấm được");
    await page.waitForTimeout(500);
  }
}

test("giu-ngay", async ({ page }) => {
  await toPlateWarning(page);
  await page.getByRole("dialog", { name: /Biển số .* đã có bảo hiểm/ }).getByRole("button", { name: "Giữ ngày" }).click();
  await sample(page);
});

test("doi-ngay", async ({ page }) => {
  await toPlateWarning(page);
  await page.getByRole("dialog", { name: /Biển số .* đã có bảo hiểm/ }).getByRole("button", { name: "Đổi ngày" }).click();
  await sample(page);
});
