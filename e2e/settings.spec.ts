import { expect, test, type Page } from "@playwright/test";
import { TAG, login } from "./roles";

/**
 * Hành vi giao diện của module cấu hình, sau đợt sửa 05/08.
 *
 * Mỗi ca soi một thứ đã từng hỏng thật, ghi kèm để lần sau đọc ra ngay vì sao
 * ca đó tồn tại — chứ không phải "test cho có".
 */

const toast = (page: Page) => page.getByRole("status").or(page.locator("[data-radix-toast-root]"));
const dialog = (page: Page) => page.locator("dialog[open]");

test.beforeEach(async ({ page }) => {
  await login(page, "director");
});

test.describe("bật/tắt danh mục phải hỏi lại", () => {
  test("tắt một ngân hàng thì hiện hộp xác nhận, huỷ thì không đổi gì", async ({ page }) => {
    await page.goto("/settings/banks");
    const row = page.locator("table tbody tr").first();
    const before = await row.innerText();

    await row.getByRole("button", { name: /^(Tắt|Bật lại)$/ }).click();

    const box = dialog(page);
    await expect(box).toBeVisible();
    // Hộp thoại phải nói HỆ QUẢ, không chỉ hỏi "có chắc không".
    await expect(box).toContainText(/không mở tài khoản mới|nhận tài khoản mới/i);

    await box.getByRole("button", { name: "Huỷ" }).click();
    await expect(box).toBeHidden();
    expect(await row.innerText()).toBe(before);
  });

  test("gõ Enter theo quán tính thì ĐÓNG hộp thoại chứ không xác nhận", async ({ page }) => {
    await page.goto("/settings/service-types");
    const row = page.locator("table tbody tr").first();
    const before = await row.innerText();

    await row.getByRole("button", { name: /^(Ngừng|Dùng lại)$/ }).click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Enter");

    await expect(dialog(page)).toBeHidden();
    expect(await row.innerText()).toBe(before);
  });
});

test.describe("báo lỗi phải đọc được", () => {
  test("thêm kênh trùng tên nói rõ trùng, không phải câu chung chung", async ({ page }) => {
    await page.goto("/settings/channels");
    // Ô ĐẦU của hàng, không phải cả hàng: `innerText` của hàng nối mọi ô bằng
    // tab, gửi lên thành một tên mới toanh và ca test lại đi tạo dữ liệu rác.
    const existing = (await page.locator("table tbody tr").first().locator("td").first().innerText()).trim();

    await page.getByRole("button", { name: /Thêm kênh/ }).click();
    const box = dialog(page);
    await box.getByLabel("Tên kênh").fill(existing);
    await box.getByRole("button", { name: /Tạo kênh|Lưu/ }).click();

    await expect(toast(page)).toContainText(/đã có/i);
    await expect(toast(page)).not.toContainText(/^Không lưu được$/);
  });

  test("hệ số dịch vụ vượt trần cột bị chặn ngay dưới ô nhập", async ({ page }) => {
    await page.goto("/settings/service-types");
    await page.getByRole("button", { name: /Thêm loại dịch vụ/ }).click();
    const box = dialog(page);
    await box.getByLabel("Tên loại dịch vụ").fill(`${TAG} loại thử`);
    await box.getByLabel("Hệ số điểm KPI").fill("100");
    await box.getByRole("button", { name: /Tạo loại dịch vụ/ }).click();

    // Chặn ở giao diện, không để Postgres từ chối rồi trả 500.
    await expect(box).toContainText(/Hệ số nhiều nhất/i);
    await expect(box).toBeVisible();
  });

  test("số ảnh bắt buộc nhập số lẻ bị chặn", async ({ page }) => {
    await page.goto("/settings/banks");
    await page.getByRole("button", { name: /Thêm ngân hàng/ }).click();
    const box = dialog(page);
    await box.getByLabel("Mã ngân hàng").fill(`${TAG}1`);
    await box.getByLabel("Số ảnh bắt buộc").fill("3.5");
    await box.getByRole("button", { name: /Tạo ngân hàng|Lưu/ }).click();

    await expect(box).toContainText(/số nguyên/i);
  });
});

test.describe("kho mã giới thiệu — phân trang ở máy chủ", () => {
  test("gõ tìm chỉ gọi máy chủ một lần, và luôn kèm bộ lọc", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/settings/referral-codes?")) calls.push(r.url());
    });

    await page.goto("/settings/referral-codes");
    await expect(page.locator("main")).toContainText(/mã/);
    calls.length = 0;

    await page.getByRole("searchbox", { name: "Tìm mã" }).pressSequentially("VPa123", { delay: 60 });
    await page.waitForTimeout(1200);

    // Không hoãn thì 6 ký tự là 6 lượt gọi, mỗi lượt một phép gộp trên cả bảng
    // tài khoản.
    expect(calls.length, `gõ 6 ký tự nhưng gọi ${calls.length} lần`).toBe(1);
    expect(calls[0]).toContain("search=VPa123");
    expect(calls[0]).toContain("page=0");
  });

  test("đổi bộ lọc thì quay về trang đầu", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/settings/referral-codes?")) calls.push(r.url());
    });
    await page.goto("/settings/referral-codes");
    await page.waitForTimeout(500);
    calls.length = 0;

    await page.getByLabel("Trạng thái").selectOption({ label: "Đã đầy" });
    await page.waitForTimeout(700);

    expect(calls.at(-1)).toContain("status=full");
    expect(calls.at(-1)).toContain("page=0");
  });

  test("kho rỗng nói 'kho đang rỗng', không đổ lỗi cho bộ lọc", async ({ page }) => {
    await page.goto("/settings/referral-codes");
    await page.waitForTimeout(600);
    const main = await page.locator("main").innerText();
    if (/Kho mã đang rỗng/.test(main)) {
      expect(main).not.toContain("Không có mã nào khớp bộ lọc");
    }
  });
});

test.describe("danh mục tỉnh/xã", () => {
  test("ô chọn tỉnh không liệt kê tỉnh đã thêm", async ({ page }) => {
    await page.goto("/settings/channels");
    await page.waitForTimeout(700);

    const added = await page.locator("[class*=provinceName]").allInnerTexts();
    test.skip(added.length === 0, "chưa triển khai tỉnh nào");

    await page.getByRole("button", { name: /Thêm tỉnh/ }).click();
    await page.getByRole("combobox", { name: /Tỉnh/ }).click();
    await page.waitForTimeout(400);
    const offered = await page.locator("li").allInnerTexts();

    for (const name of added.map((s) => s.trim()).filter(Boolean)) {
      expect(offered.map((s) => s.trim()), `${name} đã thêm rồi mà vẫn còn trong ô chọn`).not.toContain(name);
    }
  });
});

test.describe("trạng thái tải và rỗng", () => {
  test("màn danh mục quà không im lặng khi tải hỏng", async ({ page }) => {
    await page.route("**/api/settings/gift-items", (r) => r.fulfill({ status: 500, body: "{}" }));
    await page.goto("/settings/gift-catalog");

    // Trước đây hỏng mà im lặng trông y hệt "danh mục rỗng" — quản trị sẽ nhập
    // lại toàn bộ và làm nhân đôi danh mục.
    await expect(page.locator("main")).toContainText(/Không tải được/i);
  });

  test("bảng không có dòng nào thì nói rõ, không để trơ hàng tiêu đề", async ({ page }) => {
    await page.route("**/api/settings/banks", (r) => r.fulfill({ status: 200, body: "[]" }));
    await page.goto("/settings/banks");
    await expect(page.locator("main")).toContainText(/Chưa có ngân hàng nào/i);
  });
});

test.describe("chỉ tiêu KPI", () => {
  test("chưa đặt mốc thì nói rõ hai số là gợi ý", async ({ page }) => {
    await page.route("**/api/settings/kpi-target", async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ status: 200, body: "null" });
      return route.continue();
    });
    await page.goto("/settings/kpi-target");

    await expect(page.locator("main")).toContainText(/Chưa đặt chỉ tiêu/i);
    await expect(page.locator("main")).toContainText(/gợi ý/i);
  });
});

test.describe("danh mục ấp", () => {
  test("hai ấp trùng tên trong cùng một xã bị chặn, báo rõ lý do", async ({ page }) => {
    await page.goto("/settings/channels");
    await page.waitForTimeout(800);

    const addHamlet = page.getByRole("button", { name: /Thêm ấp/ }).first();
    test.skip((await addHamlet.count()) === 0, "chưa triển khai xã nào");

    const name = `${TAG} ấp trùng`;
    for (const attempt of [1, 2]) {
      await addHamlet.click();
      const box = dialog(page);
      await box.getByLabel(/Tên ấp/).fill(name);
      await box.getByRole("button", { name: "Tạo ấp" }).click();
      await page.waitForTimeout(900);

      if (attempt === 2) {
        // Lần hai phải nói rõ trùng, KHÔNG được im lặng báo "đã lưu" rồi không
        // thêm gì — người dùng sẽ bấm lại vài lần rồi đi hỏi.
        await expect(toast(page)).toContainText(/trùng tên/i);
      }
    }
  });
});
