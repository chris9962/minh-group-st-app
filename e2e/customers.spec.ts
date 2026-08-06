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

/** Ai xuất được "Dữ liệu tổng" — `customer:export` chỉ CEO có (qua `*`). */
/**
 * Ai xuất được danh sách khách (`customer:export`) — Phó GĐ, Trưởng phòng, Phó
 * phòng được thêm ngày 06/08.
 *
 * Phạm vi ghi là `company` và đó là mô tả THẬT chứ không phải nới tay: hồ sơ
 * khách không áp trục phạm vi (spec §2.1b) nên file xuất luôn gồm mọi khách
 * khớp bộ lọc. Bản xuất KHÔNG chứa CCCD — trường đó đi đường riêng, gác bằng
 * `customer:access-id-number`.
 */
const EXPORTS: Record<Role, boolean> = {
  director: true,
  "deputy-director": true,
  head: true,
  "deputy-head": true,
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
  return (await rows(page).locator("td:first-child").allInnerTexts()).map((s) => s.trim());
}

/** Cột SĐT — dùng để phân biệt các hồ sơ TRÙNG TÊN của bộ độn phân trang. */
async function phones(page: Page): Promise<string[]> {
  return (await rows(page).locator("td:nth-child(2)").allInnerTexts()).map((s) => s.trim());
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

    test(`${LABEL[role]}: báo cáo "Dữ liệu tổng" ${EXPORTS[role] ? "bấm được" : "bị khoá"}`, async ({ page }) => {
      await login(page, role);
      await page.goto("/exports");
      if (!(await screenLoaded(page))) {
        // Không có quyền xuất gì cả thì màn tự chặn — cũng coi như không bấm được.
        expect(EXPORTS[role]).toBe(false);
        return;
      }

      // Màn Xuất cố ý LIỆT KÊ ĐỦ báo cáo rồi khoá cái không có quyền, chứ không
      // ẩn đi — người dùng biết là có báo cáo đó và đi xin quyền, thay vì tưởng
      // hệ thống không làm được. Nên kiểm trạng thái khoá, đừng kiểm biến mất.
      const nut = page.getByRole("button", { name: /Dữ liệu tổng/ });
      if (EXPORTS[role]) await expect(nut).toBeEnabled();
      else await expect(nut).toBeDisabled();
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
    const sdt1 = await phones(page);

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
    const sdt2 = await phones(page);
    expect(sdt1.filter((s) => sdt2.includes(s))).toEqual([]);
    expect(new Set([...sdt1, ...sdt2]).size).toBe(PG_COUNT);
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
    await box.getByLabel("Địa chỉ").fill(`ZZE2E địa chỉ ${Date.now()}`);
    await box.getByRole("button", { name: /^Lưu$/ }).click();

    await expect(toast(page)).toContainText(/Đã lưu hồ sơ/);
  });

  test("trùng CCCD KHÔNG báo bằng toast mà mở hồ sơ đã có", async ({ page }) => {
    await page.getByRole("button", { name: /Thêm khách hàng/ }).click();
    const box = dialog(page);
    await box.getByLabel("Họ tên").fill(`${TAG} Trùng CCCD`);
    await box.getByLabel("CCCD").fill("092301004871");
    await phoneInput(box, 1).fill("0912000222");
    await box.getByRole("button", { name: /Tạo khách hàng/ }).click();

    // Toast trôi mất sau vài giây và không bấm được — mà thứ người dùng cần ở
    // đây là một nút "Dùng hồ sơ này", nên phải là khối trong hộp thoại.
    await expect(box).toContainText(/đã có hồ sơ/i);
    await expect(box.getByRole("button", { name: /Dùng hồ sơ này/ })).toBeVisible();
    await expect(toast(page)).toHaveCount(0);
  });
});

/* ── Chưa triển khai — TODO, không phải ca hỏng ───────────────────────── */

test.describe("TODO — chờ module khác", () => {
  /**
   * TODO(P-43 Tặng quà, chờ `src/rules/YYYY-MM.ts`): rổ quà do file luật của kỳ
   * sinh ra, chưa có luật thì rổ luôn rỗng và route `/api/customers/[id]/gift-given`
   * cũng chưa tồn tại. Bật ca này khi có file luật.
   */
  test.fixme("tặng quà: chọn một món rồi xác nhận → toast + trạng thái đổi", async ({ page }) => {
    await openCustomerList(page, "staff");
    await search(page, "bich tram");
    await rows(page).first().getByRole("button", { name: /Tặng quà/ }).click();
    await expect(dialog(page)).toContainText(/Chọn/);
  });

  /**
   * TODO(P-21 Ngân hàng, chờ module ngân hàng): `/api/bank-accounts` chưa có
   * route nào, nên hộp thoại mở được nhưng bấm lưu là 404. Bật khi module lên.
   */
  test.fixme("mở tài khoản ngân hàng từ dòng khách → toast + số tài khoản +1", async ({ page }) => {
    await openCustomerList(page, "staff");
    await search(page, "minh dung");
    await rows(page).first().getByRole("button", { name: /Mở ngân hàng/ }).click();
  });

  /**
   * TODO(P-31 Dịch vụ, chờ module dịch vụ): `/api/services` chưa có route.
   */
  test.fixme("ghi dịch vụ từ dòng khách → toast xác nhận", async ({ page }) => {
    await openCustomerList(page, "staff");
    await search(page, "minh dung");
    await rows(page).first().getByRole("button", { name: /Ghi dịch vụ/ }).click();
  });

  /**
   * TODO(P-42 Hồ sơ 360°, chờ `src/rules/YYYY-MM.ts`): khối "Quà" luôn hiện rổ
   * rỗng và tiền mặt 0 vì chưa có luật của kỳ. Bảng tài khoản/đơn BH thì đã đọc
   * dữ liệu thật, ca dưới soi phần đó — chỉ khối Quà là chờ.
   */
  test.fixme("hồ sơ 360°: khối Quà hiện rổ quà đã tính", async ({ page }) => {
    await openCustomerList(page, "director");
    await search(page, "bich tram");
    await rows(page).first().getByRole("link").first().click();
    await expect(page.locator("main")).toContainText(/Rổ quà/);
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
