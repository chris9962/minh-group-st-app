import { expect, test } from "@playwright/test";
import { EDITS_CATALOG, LABEL, MANAGES_ORG, ROLES, login, navLabels, screenLoaded } from "./roles";

/**
 * Bộ test ở `docs/test-phan-quyen-2026-08-05.md`, nhóm A · B · F · I — nhưng đi
 * bằng GIAO DIỆN thật thay vì gọi API trần.
 *
 * Khác biệt quan trọng: gọi API chỉ chứng minh máy chủ chặn đúng. Đi bằng giao
 * diện còn bắt được chuyện "menu dẫn tới màn mà chính người đó không mở nổi" —
 * loại lỗi mà test API không bao giờ thấy.
 */

const SETTINGS_SCREENS = [
  ["/settings/banks", "Kho ngân hàng"],
  ["/settings/channels", "Danh mục kênh"],
  ["/settings/service-types", "Loại dịch vụ"],
  ["/settings/gift-catalog", "Danh mục quà"],
  ["/settings/referral-codes", "Kho mã giới thiệu"],
  ["/settings/kpi-target", "Chỉ tiêu KPI"],
] as const;

for (const role of ROLES) {
  test.describe(`${LABEL[role]}`, () => {
    test.beforeEach(async ({ page }) => {
      await login(page, role);
    });

    test("điều hướng hiện đúng mục", async ({ page }) => {
      const labels = await navLabels(page);

      expect(labels).toContain("Khách hàng");
      expect(labels.includes("Cấu hình")).toBe(EDITS_CATALOG[role]);
      expect(labels.includes("Phòng ban")).toBe(MANAGES_ORG[role]);
      expect(labels.includes("Nhật ký truy vết")).toBe(MANAGES_ORG[role]);

      // Nhân viên thấy "Chỉ tiêu của tôi" thay cho "Nhân sự" — hai màn khác
      // nhau, không phải cùng một màn đổi nhãn.
      expect(labels.includes("Nhân sự")).toBe(role !== "staff");
      expect(labels.includes("Chỉ tiêu của tôi")).toBe(role === "staff");

      // Không có mục "Phân quyền" trên sidebar với BẤT KỲ chức vụ nào — cấp
      // quyền lẻ (P-92) nằm trong hộp thoại sửa nhân viên, thẻ "Quyền".
      //
      // Lý do đã ĐỔI, dù câu khẳng định giữ nguyên: trước là "không ai cầm
      // `grant-permission`", giờ CEO cầm nó (toàn quyền từ 06/08) mà vẫn không
      // có mục, vì mục đó đã bị gỡ khỏi `lib/nav.ts`. Ghi rõ ra để ngày ai đó
      // đọc lại không tưởng ca này còn đang canh chuyện phân quyền.
      expect(labels).not.toContain("Phân quyền");
    });

    test("người có quyền mở được mọi màn cấu hình", async ({ page }) => {
      test.skip(!EDITS_CATALOG[role], "chức vụ này không sửa danh mục");
      for (const [path, title] of SETTINGS_SCREENS) {
        await page.goto(path);
        expect(await screenLoaded(page), `${title} phải mở được`).toBe(true);
      }
    });

    test("máy chủ vẫn chặn ghi dù giao diện có hiện nút hay không", async ({ page }) => {
      // AGENTS.md §6: ẩn nút không phải là phân quyền. Đây là vế "máy chủ vẫn
      // phải kiểm lại" — gọi thẳng API, bỏ qua giao diện.
      const res = await page.request.post("/api/settings/hospitals", { data: {} });
      expect(res.status(), `${LABEL[role]} POST bệnh viện`).toBe(EDITS_CATALOG[role] ? 400 : 403);
    });

    /**
     * Gõ thẳng đường dẫn phải bị chặn ở CHÍNH MÀN, không chỉ ẩn khỏi menu.
     *
     * Đọc danh mục mở cho mọi người (quyết định 05/08) nên màn vẫn nạp được dữ
     * liệu — nếu không chặn thì nhân viên gặp một bảng quản trị đầy nút "Sửa",
     * "Tắt", bấm vào là báo lỗi.
     */
    test("gõ thẳng đường dẫn màn cấu hình thì bị chặn tại màn", async ({ page }) => {
      test.skip(EDITS_CATALOG[role], "chỉ soi chức vụ không được sửa danh mục");
      for (const [path] of SETTINGS_SCREENS) {
        await page.goto(path);
        await expect(page.locator("main"), path).toContainText(/không có quyền mở màn này/i);
      }
    });

    test("màn phòng ban chỉ CEO mở được", async ({ page }) => {
      await page.goto("/departments");
      expect(await screenLoaded(page)).toBe(MANAGES_ORG[role]);
    });
  });
}

test("chưa đăng nhập thì bị đẩy về màn đăng nhập", async ({ page }) => {
  await page.goto("/settings/banks");
  await expect(page).toHaveURL(/\/login/);
});
