import { expect, test } from "@playwright/test";
import { LABEL, ROLES, login, screenLoaded } from "./roles";

/**
 * P-80 · Tổng quan — bốn cách nhìn, máy chủ chọn (chốt 06/08).
 *
 * Ca quan trọng nhất không phải "màn mở được" mà là "mỗi vai thấy ĐÚNG phạm vi
 * của mình": một trưởng phòng đọc số của cả công ty mà tưởng là phòng mình thì
 * mọi quyết định sau đó đều lệch.
 */

/** Vai nào thấy bản tổng hợp, vai nào thấy hồ sơ cá nhân. */
const PERSONAL: Record<(typeof ROLES)[number], boolean> = {
  director: false,
  "deputy-director": false,
  head: false,
  "deputy-head": false,
  staff: true,
};

for (const role of ROLES) {
  test(`${LABEL[role]}: mở được Tổng quan, đúng mặt của mình`, async ({ page }) => {
    await login(page, role);
    await page.goto("/");
    expect(await screenLoaded(page)).toBe(true);

    const main = page.locator("main");
    if (PERSONAL[role]) {
      // Nhân viên: khối điểm cá nhân, KHÔNG có bảng xếp hạng phòng.
      await expect(main).toContainText("Điểm theo tháng");
      await expect(main).not.toContainText("Xếp hạng phòng");
      await expect(main).not.toContainText("Phạm vi:");
    } else {
      await expect(main).toContainText("Xếp hạng phòng");
      // Dòng phạm vi là thứ giữ cho người xem khỏi đọc nhầm số của ai.
      await expect(main).toContainText("Phạm vi:");
      await expect(main).not.toContainText("Điểm theo tháng");
    }
  });
}

test("Giám đốc thấy toàn công ty, quản lý chỉ thấy phòng mình", async ({ page }) => {
  await login(page, "director");
  await page.goto("/");
  expect(await screenLoaded(page)).toBe(true);
  await expect(page.locator("main")).toContainText("Toàn công ty");
  const companyRows = await page.locator("table tbody tr").count();

  await login(page, "head");
  await page.goto("/");
  expect(await screenLoaded(page)).toBe(true);
  await expect(page.locator("main")).not.toContainText("Toàn công ty");
  // Bảng xếp hạng của trưởng phòng chỉ có phòng họ, luôn ít hơn của Giám đốc.
  expect(await page.locator("table tbody tr").count()).toBeLessThan(companyRows);
});

test("phạm vi KHÔNG nhận từ đường truyền", async ({ page }) => {
  await login(page, "head");
  // Bản trước nhận `?scope=company`. Nếu còn đọc tham số đó thì trưởng phòng
  // tự nâng mình lên toàn công ty bằng một dòng địa chỉ.
  const res = await page.request.get("/api/dashboard?period=today&scope=company");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { kind: string; scopeLabel?: string };
  expect(body.kind).toBe("overview");
  expect(body.scopeLabel).not.toBe("Toàn công ty");
});

test("nhân viên gọi thẳng API cũng chỉ ra hồ sơ của chính mình", async ({ page }) => {
  await login(page, "staff");
  const res = await page.request.get("/api/dashboard?period=this-month&scope=company");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { kind: string; person?: { username: string } };
  expect(body.kind).toBe("personal");
  expect(body.person?.username).toBe("zz_e2e_staff");
});
