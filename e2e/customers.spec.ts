import { expect, test, type Page } from "@playwright/test";
import { LABEL, ROLES, TAG, login, navLabels, screenLoaded, type Role } from "./roles";

/**
 * P-40 · P-41 · P-42 — màn Khách hàng.
 *
 * Dữ liệu là 6 hồ sơ `ZZE2E` do `scripts/e2e-seed.ts` dựng, với số tài khoản và
 * số đơn bảo hiểm CỐ Ý NGƯỢC NHAU:
 *
 *   A tk=5 bh=0 · B tk=3 bh=1 · C tk=0 bh=4 · D tk=1 bh=3 · E tk=3 bh=2 · F tk=0 bh=5
 *
 * Ngược nhau mới bắt được lỗi sắp nhầm cột: nếu ai cũng cùng số thì hai kiểu sắp
 * cho ra cùng một thứ tự và ca test xanh kể cả khi máy chủ sắp sai. C và E còn
 * mang tài khoản `creating` (lượt giữ chỗ mã, spec §4.5) để bắt được nếu ai đó
 * bỏ điều kiện `status = 'done'`.
 */

const toast = (page: Page) => page.getByRole("status");
const dialog = (page: Page) => page.locator("dialog[open]");
const rows = (page: Page) => page.locator("table tbody tr");

/** Ai được TẠO hồ sơ khách — `customer:create` có ở cả 5 vai (`lib/roles.ts`). */
const CREATES: Record<Role, boolean> = {
  director: true,
  "deputy-director": true,
  head: true,
  "deputy-head": true,
  staff: true,
};

/**
 * Ai được SỬA hồ sơ khách — từ 06/08 là cả 5 vai.
 *
 * CEO có `customer:update` kể từ khi vai đó chuyển sang TOÀN QUYỀN
 * (`lib/roles.ts`). Trước đó CEO là vai DUY NHẤT không sửa được hồ sơ khách,
 * trong khi lại là vai duy nhất thấy CCCD đầy đủ — tức người duy nhất phát hiện
 * được số nhập sai cũng là người duy nhất không sửa được.
 */
const EDITS: Record<Role, boolean> = {
  director: true,
  "deputy-director": true,
  head: true,
  "deputy-head": true,
  staff: true,
};

/** Ai thấy CCCD ĐẦY ĐỦ — `access-id-number` chỉ nằm trong bộ quyền CEO. */
const SEES_ID_NUMBER: Record<Role, boolean> = {
  director: true,
  "deputy-director": false,
  head: false,
  "deputy-head": false,
  staff: false,
};

/**
 * Tên hiện trên bảng, theo đúng thứ tự bảng đang xếp.
 *
 * `td:first-child` chứ KHÔNG phải `.locator("td").first()`: cái sau lấy ô đầu
 * tiên của CẢ BẢNG, tức đúng một giá trị, nên mọi phép so nhiều dòng đều lặng lẽ
 * so với một phần tử và luôn xanh sai.
 */
async function names(page: Page): Promise<string[]> {
  // Cột 2, không phải cột 1: bảng mở đầu bằng cột Ngày tạo.
  return (await rows(page).locator("td:nth-child(2)").allInnerTexts()).map((s) => s.trim());
}

/**
 * Id của từng dòng, đọc từ link tên khách — dùng để phân biệt các hồ sơ TRÙNG
 * TÊN của bộ độn phân trang.
 *
 * Trước đây ca này soi cột SĐT, nhưng cột đó đã bỏ khỏi bảng (commit 9706473).
 * Link tên là thứ duy nhất còn lại mang giá trị riêng cho từng dòng.
 */
async function rowIds(page: Page): Promise<string[]> {
  return Promise.all(
    (await rows(page).all()).map(
      async (r) => (await r.getByRole("link").first().getAttribute("href")) ?? "",
    ),
  );
}

/** Sáu hồ sơ mẫu của `e2e-seed.ts` — tiền tố riêng để không lẫn dữ liệu ca khác tạo. */
const KH = "ZZE2E-KH";

/** 22 hồ sơ độn cho ca phân trang — vượt `PAGE_SIZE` = 15 nên có thật hai trang. */
const PG = "ZZE2E-PG";
const PG_COUNT = 22;
const PAGE_SIZE = 15;

/**
 * Làm một thao tác rồi đợi ĐÚNG lượt gọi máy chủ mà nó sinh ra.
 *
 * `waitForLoadState("networkidle")` KHÔNG dùng được ở đây, và đây là cái bẫy đã
 * làm cả chục ca đỏ oan: ô tìm hoãn 300ms trước khi gọi, còn bấm sắp xếp thì
 * gọi ngay nhưng bảng giữ dữ liệu cũ trong lúc chờ (`keepPreviousData`). Cả hai
 * ca, ngay sau thao tác mạng đang RẢNH — `networkidle` trả về tức thì, ca test
 * đọc bảng cũ rồi kết luận ứng dụng sắp/tìm sai.
 *
 * Bám vào tham số trên URL vì đó cũng là bằng chứng việc này chạy ở MÁY CHỦ: có
 * `sort=accounts` trên đường truyền nghĩa là trình duyệt không tự sắp lấy.
 */
async function afterQuery(page: Page, khop: (p: URLSearchParams) => boolean, thaoTac: () => Promise<unknown>) {
  const answered = page.waitForResponse(
    (r) => r.url().includes("/api/customers?") && khop(new URL(r.url()).searchParams),
  );
  await thaoTac();
  await answered;
  await page.waitForLoadState("networkidle");
}

/**
 * `getByRole("searchbox")` chứ không phải `getByLabel`: ô có chữ rồi thì nút xoá
 * hiện ra mang nhãn "Xoá tìm khách hàng", và nhãn đó cũng chứa "Tìm khách hàng"
 * nên `getByLabel` khớp HAI phần tử. Lần gọi đầu không lộ (ô đang rỗng, chưa có
 * nút xoá) — chỉ ca nào tìm hai lần liên tiếp mới đỏ.
 */
const search = (page: Page, text: string) =>
  afterQuery(page, (p) => p.get("search") === text, () =>
    page.getByRole("searchbox", { name: "Tìm khách hàng" }).fill(text),
  );

/** Bấm tiêu đề cột để sắp. Lần bấm đầu ra `desc`, bấm lại cùng cột ra `asc`. */
const sortBy = (page: Page, nhan: RegExp, khoa: string, chieu: "asc" | "desc") =>
  afterQuery(page, (p) => p.get("sort") === khoa && p.get("dir") === chieu, () =>
    page.getByRole("button", { name: nhan }).click(),
  );

/**
 * Điền ba ô BẮT BUỘC của biểu mẫu khách hàng: ngày sinh · CCCD · địa chỉ.
 *
 * Ba ô này thành bắt buộc ở commit 9706473 (2026-08-15). Gom vào một chỗ vì ba
 * ca cùng cần — điền lẻ ở từng ca thì lần siết tiếp theo phải sửa ba nơi.
 */
async function fillRequired(scope: ReturnType<typeof dialog>, idNumber: string) {
  // TÁM CHỮ SỐ `ddmmyyyy`, không phải `yyyy-mm-dd`. Ô ngày sinh là `DateField`
  // từ commit 3cf6da2 (2026-08-21): nó chỉ giữ chữ số rồi tự chèn dấu gạch, nên
  // `"1990-01-01"` vào thành `19/90/0101` — tháng 90 không có thật, ô ra rỗng và
  // biểu mẫu dừng ở "Chưa nhập ngày sinh".
  await scope.getByLabel("Ngày sinh").fill("01011990");
  await scope.getByLabel("CCCD").fill(idNumber);
  await scope.getByLabel("Địa chỉ").fill(`${TAG} dia chi`);
}

/** Ô nhập SĐT thứ `i` — phải chỉ rõ là ô nhập, nút "Xoá số điện thoại i" trùng nhãn. */
const phoneInput = (scope: ReturnType<typeof dialog>, i: number) =>
  scope.getByRole("textbox", { name: new RegExp(`Số điện thoại ${i}`) });

async function openCustomerList(page: Page, role: Role) {
  await login(page, role);
  await page.goto("/customers");
  expect(await screenLoaded(page), `${LABEL[role]} phải mở được màn khách hàng`).toBe(true);
}

/* ── Ai vào được, ai bấm được gì ──────────────────────────────────────── */

test.describe("mọi chức vụ đều dùng được màn khách hàng", () => {
  for (const role of ROLES) {
    test(`${LABEL[role]}: thấy mục điều hướng và mở được bảng`, async ({ page }) => {
      await openCustomerList(page, role);

      // Hồ sơ khách KHÔNG áp trục phạm vi (spec §2.1b) — kể cả nhân viên kinh
      // doanh, vốn chỉ có `own` ở mọi module khác, vẫn phải thấy cả kho. Thiếu
      // vế này thì chặn trùng CCCD và ô tìm kiếm đều vô dụng.
      expect(await navLabels(page)).toContain("Khách hàng");
      await expect(rows(page).first()).toBeVisible();
      expect((await names(page)).filter((n) => n.startsWith(TAG)).length).toBeGreaterThan(0);
    });

    test(`${LABEL[role]}: nút "Thêm khách hàng" ${CREATES[role] ? "hiện" : "ẩn"}`, async ({ page }) => {
      await openCustomerList(page, role);
      await expect(page.getByRole("button", { name: /Thêm khách hàng/ })).toHaveCount(
        CREATES[role] ? 1 : 0,
      );
    });

    test(`${LABEL[role]}: nút "Sửa thông tin" ở hồ sơ ${EDITS[role] ? "hiện" : "ẩn"}`, async ({ page }) => {
      await openCustomerList(page, role);
      await search(page, "bich tram");
      await rows(page).first().getByRole("link").first().click();
      expect(await screenLoaded(page)).toBe(true);

      // Ẩn nút KHÔNG phải là phân quyền (AGENTS.md §6) — máy chủ vẫn chặn. Ca
      // này chỉ soi hai đầu có khớp nhau không: nút hiện mà máy chủ từ chối thì
      // người dùng bấm xong nhận một câu lỗi không giải thích được vì sao.
      await expect(page.getByRole("button", { name: "Sửa thông tin" })).toHaveCount(
        EDITS[role] ? 1 : 0,
      );
    });

    test(`${LABEL[role]}: CCCD ${SEES_ID_NUMBER[role] ? "đầy đủ" : "chỉ 4 số cuối"}`, async ({ page }) => {
      await openCustomerList(page, role);
      await search(page, "bich tram");
      await rows(page).first().getByRole("link").first().click();
      expect(await screenLoaded(page)).toBe(true);

      const info = page.locator("main");
      if (SEES_ID_NUMBER[role]) {
        // `formatIdNumber` chia nhóm 4-4-4.
        await expect(info).toContainText("0923 0100 4871");
      } else {
        // Che thì phải thấy 4 số cuối, và TUYỆT ĐỐI không thấy số đầy đủ ở bất
        // kỳ đâu trên trang — kể cả trong thuộc tính ẩn.
        await expect(info).toContainText("4871");
        expect(await page.content()).not.toContain("092301004871");
      }
    });
  }
});

/* ── Tìm · lọc · sắp · cắt trang đều ở MÁY CHỦ ────────────────────────── */

test.describe("tìm kiếm chạy ở máy chủ", () => {
  test.beforeEach(async ({ page }) => {
    await openCustomerList(page, "director");
  });

  test("tìm không dấu, đảo thứ tự từ vẫn ra", async ({ page }) => {
    // `tram bich` phải ra `Nguyễn Thị Bích Trâm` — cùng luật với `matchesSearch`
    // ở giao diện, chỉ là chạy trong SQL trên cột `search_name`.
    await search(page, "tram bich");
    expect(await names(page)).toEqual([`${KH} A Nguyễn Thị Bích Trâm`]);
  });

  test("chữ Đ bỏ dấu đúng — `dang van` ra `Đặng Văn`", async ({ page }) => {
    // `normalize('NFD')` KHÔNG tách chữ Đ; hàm `mgst_normalize` phải thay tay.
    // Sai chỗ này thì gõ `dang` không bao giờ ra `Đặng`.
    await search(page, "dang van");
    expect(await names(page)).toEqual([`${KH} B Đặng Văn Bốn`]);
  });

  test("tìm được qua số điện thoại KHÔNG phải số chính", async ({ page }) => {
    await search(page, "0987654321");
    expect(await names(page)).toEqual([`${KH} A Nguyễn Thị Bích Trâm`]);
  });

  test("tìm được bằng 4 số cuối CCCD, không cần quyền xem CCCD", async ({ page }) => {
    await login(page, "staff");
    await page.goto("/customers");
    await screenLoaded(page);
    // Nhân viên đọc 4 số cuối từ giấy tờ khách đang cầm để tra hồ sơ — khớp một
    // hậu tố không làm lộ số đầy đủ, nên không đòi `access-id-number`.
    await search(page, "4871");
    expect(await names(page)).toEqual([`${KH} A Nguyễn Thị Bích Trâm`]);
  });

  test("gõ ký tự đại diện `%` ra RỖNG, không ra cả kho", async ({ page }) => {
    // Không thoát `%` thì nó thành "khớp mọi thứ" — người dùng gõ nhầm một ký tự
    // và nhận về toàn bộ khách hàng của công ty.
    await search(page, "%");
    await expect(page.locator("main")).toContainText(/Không tìm thấy khách nào/);
  });

  test("bảng chỉ nhận đúng một trang, không tải cả kho về rồi cắt", async ({ page }) => {
    // Ca này CHỈ có nghĩa khi tập kết quả lớn hơn một trang. Trước đây nó chỉ
    // kiểm `<= 15` trên một kho 6 dòng — luôn xanh, kể cả khi màn tải trọn kho
    // về rồi cắt ở trình duyệt.
    await search(page, PG);
    expect(await rows(page).count()).toBe(PAGE_SIZE);
    // Tổng ở tiêu đề là số của CẢ bộ lọc, không phải số dòng đang hiện.
    await expect(page.locator("main")).toContainText(`khớp ${PG_COUNT}`);
    await expect(page.locator("main")).toContainText(`1–15 trên ${PG_COUNT}`);
  });

  test("sang trang 2 ra bộ khác, không trùng không sót", async ({ page }) => {
    await search(page, PG);
    const trang1 = await names(page);
    const id1 = await rowIds(page);

    await afterQuery(page, (p) => p.get("page") === "1", () =>
      page.getByRole("button", { name: "Sau" }).click(),
    );
    const trang2 = await names(page);

    expect(trang2.length).toBe(PG_COUNT - PAGE_SIZE);
    // 22 hồ sơ này TRÙNG TÊN NHAU nên so tên không phân biệt được — phải so SĐT
    // ở cột 2, thứ duy nhất khác nhau giữa chúng.
    expect(new Set(trang1).size).toBe(1);
    expect(new Set(trang2).size).toBe(1);

    // Hai trang phải RỜI NHAU hoàn toàn và ghép lại đủ 22. Thiếu khoá phụ duy
    // nhất trong `ORDER BY` thì thứ tự giữa các hồ sơ trùng tên bám theo vị trí
    // vật lý của dòng — ai đó sửa một hồ sơ là nó nhảy xuống cuối bảng, hồ sơ
    // thứ 15 hiện lại ở trang 2 còn một người khác rơi khỏi cả hai trang.
    const id2 = await rowIds(page);
    expect(id1.filter((x) => id2.includes(x))).toEqual([]);
    expect(new Set([...id1, ...id2]).size).toBe(PG_COUNT);
  });
});

test.describe("lọc chạy ở máy chủ", () => {
  test.beforeEach(async ({ page }) => {
    await openCustomerList(page, "director");
  });

  test("lọc theo kênh thu hẹp danh sách và hiện chip gỡ được", async ({ page }) => {
    await search(page, KH);
    const before = (await names(page)).length;

    // Chỉ hồ sơ A có kênh. Đọc tên kênh từ chính bảng chứ không chọn theo vị
    // trí trong ô: ô chọn xếp theo tên, thêm một kênh mới là vị trí đổi hết.
    const kenhCuaA = (await rows(page).filter({ hasText: "Bích Trâm" }).locator("td:nth-child(5)").innerText()).trim();
    expect(kenhCuaA).not.toBe("—");

    await page.getByRole("button", { name: /Bộ lọc|Lọc/ }).click();
    await afterQuery(page, (p) => Boolean(p.get("channelId")), () =>
      page.getByLabel("Kênh").selectOption({ label: kenhCuaA }),
    );
    await page.keyboard.press("Escape");

    const after = await names(page);
    expect(after.length).toBeLessThan(before);
    expect(after.some((n) => n.includes("Bích Trâm"))).toBe(true);
    await expect(page.locator("main")).toContainText(`Kênh: ${kenhCuaA}`);
  });

  test("đang ở trang 2 mà đổi bộ lọc thì về trang đầu, không để lại khúc rỗng", async ({ page }) => {
    // Ca cũ chỉ tìm rồi kiểm "có dòng" — không bao giờ sang trang 2, nên xoá
    // sạch `page: 0` trong `refine` nó vẫn xanh.
    await search(page, PG);
    await afterQuery(page, (p) => p.get("page") === "1", () =>
      page.getByRole("button", { name: "Sau" }).click(),
    );

    // Đổi từ khoá sang tập chỉ có 6 dòng. Giữ nguyên trang 2 thì bảng trống
    // trơn, người dùng đọc ra là "lọc xong mất sạch dữ liệu".
    await search(page, KH);
    expect((await names(page)).length).toBe(6);
    await expect(page.getByRole("button", { name: "Sau" })).toHaveCount(0);
  });
});

test.describe("sắp xếp theo số đếm — chạy ở máy chủ, trên TOÀN BỘ kết quả", () => {
  test.beforeEach(async ({ page }) => {
    await openCustomerList(page, "director");
    await search(page, KH);
  });

  /** Cột số của một dòng, đọc theo vị trí cột trong bảng. */
  const numbers = async (page: Page, col: number) =>
    (await rows(page).locator(`td:nth-child(${col})`).allInnerTexts()).map((s) => Number(s.trim()));

  test("Số tài khoản: giảm dần, đồng hạng thì theo tên", async ({ page }) => {
    await sortBy(page, /^Số tài khoản/, "accounts", "desc");

    expect(await names(page)).toEqual([
      `${KH} A Nguyễn Thị Bích Trâm`,
      `${KH} B Đặng Văn Bốn`,
      `${KH} E Huỳnh Thị Em`,
      `${KH} D Phạm Minh Dung`,
      `${KH} C Lê Hoàng Cường`,
      `${KH} F Vũ Văn Phong`,
    ]);
    expect(await numbers(page, 3)).toEqual([5, 3, 3, 1, 0, 0]);
  });

  test("Số tài khoản: bấm lần hai thì tăng dần", async ({ page }) => {
    await sortBy(page, /^Số tài khoản/, "accounts", "desc");
    await sortBy(page, /^Số tài khoản/, "accounts", "asc");

    expect(await numbers(page, 3)).toEqual([0, 0, 1, 3, 3, 5]);
  });

  test("Số đơn BH: thứ tự phải KHÁC hẳn cột Số tài khoản", async ({ page }) => {
    await sortBy(page, /^Số đơn BH/, "insurance", "desc");

    expect(await names(page)).toEqual([
      `${KH} F Vũ Văn Phong`,
      `${KH} C Lê Hoàng Cường`,
      `${KH} D Phạm Minh Dung`,
      `${KH} E Huỳnh Thị Em`,
      `${KH} B Đặng Văn Bốn`,
      `${KH} A Nguyễn Thị Bích Trâm`,
    ]);
    expect(await numbers(page, 4)).toEqual([5, 4, 3, 2, 1, 0]);
  });

  test("tài khoản đang tạo dở KHÔNG được tính vào cột Số tài khoản", async ({ page }) => {
    // C có 4 bản nháp `creating` mà vẫn phải là 0; E có 1 bản nháp mà vẫn là 3.
    // Bản nháp là lượt GIỮ CHỖ mã (spec §4.5), chưa phải tài khoản của khách.
    await sortBy(page, /^Số tài khoản/, "accounts", "desc");

    const all = await names(page);
    const counts = await numbers(page, 3);
    expect(counts[all.indexOf(`${KH} C Lê Hoàng Cường`)]).toBe(0);
    expect(counts[all.indexOf(`${KH} E Huỳnh Thị Em`)]).toBe(3);
  });
});

/* ── Toast: mọi thao tác phải nói kết quả ─────────────────────────────── */

test.describe("thao tác nào cũng báo kết quả", () => {
  test.beforeEach(async ({ page }) => {
    await openCustomerList(page, "staff");
  });

  test("thêm khách hàng → toast xác nhận kèm tên", async ({ page }) => {
    const ten = `${TAG} ho so moi ${Date.now()}`;
    await page.getByRole("button", { name: /Thêm khách hàng/ }).click();

    const box = dialog(page);
    await box.getByLabel("Họ tên").fill(ten);
    await phoneInput(box, 1).fill("0912000111");
    // Ngày sinh · CCCD · Địa chỉ thành BẮT BUỘC từ commit 9706473 — thiếu một ô
    // là form chặn tại chỗ và hộp thoại đứng im.
    await fillRequired(box, `0923${Date.now().toString().slice(-8)}`);
    await box.getByRole("button", { name: /Tạo khách hàng/ }).click();

    // Trước đây quy ước là "im lặng = thành công". Quy ước đó gãy ở form không
    // đóng sau khi lưu, nên giờ mọi thao tác đều phải nói ra (`lib/toast.ts`).
    await expect(toast(page)).toContainText(/Đã thêm khách hàng/);
    await expect(box).toBeHidden();
  });

  test("sửa hồ sơ → toast xác nhận", async ({ page }) => {
    await search(page, "minh dung");
    await rows(page).first().getByRole("link").first().click();
    await screenLoaded(page);

    await page.getByRole("button", { name: "Sửa thông tin" }).click();
    const box = dialog(page);
    /**
     * Điền lại NGÀY SINH dù ca này chỉ định đổi địa chỉ.
     *
     * Ô ngày sinh thành bắt buộc từ U8 (2026-08-21), và hồ sơ lập trước ngày đó
     * có thể chưa có. Gặp hồ sơ như vậy thì biểu mẫu dừng ở "Chưa nhập ngày
     * sinh" và toast không bao giờ hiện. Người dùng thật cũng phải điền bù đúng
     * như đây — chốt 2026-08-22.
     */
    await box.getByLabel("Ngày sinh").fill("01011990");
    await box.getByLabel("Địa chỉ").fill(`ZZE2E địa chỉ ${Date.now()}`);
    await box.getByRole("button", { name: /^Lưu$/ }).click();

    await expect(toast(page)).toContainText(/Đã lưu hồ sơ/);
  });

  /**
   * Chốt 2026-08-18: trùng CCCD báo bằng TOAST, không mở hồ sơ đã có.
   *
   * Bản trước của ca này kỳ vọng một khối trong hộp thoại kèm nút "Dùng hồ sơ
   * này" theo spec §2.1. Đội bỏ hướng đó: một lượt ghi hỏng không được kéo theo
   * một lượt đọc hồ sơ người khác, nên máy chủ chỉ trả mã lỗi với câu báo.
   */
  test("trùng CCCD báo lỗi, không trả hồ sơ đang giữ số đó", async ({ page }) => {
    const res = page.waitForResponse(
      (r) => r.url().includes("/api/customers") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Thêm khách hàng/ }).click();
    const box = dialog(page);
    await box.getByLabel("Họ tên").fill(`${TAG} Trùng CCCD`);
    await phoneInput(box, 1).fill("0912000222");
    await fillRequired(box, "092301004871");
    await box.getByRole("button", { name: /Tạo khách hàng/ }).click();

    await expect(toast(page)).toContainText(/CCCD này đã có hồ sơ/i);

    // Payload chỉ có mã lỗi và câu báo — không tên, không số điện thoại, không
    // số tài khoản của hồ sơ đang giữ CCCD đó.
    const body = (await (await res).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["code", "message"]);
  });
});

/* ── Quà — luật của kỳ chạy thật, không phải rổ rỗng ──────────────────── */

/**
 * Khách `A Nguyễn Thị Bích Trâm` của bộ seed mở `MB` + `VPa` + `MSBa` (đã cài
 * app) nên khớp **TH3** của thể lệ 2026-08: 03 bank ưu tiên → 01 năm bảo hiểm
 * cộng 70k tiền mặt (20k vào VPa, 50k vào MSBa).
 *
 * Con số 70.000 không phải số tròn cho đẹp — đổi bộ seed hay đổi file luật mà
 * quên chỗ này thì ca đỏ, đúng như mong muốn.
 */
test.describe("P-42 · P-43 · quà theo thể lệ của kỳ", () => {
  test("hồ sơ 360°: khối Quà hiện đúng trường hợp và số tiền", async ({ page }) => {
    await openCustomerList(page, "director");
    await search(page, "bich tram");
    await rows(page).first().getByRole("link").first().click();

    const main = page.locator("main");
    await expect(main).toContainText("Trường hợp TH3");
    await expect(main).toContainText("70.000đ");
    await expect(main).toContainText("1 năm");
    // Phần giải thích là yêu cầu của spec §5.3, không phải trang trí: khách hỏi
    // "sao tôi chỉ được 1 năm" thì nhân viên phải đọc được ngay tại màn.
    await expect(main).toContainText(/Tổ hợp 3 ngân hàng/);
  });

  /**
   * Nhãn tình trạng quà nằm ở TRANG CHI TIẾT P-42, không ở bảng P-40.
   *
   * Bảng có bảy cột và không cột nào là quà; nó chỉ khoá nút "Tặng quà" khi đã
   * tặng. Chốt 2026-08-22: giữ nguyên bảng, đổi phép kiểm sang đúng nơi nhãn ở.
   */
  test("P-42: khách đủ điều kiện hiện nhãn chờ phát", async ({ page }) => {
    await openCustomerList(page, "director");
    await search(page, "bich tram");
    await rows(page).first().getByRole("link").first().click();
    await screenLoaded(page);
    await expect(page.locator("main")).toContainText("Đủ ĐK · chưa phát");
  });

  /**
   * Đi đường TỪ CHỐI chứ không chọn gói bảo hiểm: chọn gói sẽ mở tiếp form tạo
   * đơn và ca này thành ca test của module bảo hiểm. Đường từ chối vẫn chạm đủ
   * route chốt quà, và quà chỉ tặng được đúng một lần nên ca sau không lặp lại
   * được — bộ dọn `e2e-clean.ts` xoá cả `gift_grants` theo khách.
   */
  test("tặng quà: từ chối cũng ghi nhận, và không tặng lần hai", async ({ page }) => {
    await openCustomerList(page, "staff");
    await search(page, "bich tram");
    await rows(page).first().getByRole("button", { name: /Tặng quà/ }).click();

    const box = dialog(page);
    await expect(box).toContainText("Tiền mặt tự động");
    await box.getByText("Từ chối, không lấy gì").click();
    await box.getByRole("button", { name: "Xác nhận" }).click();

    await expect(toast(page)).toContainText(/từ chối quà/i);
    // Bảng không có cột quà — dấu hiệu "đã tặng" ở đây là nút bị khoá lại.
    await expect(rows(page).first().getByRole("button", { name: /Tặng quà/ })).toBeDisabled();

    // Bấm lại: MÁY CHỦ chặn, không phải giao diện ẩn nút (AGENTS.md §6).
    const href = await rows(page).first().getByRole("link").first().getAttribute("href");
    const res = await page.request.post(`${href}`.replace("/customers/", "/api/customers/") + "/gift-given", {
      data: { item: "Từ chối nhận quà" },
    });
    expect(res.status()).toBe(422);
  });
});

/**
 * Hai nút nghiệp vụ bật thẳng từ dòng khách — trước đây tắt vì `/api/services`
 * và `/api/bank-accounts` chưa có route nào, mở hộp thoại được nhưng bấm lưu là
 * 404. Hai module đã lên nên bật lại, và lần này đi TRỌN đường tới toast.
 */
test.describe("nút nghiệp vụ trên dòng khách", () => {
  /**
   * Đăng nhập bằng TRƯỞNG PHÒNG chứ không phải Nhân viên, và đó là ràng buộc
   * chéo file chứ không phải sở thích.
   *
   * `staff.spec` chốt rằng `zz_e2e_staff` mở 12 tài khoản ngân hàng mà điểm vẫn
   * bằng 0 — bằng chứng công thức ngân hàng không bịa số. Ghi một lượt dịch vụ
   * dưới đúng tài khoản đó là cộng cho họ điểm dịch vụ, và ca kia đỏ ở một file
   * khác vì một dòng viết ở đây.
   */
  test("ghi dịch vụ từ dòng khách → toast xác nhận", async ({ page }) => {
    await openCustomerList(page, "head");
    await search(page, "minh dung");
    await rows(page).first().getByRole("button", { name: /Ghi dịch vụ/ }).click();

    const box = dialog(page);
    await expect(box).toBeVisible();
    // Ô chọn loại dịch vụ đọc từ danh mục — lấy lựa chọn đầu tiên có giá trị
    // thật, không đoán tên, vì danh mục là thứ CEO sửa được ở màn Cấu hình.
    const options = box.getByLabel("Loại dịch vụ").locator("option");
    const value = await options.nth(1).getAttribute("value");
    await box.getByLabel("Loại dịch vụ").selectOption(value!);
    await box.getByLabel("Ghi chú công việc").fill(`${TAG} ghi tu dong khach`);
    await box.getByRole("button", { name: "Lưu" }).click();

    await expect(toast(page).first()).toBeVisible();
    await expect(box).toBeHidden();
  });

  /**
   * Vào bằng GIÁM ĐỐC, không phải nhân viên. `e2e-seed.ts` cố ý dựng 7 tài
   * khoản `creating` dưới tên `zz_e2e_staff` cho ca khác, nên vào bằng nhân
   * viên là ca này đo lẫn dữ liệu của ca đó.
   */
  test("mở tài khoản ngân hàng từ dòng khách → giữ chỗ mã, sang bước 2", async ({ page }) => {
    await openCustomerList(page, "director");
    await search(page, "minh dung");
    await rows(page).first().getByRole("button", { name: /Mở ngân hàng/ }).click();

    const box = dialog(page);
    await expect(box).toBeVisible();

    /**
     * Thử từng ngân hàng cho tới khi gặp một cái CÒN MÃ.
     *
     * Không lấy đại ngân hàng đầu tiên: kho mã của mỗi ngân hàng là dữ liệu
     * thật, ngân hàng hết mã thì ô "Mã giới thiệu" hiện "— Hết mã —" và
     * bấm Tiếp tục không đi đâu cả. Ca test đỏ khi đó là đỏ vì kho mã, không
     * phải vì luồng hai bước hỏng.
     */
    const bankSelect = box.getByLabel("Ngân hàng");
    // Danh mục ngân hàng cũng về sau một lượt gọi máy chủ: đọc ngay lúc hộp
    // thoại vừa mở thì ô chọn mới có mỗi dòng "— Chọn ngân hàng —", và ca test
    // tự bỏ qua chính nó.
    await expect
      .poll(async () => bankSelect.locator("option").count(), { timeout: 10_000 })
      .toBeGreaterThan(1);

    const bankIds = (
      await bankSelect
        .locator("option")
        .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value))
    ).filter(Boolean);

    /**
     * Kho mã của ngân hàng vừa chọn về sau MỘT LƯỢT GỌI MÁY CHỦ. Đọc ngay lúc
     * vừa chọn thì ô mã còn đang ở trạng thái rỗng và luôn hiện "Hết mã" — ca
     * test bỏ qua chính nó, mãi mãi, kể cả khi kho mã đầy.
     */
    const openCodes = () =>
      box.getByLabel("Mã giới thiệu").locator("option").filter({ hasText: /còn \d+ chỗ/ });

    let picked = false;
    for (const id of bankIds) {
      await bankSelect.selectOption(id);
      // `waitFor` tự thử lại tới khi hết giờ; `.count()` chỉ chụp một khoảnh
      // khắc, mà khoảnh khắc đó thường rơi vào lúc danh sách chưa về.
      picked = await openCodes()
        .first()
        .waitFor({ state: "attached", timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (picked) break;
    }
    test.skip(!picked, "mọi ngân hàng đều hết mã còn chỗ");

    await box.getByRole("button", { name: "Tiếp tục" }).click();

    /**
     * Bấm "Tiếp tục" là GIỮ CHỖ MÃ và tạo bản ghi `Đang tạo` (spec §4.5), rồi
     * hộp thoại tự chuyển sang bước 2. Nút của bước 2 hiện ra là bằng chứng bản
     * ghi đã tạo thật — bước đó chỉ dựng được khi đã có tài khoản để hoàn tất.
     */
    await expect(box.getByRole("button", { name: "Hoàn thành" })).toBeVisible();
  });
});

/* ── Hồ sơ 360°: phần đã chạy thật ────────────────────────────────────── */

test.describe("hồ sơ 360° — phần đã nối dữ liệu thật", () => {
  test("CEO thấy đủ tài khoản và đơn bảo hiểm của khách", async ({ page }) => {
    await openCustomerList(page, "director");
    await search(page, "bich tram");
    await rows(page).first().getByRole("link").first().click();
    expect(await screenLoaded(page)).toBe(true);

    // Phạm vi `company` nên không giấu dòng nào; 5 tài khoản `done` phải hiện đủ.
    await expect(page.locator("main")).toContainText("5 tài khoản");
    // 2 bản nháp hiện riêng ở khối "đang tạo, chưa hoàn thành", không lẫn vào bảng.
    await expect(page.locator("main")).toContainText(/đang tạo, chưa hoàn thành/);
  });

  test("số dòng bị giấu ngoài phạm vi được NÓI RA, không giấu im", async ({ page }) => {
    // Không nói ra thì nhân viên tưởng khách chưa có tài khoản nào và đi mở
    // trùng. Phó phòng e2e không phụ trách phòng nào nên phạm vi `managed` của
    // họ rỗng — đúng tình huống cần câu thông báo này.
    await openCustomerList(page, "deputy-head");
    await search(page, "bich tram");
    await rows(page).first().getByRole("link").first().click();
    expect(await screenLoaded(page)).toBe(true);

    await expect(page.locator("main")).toContainText(/ngoài phạm vi xem của bạn/);
  });

  test("cột Số tài khoản ở bảng đếm TOÀN BỘ, không theo phạm vi người xem", async ({ page }) => {
    // Cố ý khác với khối chi tiết bên trong hồ sơ: người nhập cần biết khách này
    // đã có 5 tài khoản dù phòng khác mở, nếu không họ mở trùng. Chi tiết từng
    // dòng mới áp phạm vi (spec §2.1b).
    await openCustomerList(page, "deputy-head");
    await search(page, "bich tram");
    await expect(rows(page).first().locator("td:nth-child(3)")).toHaveText("5");
  });
});
