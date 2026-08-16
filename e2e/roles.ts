import { expect, type Page } from "@playwright/test";

/** Khớp với `scripts/e2e-seed.ts`. */
export const PASSWORD = "E2eTest!2026";

export const ROLES = ["director", "deputy-director", "head", "deputy-head", "staff"] as const;
export type Role = (typeof ROLES)[number];

export const LABEL: Record<Role, string> = {
  director: "CEO",
  "deputy-director": "Phó giám đốc",
  head: "Trưởng phòng",
  "deputy-head": "Phó phòng",
  staff: "Nhân viên",
};

/** Ai sửa được danh mục — quyết định 05/08: phó phòng trở lên. */
export const EDITS_CATALOG: Record<Role, boolean> = {
  director: true,
  "deputy-director": true,
  head: true,
  "deputy-head": true,
  staff: false,
};

/** Quản lý tổ chức vẫn chỉ CEO (spec §10.1, không nằm trong quyết định 05/08). */
export const MANAGES_ORG: Record<Role, boolean> = {
  director: true,
  "deputy-director": false,
  head: false,
  "deputy-head": false,
  staff: false,
};

/** Tiền tố cho mọi bản ghi test — `scripts/e2e-clean.ts` xoá theo tiền tố này. */
export const TAG = "ZZE2E";

export async function login(page: Page, role: Role) {
  await page.goto("/login");
  await page.getByLabel("Tài khoản").fill(`zz_e2e_${role}`);
  // `exact` là bắt buộc: nút hiện/ẩn cạnh ô mang nhãn "Hiện mật khẩu", mà
  // `getByLabel` khớp theo chuỗi con nên bỏ `exact` là trúng hai phần tử.
  await page.getByLabel("Mật khẩu", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /Đăng nhập/ }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

/** Nhãn các mục điều hướng đang hiện, gộp cả mục con trong nhóm Cấu hình. */
export async function navLabels(page: Page): Promise<string[]> {
  const nav = page.locator("nav").first();
  await expect(nav).toBeVisible();
  return (await nav.innerText())
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Màn có tải được nội dung không.
 *
 * Bám vào `ErrorState` chứ không bám vào mã HTTP: một màn có thể trả 200 rồi
 * mới hỏng lúc gọi API bên trong, mà người dùng thì chỉ thấy khối báo lỗi.
 *
 * PHẢI đợi khung xương tải xong. Đọc ngay lúc vừa vào thì chưa có khối báo lỗi
 * nào cả và ca test kết luận "màn mở được" — sai theo đúng cách khó thấy nhất.
 */
export async function screenLoaded(page: Page): Promise<boolean> {
  const main = page.locator("main");
  await expect(main).toBeVisible();
  await expect(main.locator("[class*=skeleton], [class*=Skeleton]")).toHaveCount(0, { timeout: 10_000 });
  await page.waitForLoadState("networkidle");
  return !/Không tải được|Bạn không có quyền/i.test(await main.innerText());
}
