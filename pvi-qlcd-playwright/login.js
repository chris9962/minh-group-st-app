// Mở trình duyệt để bạn tự đăng nhập, rồi lưu phiên vào storageState.json.
// Form đăng nhập của PVI có captcha ảnh, nên bước này không tự động hóa được.

const { chromium } = require('playwright');
const { URL_GOC, URL_FORM, STATE_PATH } = require('./config');

const CHO_TOI_DA_MS = 10 * 60 * 1000;

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL_GOC);

  console.log('Bạn đăng nhập trong cửa sổ vừa mở. Script chờ tối đa 10 phút.');

  const hetHan = Date.now() + CHO_TOI_DA_MS;
  let vaoDuoc = false;
  while (Date.now() < hetHan) {
    const res = await ctx.request.get(URL_FORM);
    const body = await res.text();
    if (body.includes('id="khach_hang"')) {
      vaoDuoc = true;
      break;
    }
    await page.waitForTimeout(3000);
  }

  if (!vaoDuoc) {
    console.error('Hết 10 phút mà chưa đăng nhập xong. Không lưu phiên.');
    await browser.close();
    process.exit(1);
  }

  await ctx.storageState({ path: STATE_PATH });
  console.log(`Đã lưu phiên vào ${STATE_PATH}`);
  console.log('File này chứa cookie đăng nhập. Không commit, không gửi cho ai.');
  await browser.close();
})();
