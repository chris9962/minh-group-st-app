const fs = require('fs');
const path = require('path');
const { STATE_PATH } = require('../config');
const { layBrowser } = require('./browser');
const { flowFor, ChuaCoFlow } = require('./flows');

const ANH_DIR_MAC_DINH = process.env.PVI_SHOT_DIR || path.join(__dirname, '..', 'anh');

const tenAnToan = (s) => String(s).replace(/[^\w.-]/g, '_');

// Trả về object, không gọi process.exit, để Next import dùng trực tiếp.
// ma: 0 điền xong · 1 payload sai · 2 phiên hết hạn · 3 lỗi trang · 4 chưa có flow
//
// Hàm này KHÔNG biết tên ô nào của PVI. Nó lo phần chung cho mọi sản phẩm —
// phiên đăng nhập, mở trang, chụp ảnh, dựng báo cáo — còn phần riêng nằm ở
// `lib/flows/<sản phẩm>.js`.
async function taoDon(payload, { dryRun = false, thuMucAnh = ANH_DIR_MAC_DINH, chupAnh = true } = {}) {
  const orderId = tenAnToan(payload?.orderId || 'khong-co-id');

  // Chọn flow TRƯỚC khi mở trình duyệt: sản phẩm chưa có script thì không có lý
  // do trả giá 3 giây khởi động Chromium để rồi dừng.
  let flow;
  try {
    flow = flowFor(payload?.product);
  } catch (e) {
    if (e instanceof ChuaCoFlow)
      return { ok: false, ma: 4, thongDiep: e.message, orderId, product: e.product };
    throw e;
  }

  let v;
  try {
    v = flow.dungGiaTri(payload);
  } catch (e) {
    return { ok: false, ma: 1, thongDiep: e.message, orderId, product: flow.product };
  }

  if (!fs.existsSync(STATE_PATH))
    return {
      ok: false,
      ma: 2,
      thongDiep: `Chưa có ${STATE_PATH}. Đăng nhập trước.`,
      orderId,
      product: flow.product,
    };

  const browser = await layBrowser();
  const ctx = await browser.newContext({ storageState: STATE_PATH });
  const page = await ctx.newPage();

  try {
    await page.goto(flow.urlForm, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Hết phiên thì trang chuyển sang màn hình đăng nhập, không còn ô của form.
    if (!(await page.locator(flow.selectorForm).count())) {
      await ctx.close().catch(() => {});
      return { ok: false, ma: 2, thongDiep: 'Phiên đăng nhập hết hạn', orderId, product: flow.product };
    }

    const kq = await page.evaluate(flow.dien, { v, dryRun });
    if (kq.loi) {
      await ctx.close().catch(() => {});
      return { ok: false, ma: 3, thongDiep: kq.loi, orderId, product: flow.product };
    }

    let anh = null;
    if (chupAnh) {
      fs.mkdirSync(thuMucAnh, { recursive: true });
      anh = path.join(thuMucAnh, `${orderId}.png`);
      await page.screenshot({ path: anh, fullPage: true });
    }

    await ctx.close().catch(() => {});

    const hong = kq.canXem.filter((r) => r.status.startsWith('KHÔNG'));
    return {
      ok: !hong.length,
      ma: hong.length ? 3 : 0,
      thongDiep: hong.length ? 'Có ô không điền được' : 'Đã điền xong, chưa bấm Lưu',
      orderId,
      product: flow.product,
      dryRun,
      kiemChung: kq.kiemChung,
      canXem: kq.canXem,
      anh,
    };
  } catch (e) {
    await ctx.close().catch(() => {});
    return { ok: false, ma: 3, thongDiep: `Lỗi khi chạy trang: ${e.message}`, orderId, product: flow.product };
  }
}

module.exports = { taoDon };
