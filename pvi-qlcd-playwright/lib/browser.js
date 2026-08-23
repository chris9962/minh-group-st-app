const { chromium } = require('playwright');
const { HEADED } = require('../config');

// Next.js dev nạp lại module mỗi lần sửa code, nên giữ browser ở globalThis
// để không mở thêm Chromium sau mỗi lần nạp lại.
const kho = (globalThis.__pviPlaywright ??= { browser: null });

async function layBrowser() {
  if (kho.browser && kho.browser.isConnected()) return kho.browser;
  kho.browser = await chromium.launch({
    headless: !HEADED,
    // Cửa sổ mở hết màn hình để người kiểm nhìn được trọn form, khỏi cuộn ngang.
    args: HEADED ? ['--start-maximized'] : [],
  });
  return kho.browser;
}

async function dongBrowser() {
  if (!kho.browser) return;
  await kho.browser.close().catch(() => {});
  kho.browser = null;
}

module.exports = { layBrowser, dongBrowser };
