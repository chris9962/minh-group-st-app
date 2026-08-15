// Bảo đảm có phiên đăng nhập dùng được trước khi tạo đơn.
// Đọc payload JSON từ stdin: { "orderId": "...", "taiKhoan": "...", "matKhau": "..." }
//
// Đã đăng nhập  → thoát 0 ngay, không mở form đăng nhập.
// Chưa đăng nhập → điền tài khoản, lưu ảnh captcha, chờ người vận hành gõ giá trị, bấm Đăng nhập.
//
// Captcha phải do người gõ. Chạy không có bàn phím thì script thoát mã 2 để BE báo người vận hành.
//
// Mã thoát: 0 có phiên dùng được · 1 payload sai · 2 cần người vận hành · 3 đăng nhập không thành

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright');
const { URL_GOC, URL_FORM, SELECTOR_FORM, STATE_PATH, HEADED } = require('./config');

const ANH_CAPTCHA_DIR = process.env.PVI_CAPTCHA_DIR || path.join(__dirname, 'captcha');

const SEL = {
  taiKhoan: '#login-username',
  matKhau: '#password',
  captchaKhoi: '#captcha img',
  captchaO: '#cpatchaTextBox',
  nutDangNhap: 'button[type=submit]',
};

const thoat = (ma, thongDiep, them = {}) => {
  console.log(JSON.stringify({ ok: ma === 0, thongDiep, ...them }, null, 1));
  process.exit(ma);
};

const doiStdin = () =>
  new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
  });

(async () => {
  let payload = {};

  if (process.env.PVI_USER && process.env.PVI_PASS) {
    payload = {
      orderId: process.env.PVI_ORDER_ID || 'thu-cong',
      taiKhoan: process.env.PVI_USER,
      matKhau: process.env.PVI_PASS,
    };
  } else {
    try {
      payload = JSON.parse(await doiStdin());
    } catch (e) {
      thoat(1, `Payload không phải JSON hợp lệ hoặc thiếu thông tin tài khoản: ${e.message}`);
    }
  }

  const orderId = String(payload.orderId || 'khong-co-id').replace(/[^\w.-]/g, '_');

  // Bước 1 — còn phiên thì dừng ở đây, không mở form đăng nhập.
  if (fs.existsSync(STATE_PATH)) {
    const browser = await chromium.launch({ headless: !HEADED });
    const ctx = await browser.newContext({ storageState: STATE_PATH });
    const page = await ctx.newPage();
    let conPhien = false;
    try {
      await page.goto(URL_FORM, { waitUntil: 'domcontentloaded', timeout: 60000 });
      conPhien = (await page.locator(SELECTOR_FORM).count()) > 0;
    } catch {
      conPhien = false;
    }
    await browser.close().catch(() => {});
    if (conPhien) thoat(0, 'Đã đăng nhập, dùng lại phiên cũ', { orderId, daDangNhap: true });
  }

  const browser = await chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ deviceScaleFactor: 3 });
  const page = await ctx.newPage();

  try {
    await page.goto(URL_GOC, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.fill(SEL.taiKhoan, payload.taiKhoan);
    await page.fill(SEL.matKhau, payload.matKhau);

    fs.mkdirSync(ANH_CAPTCHA_DIR, { recursive: true });
    const anh = path.join(ANH_CAPTCHA_DIR, `${orderId}.png`);
    await page.locator(SEL.captchaKhoi).screenshot({ path: anh });
    console.error(`Đã lưu ảnh captcha: ${anh}`);

    let giaTri = '';
    try {
      const resolverPath = path.join(__dirname, 'capcha-resolver', 'solve.py');
      giaTri = execSync(`python3 "${resolverPath}" "${anh}"`, { encoding: 'utf8' }).trim();
      console.error(`Giải captcha tự động thành công: "${giaTri}"`);
    } catch (err) {
      console.error(`Không thể giải captcha tự động bằng python: ${err.message}`);
    }

    if (!giaTri) {
      await browser.close();
      thoat(3, 'Không giải được captcha tự động bằng python', { orderId, anh });
    }

    await page.fill(SEL.captchaO, giaTri);
    await page.click(SEL.nutDangNhap);
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 });

    await page.goto(URL_FORM, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const vaoDuoc = (await page.locator(SELECTOR_FORM).count()) > 0;
    if (!vaoDuoc) {
      await browser.close();
      thoat(3, 'Đăng nhập không thành. Sai tài khoản, sai mật khẩu, hoặc sai captcha.', { orderId, anh });
    }

    await ctx.storageState({ path: STATE_PATH });
    fs.chmodSync(STATE_PATH, 0o600);
    fs.unlinkSync(anh);
    await browser.close();

    thoat(0, 'Đăng nhập xong, đã lưu phiên mới', { orderId, daDangNhap: false, state: STATE_PATH });
  } catch (e) {
    await browser.close().catch(() => {});
    thoat(3, `Lỗi khi đăng nhập: ${e.message}`, { orderId });
  }
})();
