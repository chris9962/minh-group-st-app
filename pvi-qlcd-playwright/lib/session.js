const fs = require('fs');
const { URL_FORM, SELECTOR_FORM, STATE_PATH } = require('../config');
const { layBrowser } = require('./browser');

function docState() {
  if (!fs.existsSync(STATE_PATH))
    return { loi: `Chưa có ${STATE_PATH}. Chạy "node login.js" trước.` };
  try {
    return { state: JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) };
  } catch (e) {
    return { loi: `${STATE_PATH} hỏng: ${e.message}` };
  }
}

async function kiemTraPhien() {
  const { state, loi } = docState();
  if (loi) return { ok: false, ma: 2, thongDiep: loi };

  const moc = state.cookies.filter((c) => c.expires > 0).map((c) => c.expires);
  const somNhat = moc.length ? Math.min(...moc) : null;

  const browser = await layBrowser();
  const ctx = await browser.newContext({ storageState: STATE_PATH });
  const page = await ctx.newPage();

  let ok = false;
  let thongDiep;
  try {
    await page.goto(URL_FORM, { waitUntil: 'domcontentloaded', timeout: 60000 });
    ok = (await page.locator(SELECTOR_FORM).count()) > 0;
    thongDiep = ok ? 'Phiên dùng được' : 'Phiên hết hạn, hoặc không dùng được từ máy này';
  } catch (e) {
    thongDiep = `Không mở được trang: ${e.message}`;
  }
  await ctx.close().catch(() => {});

  return {
    ok,
    ma: ok ? 0 : 2,
    thongDiep,
    soCookie: state.cookies.length,
    cookieHetHanSomNhat: somNhat ? new Date(somNhat * 1000).toISOString() : 'không cookie nào có hạn',
  };
}

module.exports = { kiemTraPhien };
