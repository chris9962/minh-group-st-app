import { expect, test } from "@playwright/test";
import { login } from "./roles";

/**
 * Vùng bấm trên thiết bị cảm ứng — AGENTS.md §8 đòi tối thiểu 44px.
 *
 * Đội kinh doanh dùng điện thoại ngoài nắng, đây không phải yêu cầu hình thức:
 * nút "Tắt"/"Ngừng" nằm sát nút bút chì trong cùng một hàng bảng, hụt vài pixel
 * là bấm trượt sang thao tác bên cạnh.
 *
 * Ca này PHẢI chạy trong ngữ cảnh cảm ứng. Đo trên máy tính thì nút cao 36px và
 * đó là ĐÚNG — quy tắc chỉ áp khi `pointer: coarse`, để desktop giữ nguyên dáng.
 */
/**
 * Khai thẳng thuộc tính cảm ứng thay vì dùng `devices["iPhone 14"]`: bộ mô tả
 * đó kéo theo `defaultBrowserType: "webkit"`, mà repo chỉ cài Chromium — ca sẽ
 * đỏ vì thiếu trình duyệt chứ không phải vì nút hụt kích thước.
 */
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});

const MIN = 44;

test("mọi nút trên màn cấu hình đủ 44px khi trỏ bằng ngón tay", async ({ page }) => {
  await login(page, "director");

  // Chốt chặn cho chính ca test: thiếu dòng này thì chạy nhầm ngữ cảnh chuột và
  // ca vẫn xanh trong khi không đo được gì.
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

  for (const path of ["/settings/banks", "/settings/service-types", "/settings/channels"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await page.waitForLoadState("networkidle");

    const buttons = await page.locator("main").getByRole("button").all();
    expect(buttons.length, `${path} không tìm thấy nút nào`).toBeGreaterThan(0);

    for (const button of buttons) {
      if (!(await button.isVisible())) continue;
      const box = await button.boundingBox();
      if (!box) continue;
      const label = (await button.innerText()).trim() || (await button.getAttribute("aria-label")) || "(icon)";
      expect(Math.round(box.height), `${path} · nút "${label}"`).toBeGreaterThanOrEqual(MIN);
    }
  }
});
