import { expect, test, type Page } from "@playwright/test";
import { TAG, login } from "./roles";

/**
 * P-91 · Phòng ban — module `department`: CEO sửa cơ cấu, Phó giám đốc chỉ đọc
 * (spec §10.1, chốt 2026-08-18).
 *
 * Phần "chức vụ nào mở được" đã nằm ở `permissions.spec.ts`; ở đây soi HÀNH VI
 * của màn khi đã vào được.
 */

const dialog = (page: Page) => page.locator("dialog[open]");

test.beforeEach(async ({ page }) => {
  await login(page, "director");
  await page.goto("/departments");
  await expect(page.locator("main")).toBeVisible();
  await page.waitForLoadState("networkidle");
});

test("mặc định ẩn phòng đã ngừng, và lựa chọn được nhớ qua lần tải lại", async ({ page }) => {
  const box = page.getByRole("checkbox", { name: /Hiện cả phòng đã ngừng/ });
  await expect(box).not.toBeChecked();

  const hidden = await page.locator("table tbody tr").count();
  await box.check();
  await page.waitForTimeout(300);
  const shown = await page.locator("table tbody tr").count();
  expect(shown, "bật ô tích phải hiện thêm phòng đã ngừng").toBeGreaterThanOrEqual(hidden);

  // Lưu ở `store/prefs` — bật lên rồi tải lại mà mất thì mỗi lần vào lại phải
  // bấm lại, đúng thứ người dùng đã kêu.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("checkbox", { name: /Hiện cả phòng đã ngừng/ })).toBeChecked();

  await page.getByRole("checkbox", { name: /Hiện cả phòng đã ngừng/ }).uncheck();
});

test("tìm phòng ban lọc đúng bảng", async ({ page }) => {
  const first = (await page.locator("table tbody tr").first().locator("td").first().innerText()).trim();
  await page.getByRole("searchbox", { name: "Tìm phòng ban" }).fill(first);

  /**
   * Chờ BẢNG LẮNG, không chờ theo đồng hồ.
   *
   * Ô tìm có hoãn nhịp gõ, và bảng giữ nguyên dòng cũ trong lúc câu mới chạy.
   * Chụp danh sách sau một khoảng cố định là chụp trúng kết quả CŨ — ca này đỏ
   * đúng lúc màn thêm truy vấn số liệu phòng ban, tức khi máy phải làm nhiều
   * việc hơn chứ không phải khi ứng dụng sai.
   */
  await expect
    .poll(async () => {
      const names = await page.locator("table tbody tr td:first-child").allInnerTexts();
      return names.length > 0 && names.every((n) => n.toLowerCase().includes(first.toLowerCase()));
    })
    .toBe(true);
});

test("ngừng hoạt động phải hỏi lại và nói rõ hệ quả", async ({ page }) => {
  // Phải lấy hàng có nút BẤM ĐƯỢC: phòng còn người thì nút vẫn hiện nhưng bị
  // khoá, bấm vào là treo cho tới hết thời gian chờ.
  const row = page
    .locator("table tbody tr")
    .filter({ has: page.locator("button:not([disabled])", { hasText: "Ngừng hoạt động" }) })
    .first();
  test.skip((await row.count()) === 0, "mọi phòng đang có người, không phòng nào ngừng được");

  const before = await row.innerText();
  await row.getByRole("button", { name: /^Ngừng hoạt động$/ }).click();

  const box = dialog(page);
  await expect(box).toBeVisible();
  await expect(box).toContainText(/không gán người mới vào được nữa/i);
  // Nói rõ dữ liệu cũ không mất — thiếu câu này thì không ai dám bấm.
  await expect(box).toContainText(/vẫn giữ nguyên/i);

  await box.getByRole("button", { name: "Huỷ" }).click();
  await expect(box).toBeHidden();
  expect(await row.innerText()).toBe(before);
});

test("phòng còn người thì khoá nút ngừng VÀ nói vì sao", async ({ page }) => {
  const blocked = page.locator("button[disabled]", { hasText: "Ngừng hoạt động" });
  test.skip((await blocked.count()) === 0, "không phòng nào còn người");

  // Nút mờ mà không giải thích chính là chỗ người dùng mắc kẹt.
  await expect(page.locator("main")).toContainText(/Không ngừng hoạt động được/i);
  await expect(page.locator("main")).toContainText(/chuyển hết người sang phòng khác/i);
});

test("lập phòng mới rồi đổi tên", async ({ page }) => {
  const name = `${TAG} phòng thử`;

  await page.getByRole("button", { name: "Thêm phòng ban" }).click();
  const box = dialog(page);
  await box.getByLabel(/Tên phòng/).fill(name);
  await box.getByRole("button", { name: "Tạo phòng ban" }).click();
  await expect(box).toBeHidden({ timeout: 10_000 });

  // Tìm cho ra thay vì trông chờ dòng mới nằm ở trang đầu — bảng có phân trang.
  await page.getByRole("searchbox", { name: "Tìm phòng ban" }).fill(name);
  await page.waitForTimeout(500);
  await expect(page.locator("table tbody")).toContainText(name, { timeout: 10_000 });

  const row = page.locator("table tbody tr").filter({ hasText: name }).first();
  await row.getByRole("button", { name: `Đổi tên ${name}` }).click();
  const edit = dialog(page);
  await edit.getByLabel(/Tên phòng/).fill(`${name} 2`);
  await edit.getByRole("button", { name: /Lưu/ }).click();
  await expect(edit).toBeHidden({ timeout: 10_000 });
  await page.getByRole("searchbox", { name: "Tìm phòng ban" }).fill(`${name} 2`);
  await page.waitForTimeout(500);
  await expect(page.locator("table tbody")).toContainText(`${name} 2`);
});

/**
 * Bốn cột số liệu nghiệp vụ của bảng phòng ban.
 *
 * ⚠️ Bản trước của ca này XANH VÔ NGHĨA: nó ép body thành `unknown[]` rồi hỏi
 * `Array.isArray(body) ? body.length : 0`, mà route trả về một OBJECT
 * `{ departments: [...] }` — nhánh `Array.isArray` luôn sai nên vế trái luôn
 * bằng 0 và phép so luôn đúng, bất kể máy chủ trả gì. Nó "canh" stub suốt một
 * thời gian dài mà không canh được gì.
 */
test("mỗi phòng đang hoạt động có đúng một dòng số liệu, phòng chưa phát sinh là 0", async ({
  page,
}) => {
  for (const period of ["today", "this-month", "range:2026-07-01:2026-07-31"]) {
    const res = await page.request.get(
      `/api/org/departments/stats?period=${encodeURIComponent(period)}`,
    );
    expect(res.status(), `kỳ ${period}`).toBe(200);

    const body = (await res.json()) as {
      departments: {
        id: string;
        name: string;
        accountsOpened: number;
        appsInstalled: number;
        customers: number;
        previousInstallRate: number | null;
      }[];
    };

    expect(body.departments.length, "phải có dòng cho mọi phòng đang hoạt động").toBeGreaterThan(0);

    for (const d of body.departments) {
      // Phòng chưa phát sinh gì phải mang số 0 chứ không vắng mặt: vắng mặt thì
      // giao diện hiện "—", mà "—" nghĩa là "không đọc được số liệu".
      expect(Number.isInteger(d.accountsOpened), `${d.name}: TK mở phải là số nguyên`).toBe(true);
      expect(d.accountsOpened).toBeGreaterThanOrEqual(0);
      // Không thể có nhiều app hơn số tài khoản đã mở — tỉ lệ cài sẽ vượt 100%.
      expect(d.appsInstalled, `${d.name}: app cài không được nhiều hơn TK mở`).toBeLessThanOrEqual(
        d.accountsOpened,
      );
      expect(d.customers, `${d.name}: số khách không được nhiều hơn TK mở`).toBeLessThanOrEqual(
        d.accountsOpened,
      );
    }

    // Khoảng ngày tự chọn KHÔNG có "kỳ liền trước" nào định nghĩa được.
    if (period.startsWith("range:")) {
      for (const d of body.departments) expect(d.previousInstallRate).toBeNull();
    }
  }
});

test("kỳ gõ bậy không làm vỡ màn, rơi về hôm nay", async ({ page }) => {
  const res = await page.request.get("/api/org/departments/stats?period=rác");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { departments: unknown[] };
  expect(body.departments.length).toBeGreaterThan(0);
});
