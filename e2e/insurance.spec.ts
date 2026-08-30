import { expect, test, type Page } from "@playwright/test";
import { LABEL, ROLES, TAG, login, navLabels, screenLoaded } from "./roles";

/**
 * P-13 · P-14 đi bằng GIAO DIỆN THẬT, năm chức vụ.
 *
 * Bộ kiểm ở tầng nghiệp vụ đã chứng minh máy chủ chặn đúng. Đi bằng giao diện
 * bắt được loại lỗi khác hẳn: nút hiện ra mà bấm vào nhận 403, hoặc ngược lại
 * — người có quyền mà không có đường nào bấm tới.
 */

/** Cả năm vai đều tạo được đơn theo bộ quyền mặc định (`lib/roles.ts`). */
const CREATES: Record<(typeof ROLES)[number], boolean> = {
  director: true,
  "deputy-director": true,
  head: true,
  "deputy-head": true,
  staff: true,
};

/** Khách mẫu do `e2e-seed.ts` dựng. */
const CUSTOMER = "ZZE2E-KH B Đặng Văn Bốn";

const rowsOf = (page: Page) => page.locator("table tbody tr");

/**
 * Radix dựng MỖI toast hai lần: một bản nhìn thấy được và một bản ẩn trong
 * vùng `aria-live` cho trình đọc màn hình. Không lấy `.first()` là dính
 * "strict mode violation" — mà đó là dấu hiệu trợ năng đang chạy đúng, không
 * phải lỗi.
 */
const toast = (page: Page, re: RegExp) => page.getByText(re).first();

async function openInsurance(page: Page) {
  await page.goto("/insurance");
  expect(await screenLoaded(page), "P-13 phải mở được").toBe(true);
}

/**
 * Tạo một đơn qua ĐÚNG hộp thoại thật và trả về mã đơn.
 *
 * Mỗi ca tự dựng đơn của mình rồi bám theo mã: ca này chuyển một đơn sang
 * "Hoàn thành" còn ca kia đi tìm đơn "Chờ làm tay" thì dữ liệu dùng chung là
 * chỗ đỏ ngẫu nhiên, đỏ vì thứ tự chạy chứ không vì ứng dụng sai.
 */
/**
 * Chọn một tấm ảnh chứng nhận ở P-14 — ảnh CHƯA lên kho sau bước này.
 *
 * Từ chốt 2026-08-16, chọn ảnh chỉ giữ file trong máy; nó lên kho lúc bấm "Lưu
 * ảnh" hoặc "Đánh dấu hoàn thành". Dùng `setInputFiles` thẳng vào ô file vì ô
 * đó cố ý ẩn — người dùng thật bấm nút "Chọn ảnh" hoặc dán bằng Ctrl+V.
 */
async function attachPhoto(page: Page) {
  // PNG 1x1 hợp lệ — máy chủ kiểm chữ ký đầu file nên không dùng chuỗi bịa.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: `${TAG}-chung-nhan.png`, mimeType: "image/png", buffer: png });
  await expect(page.getByText("Chưa lưu")).toBeVisible();
}

async function createOrder(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Tạo đơn bảo hiểm" }).click();

  /**
   * Mọi thao tác khoanh trong hộp thoại.
   *
   * Nút Sửa/Huỷ của bảng phía sau mang TÊN KHÁCH trong `aria-label` (cố ý —
   * giữa mười lăm dòng giống nhau, "Sửa" một mình không nói đang sửa dòng nào),
   * nên tìm theo tên khách ở phạm vi cả trang là trúng nhầm chúng.
   */
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tìm khách hàng").fill(CUSTOMER);
  await dialog.getByRole("button", { name: new RegExp(CUSTOMER) }).click();

  await dialog.getByLabel("Gói bảo hiểm").selectOption({ label: "1 năm BH tai nạn điện" });
  // Đơn tai nạn điện bắt buộc có số thành viên (commit 2dee224) — bot PVI dừng
  // ở đúng ô này nếu nó bằng 0, nên form chặn ngay lúc nhập.
  await dialog.getByLabel("Số thành viên").fill("3");
  /**
   * Năm ô của người thụ hưởng, KHÔNG phải hai.
   *
   * Bản cũ chỉ điền họ tên với địa chỉ nên biểu mẫu dừng ở ba câu "Chưa chọn
   * ngày sinh người thụ hưởng", "Chưa nhập CCCD người thụ hưởng", "Chưa nhập số
   * điện thoại" — và toàn bộ 25 ca bảo hiểm dừng theo vì ca nào cũng gọi hàm này.
   *
   * Ngày sinh điền TÁM CHỮ SỐ `ddmmyyyy`: ô là `DateField`, nó chỉ giữ chữ số
   * rồi tự chèn dấu gạch. Người thụ hưởng KHÔNG chịu ràng buộc 15 tuổi — họ có
   * thể là con của khách (spec §U8).
   */
  await dialog.getByLabel("Họ tên").fill(`${TAG} Nguoi thu huong`);
  await dialog.getByLabel("Ngày sinh").fill("01011990");
  await dialog.getByLabel("CCCD").fill("077090001234");
  await dialog.getByLabel("Số điện thoại").fill("0900000077");
  await dialog.getByLabel("Địa chỉ").fill(`${TAG} dia chi`);
  await dialog.getByRole("button", { name: "Tạo đơn" }).click();

  // Toast là bằng chứng thao tác chạy tới nơi — hộp thoại tự đóng thôi thì
  // không phân biệt được "đã lưu" với "vừa bấm nhầm Huỷ".
  const banner = toast(page, /Đã tạo đơn DH-/);
  await expect(banner).toBeVisible();
  return (await banner.innerText()).match(/DH-\d{4}-\d{3}/)![0];
}

for (const role of ROLES) {
  test.describe(`${LABEL[role]}`, () => {
    test.beforeEach(async ({ page }) => {
      await login(page, role);
    });

    test("vào được P-13 từ điều hướng, bảng có dòng", async ({ page }) => {
      expect(await navLabels(page)).toContain("Bảo hiểm");

      await page.getByRole("link", { name: "Bảo hiểm" }).click();
      await expect(page).toHaveURL(/\/insurance$/);
      expect(await screenLoaded(page)).toBe(true);

      /**
       * Phải THẤY dòng, không chỉ "màn mở được".
       *
       * Đơn mẫu do `zz_e2e_staff` tạo trong phòng mà bốn vai kia quản, nên cả
       * năm vai đều phải có dòng. Bảng rỗng ở đây nghĩa là phạm vi phân giải ra
       * tập rỗng — đúng cái bẫy `managed` + 0 phòng quản.
       */
      await expect(rowsOf(page).first()).toBeVisible();
      await expect(rowsOf(page).first()).not.toContainText("Chưa có đơn");
    });

    test("nút Tạo đơn hiện đúng theo quyền", async ({ page }) => {
      await openInsurance(page);
      await expect(page.getByRole("button", { name: "Tạo đơn bảo hiểm" })).toBeVisible({
        visible: CREATES[role],
      });
    });

    test("tạo đơn thật, đơn hiện lên bảng ở Chờ làm tay", async ({ page }) => {
      test.skip(!CREATES[role], "chức vụ này không tạo đơn");
      await openInsurance(page);

      const code = await createOrder(page);
      const row = rowsOf(page).filter({ hasText: code });
      await expect(row).toBeVisible();
      // Chưa có bot PVI nên đơn mới nằm ở hàng chờ làm tay, không phải "Chờ tạo".
      await expect(row).toContainText("Chờ làm tay");
    });

    test("mở P-14, hai nút xử lý tay hiện đúng lượt", async ({ page }) => {
      await openInsurance(page);
      const code = await createOrder(page);

      await rowsOf(page).filter({ hasText: code }).getByRole("link").first().click();
      await expect(page).toHaveURL(/\/insurance\/[0-9a-f-]{36}$/);
      expect(await screenLoaded(page)).toBe(true);
      await expect(page.getByText("Dòng thời gian")).toBeVisible();

      const take = page.getByRole("button", { name: "Nhận đơn xử lý" });
      await expect(take).toBeVisible();
      await take.click();
      await expect(toast(page, /Bạn đang xử lý đơn/)).toBeVisible();

      // Bấm xong thì nút đổi, không còn nút cũ — hai nút cùng hiện là bấm nhầm.
      await expect(take).toBeHidden();
      const finish = page.getByRole("button", { name: "Đánh dấu hoàn thành" });
      await expect(finish).toBeVisible();
      // Chưa có ảnh chứng nhận thì nút KHOÁ, và màn nói rõ vì sao (chốt
      // 2026-08-16): `done` là trạng thái cuối, đánh dấu xong mới phát hiện
      // thiếu ảnh là không còn đường lùi.
      await expect(finish).toBeDisabled();
      await expect(page.getByText(/Phải đính ảnh chứng nhận/)).toBeVisible();

      await attachPhoto(page);
      await expect(finish).toBeEnabled();
      await finish.click();
      await expect(toast(page, /Đã hoàn thành đơn/)).toBeVisible();
      await expect(finish).toBeHidden();

      // Dòng thời gian ghi đủ ba bước: tạo → nhận → hoàn thành.
      await expect(page.getByText("Chờ làm tay → Đang làm tay")).toBeVisible();
      await expect(page.getByText("Đang làm tay → Hoàn thành")).toBeVisible();
    });

    test("đơn đã hoàn thành: hết đường sửa, còn đường đính ảnh", async ({ page }) => {
      await openInsurance(page);
      const code = await createOrder(page);

      await rowsOf(page).filter({ hasText: code }).getByRole("link").first().click();
      await page.getByRole("button", { name: "Nhận đơn xử lý" }).click();
      await attachPhoto(page);
      await page.getByRole("button", { name: "Đánh dấu hoàn thành" }).click();
      await expect(toast(page, /Đã hoàn thành đơn/)).toBeVisible();

      // Ảnh chứng nhận dùng được ở MỌI trạng thái (spec §3.4). Đơn đã có ảnh
      // từ bước hoàn thành nên nút mang nhãn "Đổi ảnh".
      await expect(page.getByRole("button", { name: /Chọn ảnh|Đổi ảnh/ })).toBeVisible();

      await openInsurance(page);
      const row = rowsOf(page).filter({ hasText: code });
      await expect(row).toContainText("Hoàn thành");
      // Cột Thao tác của dòng `done` phải trống — máy chủ từ chối cả sửa lẫn
      // xoá, hiện nút ở đây là hứa suông.
      await expect(row.getByRole("button", { name: /^Sửa đơn/ })).toHaveCount(0);
      await expect(row.getByRole("button", { name: /^Xoá đơn/ })).toHaveCount(0);
    });

    test("sửa và xoá đơn chưa hoàn thành, có hộp xác nhận", async ({ page }) => {
      await openInsurance(page);
      const code = await createOrder(page);
      const row = rowsOf(page).filter({ hasText: code });

      await row.getByRole("button", { name: /^Sửa đơn/ }).click();
      const editor = page.getByRole("dialog");
      await expect(editor).toBeVisible();
      await editor.getByLabel("Mức phí (đ)").fill("123000");
      await editor.getByRole("button", { name: "Lưu" }).click();
      await expect(toast(page, /Đã lưu thay đổi đơn/)).toBeVisible();

      await row.getByRole("button", { name: /^Xoá đơn/ }).click();
      // Việc khó lùi thì phải hỏi lại — không xoá thẳng khi bấm icon.
      const confirm = page.getByRole("dialog");
      await expect(confirm.getByText("Xoá hẳn đơn bảo hiểm này?")).toBeVisible();
      await confirm.getByRole("button", { name: "Xoá đơn", exact: true }).click();
      await expect(toast(page, /Đã xoá đơn/)).toBeVisible();
      await expect(row).toHaveCount(0);
    });

    test("lọc theo trạng thái ở P-13 chính là hàng đợi P-15", async ({ page }) => {
      await openInsurance(page);
      await createOrder(page);

      await page.getByRole("button", { name: /Bộ lọc/ }).click();
      await page.getByLabel("Trạng thái").selectOption({ label: "Chờ làm tay" });
      await page.keyboard.press("Escape");

      await expect(page.getByText("Trạng thái: Chờ làm tay")).toBeVisible();

      /**
       * Kiểm trên CẢ BẢNG, không chụp danh sách dòng rồi duyệt.
       *
       * `keepPreviousData` cố ý giữ dòng của trang cũ trong lúc câu mới đang
       * chạy (bảng không nháy trắng mỗi lần đổi bộ lọc), nên `.all()` chụp
       * trúng tập cũ rồi khẳng định về tập mới. `expect().not` thì tự thử lại
       * tới khi bảng thật sự lắng.
       */
      const body = page.locator("table tbody");
      await expect(body).toContainText("Chờ làm tay");
      for (const other of ["Chờ tạo", "Đang tạo", "Chờ duyệt", "Đang làm tay", "Hoàn thành"]) {
        await expect(body).not.toContainText(other);
      }
    });
  });
}
