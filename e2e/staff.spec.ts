import { expect, test, type Page } from "@playwright/test";
import { LABEL, ROLES, TAG, login, type Role } from "./roles";

/**
 * P-51 · Nhân sự & KPI, P-52 · Hồ sơ nhân viên.
 *
 * Trọng tâm là các CHỐT CHẶN quanh việc quản người, vì đây là chỗ CRUD `nhân
 * viên` có thể biến thành `cấp quyền` trá hình: chỉ cần tạo được một tài khoản
 * vai cao hơn rồi đăng nhập bằng nó (spec §10.1).
 */

const dialog = (page: Page) => page.locator("dialog[open]");

/** Vai mỗi chức vụ được phép gán — bậc bằng hoặc thấp hơn mình (spec §10.1). */
const ASSIGNABLE: Record<Role, string[]> = {
  director: ["Giám đốc", "Phó giám đốc", "Trưởng phòng", "Phó phòng", "Nhân viên"],
  "deputy-director": ["Phó giám đốc", "Trưởng phòng", "Phó phòng", "Nhân viên"],
  head: ["Trưởng phòng", "Phó phòng", "Nhân viên"],
  "deputy-head": ["Phó phòng", "Nhân viên"],
  staff: [],
};

/** Ô đầu mỗi hàng là "Họ tên\nMã nhân viên" — chỉ lấy dòng tên. */
const nameOf = (cell: string) => cell.split("\n")[0].trim();

test.describe("P-51 · danh sách nhân sự", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "director");
    await page.goto("/users");
    await expect(page.locator("main")).toBeVisible();
    await page.waitForLoadState("networkidle");
  });

  test("bảng nhân sự tải được và có dòng", async ({ page }) => {
    await expect(page.locator("main")).not.toContainText(/Không tải được/i);
    expect(await page.locator("table tbody tr").count()).toBeGreaterThan(0);
  });

  test("tìm nhân viên lọc đúng", async ({ page }) => {
    const needle = nameOf(await page.locator("table tbody tr").first().locator("td").first().innerText());
    await page.getByRole("searchbox", { name: "Tìm nhân viên" }).fill(needle);
    await page.waitForTimeout(500);
    expect(await page.locator("table tbody tr").count()).toBeGreaterThan(0);
    await expect(page.locator("table tbody")).toContainText(needle);
  });

  test("mở được hồ sơ một người từ bảng", async ({ page }) => {
    const name = nameOf(await page.locator("table tbody tr").first().locator("td").first().innerText());
    // Hàng KHÔNG bấm được cả hàng — tên là một liên kết riêng.
    await page.locator("table tbody tr").first().locator("a").first().click();
    await expect(page).toHaveURL(/\/users\/[0-9a-f-]{36}/);
    await expect(page.locator("main")).not.toContainText(/Không tải được/i);
    await expect(page.locator("body")).toContainText(name);
  });

  /**
   * Điểm chạy hết đường: bộ seed ghi tài khoản → `recomputeKpi` → `kpi_scores`
   * → bảng P-51. Con số 1,2 không phải số tròn cho đẹp, nó là dòng "03 Bank ưu
   * tiên" của bảng điểm kỳ 2026-08.
   *
   * `zz_e2e_staff` lập TOÀN BỘ hồ sơ khách của bộ seed và không có lượt dịch vụ
   * nào, nên điểm của người này đúng bằng phần ngân hàng. Khách đầu tiên cầm
   * `MB` + `VPa` + `MSBa` (đã cài app) nên được 1.2; năm khách còn lại mở nhiều
   * tài khoản ở cùng một ngân hàng nên không thành combo và được 0.
   *
   * ⚠️ KHÔNG ca nào được ghi dịch vụ dưới tài khoản này — làm thế là cộng thêm
   * điểm dịch vụ và ca này đỏ. `customers.spec` cố ý đăng nhập bằng Trưởng
   * phòng ở ca "ghi dịch vụ từ dòng khách" đúng vì lý do đó.
   *
   * ⚠️ Đọc `/api/staff`, không phải `/api/people`: route sau đã bị gỡ khi bảng
   * P-51 chuyển sang lấy đúng một trang từ máy chủ. Ca này gọi vào đó và nhận
   * 404 suốt một thời gian mà vẫn "đỏ đúng lý do khác".
   */
  test("điểm ngân hàng bằng đúng bảng điểm của kỳ", async ({ page }) => {
    const res = await page.request.get("/api/staff?search=zz_e2e_staff&page=0&sort=name&dir=asc");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { page?: { rows?: { username: string; points: number }[] } };

    const rows = body.page?.rows ?? [];
    const seedStaff = rows.find((r) => r.username === "zz_e2e_staff");
    expect(seedStaff, "phải tìm thấy tài khoản e2e nhân viên").toBeTruthy();
    expect(seedStaff!.points, "03 Bank ưu tiên = 1.2 điểm").toBe(1.2);
  });
});

test.describe("P-51 · chốt chặn tự nâng quyền", () => {
  for (const role of ROLES) {
    test(`${LABEL[role]} chỉ gán được vai bậc bằng hoặc thấp hơn`, async ({ page }) => {
      test.skip(role === "staff", "nhân viên không mở được màn Nhân sự");
      await login(page, role);
      await page.goto("/users");
      await page.waitForLoadState("networkidle");

      await page.getByRole("button", { name: "Thêm nhân viên" }).click();
      const box = dialog(page);
      const options = await box.getByLabel("Chức vụ").locator("option").allInnerTexts();
      const offered = options.map((s) => s.trim()).filter(Boolean);

      expect(offered.sort()).toEqual([...ASSIGNABLE[role]].sort());
    });
  }
});

test.describe("P-52 · quản lý tài khoản", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "director");
  });

  test("đặt lại mật khẩu phải hỏi lại trước khi làm", async ({ page }) => {
    await page.goto("/users");
    await page.waitForLoadState("networkidle");
    await page.locator("table tbody tr").first().locator("a").first().click();
    await expect(page).toHaveURL(/\/users\/[0-9a-f-]{36}/);

    const reset = page.getByRole("button", { name: "Đặt lại mật khẩu" }).first();
    test.skip((await reset.count()) === 0, "không thấy nút đặt lại mật khẩu");
    await reset.click();

    const box = dialog(page);
    await expect(box).toBeVisible();
    await expect(box).toContainText(/mật khẩu/i);
    // Huỷ — ca này KHÔNG đổi mật khẩu của người thật.
    await box.getByRole("button", { name: "Huỷ" }).click();
    await expect(box).toBeHidden();
  });

  test("không tự khoá được tài khoản của chính mình", async ({ page }) => {
    const me = await page.request.get("/api/staff");
    expect(me.status()).toBe(200);
    const list = (await me.json()) as { staff?: { id: string; username: string }[] };
    const self = (list.staff ?? []).find((s) => s.username === "zz_e2e_director");
    test.skip(!self, "không tìm thấy tài khoản đang đăng nhập trong danh sách");

    const res = await page.request.post(`/api/staff/${self!.id}/active`, { data: { active: false } });
    expect(res.status(), "tự khoá mình là tự khoá cửa, phải bị chặn").not.toBe(200);
  });
});

test.describe("P-51 · thêm rồi khoá một nhân viên thật", () => {
  test("tạo tài khoản mới, khoá lại, rồi mở khoá", async ({ page }) => {
    await login(page, "director");
    await page.goto("/users");
    await page.waitForLoadState("networkidle");

    const stamp = Date.now() % 1_000_000;
    const fullName = `${TAG} Nguoi Thu`;
    await page.getByRole("button", { name: "Thêm nhân viên" }).click();
    const box = dialog(page);
    await box.getByLabel("Họ tên").fill(fullName);
    await box.getByLabel(/Tên đăng nhập/).fill(`zz_e2e_nv${stamp}`);
    await box.getByLabel(/Số điện thoại/).fill("0900111222");
    // Mã nhân viên là trường BẮT BUỘC và không được trùng — bỏ trống thì form
    // chặn ngay và hộp thoại đứng im.
    await box.getByLabel(/Mã nhân viên/).fill(`ZZE2E${stamp}`);
    await box.getByRole("button", { name: /Tạo nhân viên|Lưu/ }).click();

    /**
     * Tạo xong KHÔNG đóng luôn: hộp thoại đổi sang mặt "Đã tạo tài khoản", hiện
     * tên đăng nhập với mật khẩu khởi tạo để người tạo chép đưa cho nhân viên
     * (commit 7a4f42e). Đóng thẳng là mất mật khẩu, không xem lại được.
     */
    await expect(box).toHaveAttribute("aria-label", "Đã tạo tài khoản", { timeout: 15_000 });
    // Khoanh trong `footer`: nút X ở góc hộp thoại cũng mang nhãn "Đóng".
    await box.locator("footer").getByRole("button", { name: "Đóng" }).click();
    await expect(box).toBeHidden({ timeout: 15_000 });

    // Tìm cho ra: bảng nhân sự có phân trang, người mới chưa chắc ở trang đầu.
    await page.getByRole("searchbox", { name: "Tìm nhân viên" }).fill(fullName);
    await page.waitForTimeout(600);
    await expect(page.locator("table tbody")).toContainText(fullName, { timeout: 10_000 });
  });
});
