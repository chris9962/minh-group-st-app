/**
 * Chụp ảnh màn hình cho trang Hướng dẫn (P-95) và đo toạ độ vòng tròn đánh số.
 *
 * Ảnh lưu vào `public/docs/`. Vòng tròn KHÔNG vẽ vào file ảnh — component
 * `AnnotatedShot` vẽ đè theo toạ độ %, nên script này in JSON toạ độ ra stdout
 * để dán vào `src/lib/docs/articles/*.ts`. Chụp lại màn sau khi giao diện đổi:
 * chạy lại script, thay số liệu marker, xong.
 *
 * Cần trước khi chạy:
 *   1. Dev server: `bun dev` (cổng 3002)
 *   2. Tài khoản test: `bun --env-file=.env.local scripts/e2e-seed.ts`
 * Chạy:  `bun scripts/docs-shots.ts`
 * Dọn:   `bun --env-file=.env.local scripts/e2e-clean.ts`
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3002";
const OUT_DIR = path.join(process.cwd(), "public", "docs");
const VIEWPORT = { width: 1280, height: 800 };

/** Trùng `scripts/e2e-seed.ts` — giám đốc mang trọn bộ quyền mặc định. */
const LOGIN = { username: "zz_e2e_director", password: "E2eTest!2026" };

type MarkerSpec = { n: number; target: Locator; label: string };

const pct = (v: number) => Math.round(v * 10) / 10;

/**
 * Chụp `frame` (không truyền thì cả khung nhìn) và đo tâm từng phần tử marker
 * theo % của ảnh — đúng hệ toạ độ `AnnotatedShot` dùng để vẽ.
 *
 * Chỉ chụp được phần đang thấy: app cuộn trong khung riêng chứ không cuộn cả
 * trang, nên `fullPage` không kéo dài ảnh được. Phần tử dưới mép khung nhìn
 * cho toạ độ >100% — marker đó phải bỏ, đừng dán vào bài.
 */
async function shoot(
  page: Page,
  name: string,
  markers: MarkerSpec[],
  opts: { frame?: Locator } = {},
) {
  const box = opts.frame
    ? await opts.frame.boundingBox()
    : { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height };
  if (!box) throw new Error(`Không đo được khung ảnh của ${name}`);

  const out: { n: number; x: number; y: number; label: string }[] = [];
  for (const m of markers) {
    const b = await m.target.boundingBox();
    if (!b) throw new Error(`Không thấy phần tử marker ${m.n} của ${name}`);
    out.push({
      n: m.n,
      x: pct(((b.x + b.width / 2 - box.x) / box.width) * 100),
      y: pct(((b.y + b.height / 2 - box.y) / box.height) * 100),
      label: m.label,
    });
  }

  const file = path.join(OUT_DIR, `${name}.png`);
  if (opts.frame) await opts.frame.screenshot({ path: file, scale: "css" });
  else await page.screenshot({ path: file, scale: "css" });

  console.log(`\n=== ${name}.png (${Math.round(box.width)}×${Math.round(box.height)})`);
  console.log(JSON.stringify(out, null, 2));
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Điều hướng chính" });
const dialog = (page: Page) => page.locator("dialog[open]");

/** Mở nhóm Cấu hình trên sidebar — marker đường vào cần thấy mục con. */
async function openSettingsGroup(page: Page) {
  const group = nav(page).getByRole("button", { name: "Cấu hình" });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
}

/**
 * Làm mờ dữ liệu của người thật TRƯỚC khi chụp.
 *
 * Ảnh docs commit vào repo và hiện cho MỌI nhân viên mở được bài — không lọc
 * theo phạm vi quyền như màn thật. Tên khách, tên nhân viên, tên đăng nhập vì
 * vậy không được lên ảnh.
 *
 * Ba chỗ mang dữ liệu người thật: thân bảng, giá trị của danh sách định nghĩa ở
 * màn chi tiết, và tiêu đề trang của màn chi tiết — nơi tiêu đề CHÍNH LÀ tên
 * người. Style tag mất khi điều hướng nên gọi lại sau mỗi `goto`.
 */
async function blurPersonalData(
  page: Page,
  opts: { title?: boolean; extra?: string[] } = {},
) {
  const rules = ['main tbody', 'main dd', ...(opts.extra ?? [])];
  if (opts.title) rules.push('header h1');
  await page.addStyleTag({ content: `${rules.join(', ')} { filter: blur(7px); }` });
}

/**
 * Ba luồng nghiệp vụ đều mở `CustomerPickerDialog` trước. Danh sách chỉ hiện
 * khi có từ khoá tìm, nên gõ tiền tố khách test rồi chọn dòng đầu.
 */
async function pickAnyCustomer(page: Page) {
  await dialog(page).getByRole("searchbox", { name: "Tìm khách hàng" }).fill("ZZE2E-KH");
  const row = dialog(page).getByRole("button", { name: /ZZE2E/ }).first();
  await row.waitFor();
  await row.click();
}

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });

await page.goto(`${BASE_URL}/login`);
await page.getByLabel("Tài khoản").fill(LOGIN.username);
await page.getByRole("textbox", { name: "Mật khẩu" }).fill(LOGIN.password);
await page.getByRole("button", { name: "Đăng nhập" }).click();
await page.waitForURL(`${BASE_URL}/`);

/* ── Khách hàng ── */
await page.goto(`${BASE_URL}/customers`);
await page.getByRole("button", { name: "Thêm khách hàng" }).waitFor();
await blurPersonalData(page);
await shoot(page, "customers-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Khách hàng" }), label: "Mục Khách hàng trên thanh điều hướng." },
  { n: 2, target: page.getByRole("searchbox", { name: "Tìm khách hàng" }), label: "Ô tìm kiếm — tìm hồ sơ khách đã có." },
  { n: 3, target: page.getByRole("button", { name: "Thêm khách hàng" }), label: "Nút Thêm khách hàng mở biểu mẫu tạo hồ sơ." },
]);

await page.getByRole("button", { name: "Thêm khách hàng" }).click();
await dialog(page).waitFor();
await shoot(page, "customer-form", [
  { n: 1, target: dialog(page).getByLabel("Họ tên"), label: "Họ tên khách — bắt buộc." },
  { n: 2, target: dialog(page).getByLabel("CCCD"), label: "CCCD 12 số — hệ thống chặn số trùng." },
  { n: 3, target: dialog(page).getByLabel("Địa chỉ"), label: "Địa chỉ — gõ để tìm, chọn xong gõ thêm số nhà." },
  { n: 4, target: dialog(page).getByRole("textbox", { name: "Số điện thoại 1" }), label: "Số điện thoại liên lạc chính." },
  { n: 5, target: page.getByRole("button", { name: "Tạo khách hàng", exact: true }), label: "Nút Tạo khách hàng — lưu hồ sơ." },
], { frame: dialog(page) });
await page.keyboard.press("Escape");

/* ── Ngân hàng: mở tài khoản ── */
await page.goto(`${BASE_URL}/banking`);
await page.getByRole("button", { name: "Tạo tài khoản ngân hàng" }).waitFor();
await blurPersonalData(page);
await shoot(page, "banking-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Ngân hàng" }), label: "Mục Ngân hàng trên thanh điều hướng." },
  { n: 2, target: page.getByRole("button", { name: "Tạo tài khoản ngân hàng" }), label: "Nút Tạo tài khoản ngân hàng — bước đầu là chọn khách." },
]);

await page.getByRole("button", { name: "Tạo tài khoản ngân hàng" }).click();
await dialog(page).getByRole("searchbox", { name: "Tìm khách hàng" }).waitFor();
await dialog(page).getByRole("searchbox", { name: "Tìm khách hàng" }).fill("ZZE2E-KH");
await dialog(page).getByRole("button", { name: /ZZE2E/ }).first().waitFor();
await shoot(page, "customer-picker", [
  { n: 1, target: dialog(page).getByRole("searchbox", { name: "Tìm khách hàng" }), label: "Ô Tìm khách hàng — tra được mọi hồ sơ trong công ty." },
  { n: 2, target: dialog(page).getByRole("button", { name: /ZZE2E/ }).first(), label: "Bấm một khách để sang bước điền biểu mẫu." },
], { frame: dialog(page) });

await pickAnyCustomer(page);
const bankPickHead = dialog(page).getByText("Chọn ngân hàng", { exact: true });
await bankPickHead.waitFor();
await dialog(page).getByRole("checkbox").first().check();
await shoot(page, "bank-account-form", [
  { n: 1, target: bankPickHead, label: "Danh sách ngân hàng — tích ngân hàng muốn mở." },
  { n: 2, target: dialog(page).getByLabel(/Mã giới thiệu ·/).first(), label: "Ô mã giới thiệu — hệ thống gợi ý sẵn mã dùng được." },
  { n: 3, target: dialog(page).getByRole("button", { name: "Tạo tài khoản", exact: true }), label: "Nút Tạo tài khoản — tạo bản nháp." },
], { frame: dialog(page) });
await page.keyboard.press("Escape");

/* ── Bảo hiểm: tạo đơn ── */
await page.goto(`${BASE_URL}/insurance`);
await page.getByRole("button", { name: "Tạo đơn bảo hiểm" }).waitFor();
await blurPersonalData(page);
await shoot(page, "insurance-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Bảo hiểm" }), label: "Mục Bảo hiểm trên thanh điều hướng." },
  { n: 2, target: page.getByRole("button", { name: "Tạo đơn bảo hiểm" }), label: "Nút Tạo đơn bảo hiểm — bước đầu là chọn khách." },
]);

await page.getByRole("button", { name: "Tạo đơn bảo hiểm" }).click();
await dialog(page).getByRole("searchbox", { name: "Tìm khách hàng" }).waitFor();
await pickAnyCustomer(page);
await dialog(page).getByLabel("Gói bảo hiểm").waitFor();
// Phần khách hàng và ngày/phí chỉ hiện sau khi chọn gói — chọn gói đầu tiên.
await dialog(page).getByLabel("Gói bảo hiểm").selectOption({ index: 1 });
await dialog(page).getByLabel("Họ tên").first().waitFor();
await shoot(page, "insurance-form", [
  { n: 1, target: dialog(page).getByLabel("Gói bảo hiểm"), label: "Gói bảo hiểm — quyết định biểu mẫu hỏi thêm ô nào." },
  { n: 2, target: dialog(page).getByLabel("Họ tên").first(), label: "Khối Khách hàng — nút Điền theo hồ sơ khách lấy sẵn thông tin." },
  { n: 3, target: dialog(page).getByRole("button", { name: "Tạo đơn", exact: true }), label: "Nút Tạo đơn." },
], { frame: dialog(page) });
await page.keyboard.press("Escape");

/* ── Dịch vụ: ghi một lượt ── */
await page.goto(`${BASE_URL}/services`);
await page.getByRole("button", { name: "Ghi dịch vụ" }).waitFor();
await blurPersonalData(page);
await shoot(page, "services-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Dịch vụ" }), label: "Mục Dịch vụ trên thanh điều hướng." },
  { n: 2, target: page.getByRole("button", { name: "Ghi dịch vụ" }), label: "Nút Ghi dịch vụ — bước đầu là chọn khách." },
]);

await page.getByRole("button", { name: "Ghi dịch vụ" }).click();
await dialog(page).getByRole("searchbox", { name: "Tìm khách hàng" }).waitFor();
await pickAnyCustomer(page);
await dialog(page).getByLabel("Loại dịch vụ").waitFor();
await shoot(page, "service-form", [
  { n: 1, target: dialog(page).getByLabel("Loại dịch vụ"), label: "Loại dịch vụ — quyết định hệ số điểm KPI." },
  { n: 2, target: dialog(page).getByLabel("Ngày thực hiện"), label: "Ngày thực hiện." },
  { n: 3, target: dialog(page).getByLabel("Tỉnh/thành phố"), label: "Nơi làm dịch vụ — chọn tỉnh rồi xã/phường." },
  { n: 4, target: dialog(page).getByRole("button", { name: "Lưu", exact: true }), label: "Nút Lưu." },
], { frame: dialog(page) });
await page.keyboard.press("Escape");

/* ── Nhân sự ── */
await page.goto(`${BASE_URL}/users`);
await page.getByRole("button", { name: "Thêm nhân viên" }).waitFor();
await blurPersonalData(page);
await shoot(page, "users-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Nhân sự" }), label: "Mục Nhân sự trên thanh điều hướng." },
  { n: 2, target: page.getByRole("button", { name: "Thêm nhân viên" }), label: "Nút Thêm nhân viên." },
]);

await page.getByRole("button", { name: "Thêm nhân viên" }).click();
await dialog(page).waitFor();
await shoot(page, "staff-form", [
  { n: 1, target: dialog(page).getByLabel("Họ tên"), label: "Họ tên nhân viên." },
  { n: 2, target: dialog(page).getByLabel("Mã nhân viên"), label: "Mã nhân viên theo danh sách nhân sự." },
  { n: 3, target: dialog(page).getByLabel("Tên đăng nhập"), label: "Tên đăng nhập — hệ thống tự sinh, sửa được." },
  { n: 4, target: dialog(page).getByLabel("Đơn vị"), label: "Đơn vị — phòng nhân viên thuộc về." },
  { n: 5, target: dialog(page).getByLabel("Chức vụ"), label: "Chức vụ — quyết định bộ quyền mặc định." },
  { n: 6, target: page.getByRole("button", { name: "Tạo nhân viên", exact: true }), label: "Nút Tạo nhân viên." },
], { frame: dialog(page) });

/* Vẫn trong hộp thoại: mở khối Quyền để chụp lưới cấp quyền (P-92). */
await dialog(page).locator("summary").click();
await dialog(page).getByText("Toàn quyền").waitFor();
await shoot(page, "staff-permissions", [
  { n: 1, target: dialog(page).locator("summary"), label: "Khối Quyền — bấm để mở." },
  { n: 2, target: dialog(page).getByText("Toàn quyền"), label: "Công tắc Toàn quyền — cấp đủ mọi quyền, phạm vi toàn công ty." },
  // Các dòng quyền lẻ nằm dưới vùng cuộn của hộp thoại — ngoài khung ảnh,
  // không đánh số được; bước hướng dẫn trong bài vẫn nhắc tới chúng.
], { frame: dialog(page) });
await page.keyboard.press("Escape");

/* ── Kho mã giới thiệu ── */
await page.goto(`${BASE_URL}/settings/banks`);
await openSettingsGroup(page);
// SectionTabs dựng bằng radio ẩn trong label — bấm và đo theo chữ của label.
const banksTab = page
  .getByRole("group", { name: "Khu vực" })
  .getByText("Danh sách ngân hàng");
const codesTab = page
  .getByRole("group", { name: "Khu vực" })
  .getByText("Kho mã giới thiệu");

await page.getByRole("button", { name: "Thêm ngân hàng" }).waitFor();
await shoot(page, "banks-page", [
  { n: 1, target: banksTab, label: "Tab Danh sách ngân hàng." },
  { n: 2, target: page.getByRole("button", { name: "Thêm ngân hàng" }), label: "Nút Thêm ngân hàng — chỉ người quản mọi ngân hàng thấy." },
]);

await codesTab.click();
await page.getByRole("button", { name: "Thêm mã giới thiệu" }).waitFor();
await shoot(page, "referral-codes-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Ngân hàng & mã giới thiệu" }), label: "Đường vào: Cấu hình → Ngân hàng & mã giới thiệu." },
  { n: 2, target: codesTab, label: "Tab Kho mã giới thiệu." },
  { n: 3, target: page.getByRole("button", { name: "Thêm mã giới thiệu" }), label: "Nút Thêm mã." },
]);

await page.getByRole("button", { name: "Thêm mã giới thiệu" }).click();
await dialog(page).waitFor();
await shoot(page, "referral-code-form", [
  { n: 1, target: dialog(page).getByLabel("Ngân hàng"), label: "Ngân hàng của mã — mỗi mã thuộc đúng một ngân hàng." },
  { n: 2, target: dialog(page).getByLabel("Mã giới thiệu"), label: "Chuỗi mã, ví dụ VPA-2026-01." },
  { n: 3, target: dialog(page).getByLabel("Tổng số lượt dùng"), label: "Tổng số lượt dùng." },
  { n: 4, target: dialog(page).getByLabel("Độ ưu tiên"), label: "Độ ưu tiên — mã cao hơn đứng trước trong danh sách gợi ý." },
  // "Phạm vi sử dụng" nằm dưới vùng cuộn của hộp thoại — ngoài khung ảnh,
  // không đánh số được; bước hướng dẫn trong bài vẫn nhắc tới nó.
  { n: 5, target: page.getByRole("button", { name: "Tạo mã", exact: true }), label: "Nút Tạo mã — nạp mã vào kho." },
], { frame: dialog(page) });
await page.keyboard.press("Escape");

/* ── Các màn cấu hình còn lại ── */
await page.goto(`${BASE_URL}/settings/gift-rules`);
await openSettingsGroup(page);
await page.getByRole("heading", { name: "Nút thử" }).waitFor();
await shoot(page, "gift-rules-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Quy tắc quà" }), label: "Đường vào: Cấu hình → Quy tắc quà." },
  { n: 2, target: page.getByRole("heading", { name: "Nút thử" }), label: "Khối Nút thử — nhập tình huống khách." },
]);

await page.goto(`${BASE_URL}/settings/gift-catalog`);
await openSettingsGroup(page);
await page.getByRole("heading", { name: "Vật phẩm" }).waitFor();
await shoot(page, "gift-catalog-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Danh mục quà & gói BH" }), label: "Đường vào: Cấu hình → Danh mục quà & gói BH." },
  { n: 2, target: page.getByRole("heading", { name: "Vật phẩm" }), label: "Bảng Vật phẩm — món quà dùng khi phát quà." },
  { n: 3, target: page.getByRole("heading", { name: "Gói bảo hiểm", exact: true }), label: "Bảng Gói bảo hiểm — gói hiện khi tạo đơn." },
]);

await page.goto(`${BASE_URL}/settings/kpi-target`);
await openSettingsGroup(page);
await page.getByLabel("Chỉ tiêu điểm mỗi tháng").waitFor();
await shoot(page, "kpi-target-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Chỉ tiêu KPI" }), label: "Đường vào: Cấu hình → Chỉ tiêu KPI." },
  { n: 2, target: page.getByLabel("Chỉ tiêu điểm mỗi tháng"), label: "Mốc điểm tháng chung cho toàn công ty." },
  { n: 3, target: page.getByRole("button", { name: "Lưu chỉ tiêu" }), label: "Nút Lưu chỉ tiêu." },
]);

await page.goto(`${BASE_URL}/settings/service-types`);
await openSettingsGroup(page);
await page.getByRole("button", { name: "Thêm loại dịch vụ" }).waitFor();
await shoot(page, "service-types-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Loại dịch vụ" }), label: "Đường vào: Cấu hình → Loại dịch vụ." },
  { n: 2, target: page.getByRole("button", { name: "Thêm loại dịch vụ" }), label: "Nút Thêm loại dịch vụ." },
]);

await page.goto(`${BASE_URL}/settings/channels`);
await openSettingsGroup(page);
await page.getByRole("main").getByRole("heading", { name: "Danh mục kênh" }).waitFor();
await shoot(page, "channels-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Danh mục kênh" }), label: "Đường vào: Cấu hình → Danh mục kênh." },
  { n: 2, target: page.getByRole("main").getByRole("heading", { name: "Danh mục kênh" }), label: "Bảng kênh nguồn khách." },
  { n: 3, target: page.getByRole("heading", { name: "Danh mục tỉnh / xã / ấp" }), label: "Danh mục xã/ấp — địa bàn cho kênh Ấp và kênh Định danh." },
  // Khối Danh mục bệnh viện nằm dưới mép khung nhìn — ngoài khung ảnh,
  // không đánh số được; bước hướng dẫn trong bài vẫn nhắc tới nó.
]);

/* ── Xuất dữ liệu & nhật ký ── */
await page.goto(`${BASE_URL}/exports`);
await page.getByRole("button", { name: "Xuất Excel" }).waitFor();
await blurPersonalData(page);
await shoot(page, "exports-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Xuất dữ liệu" }), label: "Mục Xuất dữ liệu trên thanh điều hướng." },
  { n: 2, target: page.getByRole("group", { name: "Báo cáo" }), label: "Hàng tab báo cáo." },
  { n: 3, target: page.getByRole("button", { name: "Xuất Excel" }), label: "Nút Xuất Excel." },
]);

await page.goto(`${BASE_URL}/audit-log`);
// Hai ô lọc Người/Hành động nằm trong hộp Bộ lọc — mở ra rồi mới đo được.
await page.getByRole("button", { name: "Bộ lọc" }).click();
await page.getByLabel("Người").waitFor();
await blurPersonalData(page);
await shoot(page, "audit-log-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Nhật ký truy vết" }), label: "Mục Nhật ký truy vết trên thanh điều hướng." },
  { n: 2, target: page.getByLabel("Người"), label: "Lọc theo người thao tác." },
  { n: 3, target: page.getByLabel("Hành động"), label: "Lọc theo loại hành động." },
]);

/* ── Tổng quan · Phòng ban · Thông tin cá nhân ── */
await page.goto(`${BASE_URL}/`);
await page.getByRole("heading", { name: "Tổng quan" }).waitFor();
await blurPersonalData(page);
await shoot(page, "dashboard-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Tổng quan" }), label: "Mục Tổng quan trên thanh điều hướng." },
  { n: 2, target: page.getByRole("button", { name: "Bộ lọc" }).or(page.locator(".desktop-only").first()), label: "Bộ chọn kỳ — đổi khoảng thời gian của số liệu." },
]);

await page.goto(`${BASE_URL}/departments`);
await page.getByRole("button", { name: "Thêm phòng ban" }).waitFor();
await blurPersonalData(page);
await shoot(page, "departments-page", [
  { n: 1, target: nav(page).getByRole("link", { name: "Phòng ban" }), label: "Mục Phòng ban trên thanh điều hướng." },
  { n: 2, target: page.getByRole("button", { name: "Thêm phòng ban" }), label: "Nút Thêm phòng ban." },
]);

await page.goto(`${BASE_URL}/profile`);
await page.getByRole("button", { name: "Đổi mật khẩu" }).waitFor();
await shoot(page, "profile-page", [
  { n: 1, target: page.getByRole("heading", { name: "Tài khoản" }), label: "Khối Tài khoản — tên đăng nhập, chức danh, số quyền được cấp." },
  { n: 2, target: page.getByRole("button", { name: "Đổi mật khẩu" }), label: "Nút Đổi mật khẩu." },
]);

await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
await dialog(page).getByRole("textbox", { name: "Mật khẩu hiện tại" }).waitFor();
await shoot(page, "change-password-form", [
  { n: 1, target: dialog(page).getByRole("textbox", { name: "Mật khẩu hiện tại" }), label: "Mật khẩu hiện tại." },
  { n: 2, target: dialog(page).getByRole("textbox", { name: "Mật khẩu mới", exact: true }), label: "Mật khẩu mới." },
  { n: 3, target: dialog(page).getByRole("textbox", { name: "Nhập lại mật khẩu mới" }), label: "Nhập lại mật khẩu mới." },
], { frame: dialog(page) });
await page.keyboard.press("Escape");

/* ── Hồ sơ khách · tặng quà ── */
await page.goto(`${BASE_URL}/customers`);
await page.getByRole("searchbox", { name: "Tìm khách hàng" }).fill("ZZE2E-KH");
const customerLink = page.locator("main a[href^='/customers/']").first();
await customerLink.waitFor();
const giftButton = page.getByRole("button", { name: "Tặng quà" }).first();
await shoot(page, "gift-button", [
  { n: 1, target: giftButton, label: "Nút Tặng quà ở dòng của khách." },
]);

await customerLink.click();
await page.getByRole("heading", { name: "Thông tin" }).waitFor();
await blurPersonalData(page, { title: true });
await shoot(page, "customer-detail-page", [
  { n: 1, target: page.getByRole("heading", { name: "Thông tin" }), label: "Khối Thông tin — họ tên, địa chỉ, số điện thoại." },
  { n: 2, target: page.getByRole("heading", { name: "Tài khoản ngân hàng" }), label: "Khối Tài khoản ngân hàng — các tài khoản khách đã mở." },
]);

/* ── Hoàn tất tài khoản ngân hàng (bước 2) ── */
await page.goto(`${BASE_URL}/banking`);
await page.getByRole("button", { name: "Tạo tài khoản ngân hàng" }).waitFor();
// Phải đúng dòng BẢN NHÁP: dòng đã hoàn thành mở ra hộp thoại "Sửa tài khoản",
// không có nút Hoàn thành để chụp.
const draftRow = page.locator("main tbody tr").filter({ hasText: "Đang tạo" }).first();
await draftRow.locator("a[href^='/banking/']").first().click();
const finishDialog = page.getByRole("button", { name: "Hoàn thành" });
// Màn chi tiết nạp dữ liệu rồi mới dựng nút — chờ, đừng hỏi ngay sau click.
const hasDraft = await finishDialog
  .waitFor({ timeout: 15_000 })
  .then(() => true)
  .catch(() => false);
if (hasDraft) {
  // Ô Số tài khoản gợi ý sẵn SỐ ĐIỆN THOẠI của khách — mờ luôn, xem
  // `blurPersonalData`. Nút Hoàn thành nằm dưới mép khung nhìn nên không đánh
  // số được; bài nói tới nó bằng chữ.
  await blurPersonalData(page, { title: true, extra: ['main select', 'main input'] });
  await shoot(page, "bank-account-finish", [
    { n: 1, target: page.getByLabel("Số tài khoản"), label: "Số tài khoản ngân hàng vừa mở." },
    { n: 2, target: page.getByLabel("Ngày mở"), label: "Ngày mở tài khoản." },
    { n: 3, target: page.getByText("Ảnh chứng minh", { exact: false }).first(), label: "Ảnh chứng minh — tải đủ số ảnh thì nút Hoàn thành mới bấm được." },
  ]);
} else {
  console.log("\n(bo qua bank-account-finish: khong co ban nhap nao)");
}

/* ── Bảo hiểm: hàng chờ làm tay ── */
await page.goto(`${BASE_URL}/insurance`);
await page.getByRole("button", { name: "Tạo đơn bảo hiểm" }).waitFor();
await blurPersonalData(page);
await shoot(page, "insurance-queue", [
  { n: 1, target: page.getByRole("button", { name: "Bộ lọc" }), label: "Nút Bộ lọc — lọc trạng thái Chờ làm tay." },
  { n: 2, target: page.getByRole("button", { name: /Nhận xử lý/ }).first(), label: "Nút Nhận xử lý — nhận đơn về mình rồi nhập lên PVI." },
]);

/* ── Hồ sơ nhân viên: khoá tài khoản ── */
await page.goto(`${BASE_URL}/users`);
await page.getByRole("button", { name: "Thêm nhân viên" }).waitFor();
const staffLink = page.locator("main a[href^='/users/']").first();
await staffLink.click();
const accountTab = page.getByRole("group", { name: "Khu vực" }).getByText("Tài khoản & quyền");
await accountTab.click();
await page.getByRole("button", { name: "Đặt lại mật khẩu" }).waitFor();
await blurPersonalData(page, { title: true });
await shoot(page, "staff-account-tab", [
  { n: 1, target: accountTab, label: "Tab Tài khoản & quyền trong hồ sơ nhân viên." },
  { n: 2, target: page.getByRole("button", { name: "Đặt lại mật khẩu" }), label: "Nút Đặt lại mật khẩu — dùng khi nhân viên quên mật khẩu." },
  { n: 3, target: page.getByRole("button", { name: /Khoá tài khoản|Mở khoá/ }), label: "Nút Khoá tài khoản — dùng khi nhân viên nghỉ việc." },
]);

await browser.close();
console.log("\nẢnh đã lưu vào public/docs/. Dán toạ độ ở trên vào src/lib/docs/articles/*.ts.");
