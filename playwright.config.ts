import { defineConfig, devices } from "@playwright/test";

/**
 * E2E cho MGST — chạy trên server dev đang mở, không tự dựng server.
 *
 * Dữ liệu test là 5 tài khoản `zz_e2e_*` do `scripts/e2e-seed.ts` dựng trước và
 * `scripts/e2e-clean.ts` xoá sau (xem script `e2e` trong package.json). Chúng
 * mang ĐÚNG bộ quyền mặc định của từng chức vụ, khác với tài khoản thật vốn đã
 * bị sửa quyền tay nhiều lần.
 *
 * `workers: 1` — các ca dùng chung một database. Chạy song song thì ca này thêm
 * một dòng danh mục còn ca kia đang đếm số dòng.
 */
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3002",
    locale: "vi-VN",
    // Đội KD dùng điện thoại, nhưng bộ này soi bố cục desktop trước.
    viewport: { width: 1400, height: 950 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
