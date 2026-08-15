const fs = require('fs');
const path = require('path');
const { STATE_PATH } = require('../config');
const { LA_GIA_LAP } = require('./base-url');
const { layBrowser } = require('./browser');
const { flowFor, ChuaCoFlow } = require('./flows');

const ANH_DIR_MAC_DINH = process.env.PVI_SHOT_DIR || path.join(__dirname, '..', 'anh');

const tenAnToan = (s) => String(s).replace(/[^\w.-]/g, '_');

/**
 * Bấm nút "Chấp nhận" là TẠO ĐƠN THẬT bên PVI.
 *
 * Mặc định không bấm, và trên hệ thống thật thì từ chối bấm kể cả khi người gọi
 * yêu cầu — chỉ mở khi `PVI_BASE_URL` trỏ sang máy chủ giả lập. Muốn bật trên
 * PVI thật thì phải sửa dòng này, và đó đúng là mức cân nhắc nó xứng đáng.
 */
function duocBamLuu(muonBam) {
  if (!muonBam) return { duoc: false };
  if (!LA_GIA_LAP)
    return { duoc: false, vi: 'Đang trỏ vào PVI thật — bấm Lưu ở đó là tạo đơn thật, script từ chối' };
  return { duoc: true };
}

// Trả về object, không gọi process.exit, để Next import dùng trực tiếp.
// ma: 0 điền xong · 1 payload sai · 2 phiên hết hạn · 3 lỗi trang · 4 chưa có flow
//
// Hàm này KHÔNG biết tên ô nào của PVI. Nó lo phần chung cho mọi sản phẩm —
// phiên đăng nhập, mở trang, chụp ảnh, dựng báo cáo — còn phần riêng nằm ở
// `lib/flows/<sản phẩm>.js`.
async function taoDon(
  payload,
  { dryRun = false, thuMucAnh = ANH_DIR_MAC_DINH, chupAnh = true, bamLuu = false } = {},
) {
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

    const hong = kq.canXem.filter((r) => r.status.startsWith('KHÔNG'));

    // Chỉ bấm khi mọi ô đã điền được. Bấm lên một form còn ô hỏng là gửi đơn
    // thiếu dữ liệu, rồi phải đi tìm xem thiếu gì ở phía nhận.
    const xin = duocBamLuu(bamLuu && !dryRun && !hong.length);
    let daLuu = null;
    if (xin.duoc) {
      await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        page.locator(flow.selectorLuu).click(),
      ]);
      daLuu = { url: page.url(), tieuDe: await page.title() };

      // Máy chủ giả lập trả trang kiểm kèm `#ket-qua`; PVI thật không có khối
      // này nên bỏ qua. Đây là chỗ duy nhất nói được "dữ liệu tới nơi hay chưa"
      // — báo cáo điền của bot chỉ nói nó ghi được vào ô.
      const o = page.locator('#ket-qua');
      if (await o.count()) {
        daLuu.mayChuNhan = {
          dat: (await o.getAttribute('data-dat')) === '1',
          soHong: Number(await o.getAttribute('data-so-hong')),
          tomTat: (await o.innerText()).trim(),
        };
      }
      if (chupAnh && anh) {
        const anhSau = anh.replace(/\.png$/, '-sau-luu.png');
        await page.screenshot({ path: anhSau, fullPage: true });
        daLuu.anh = anhSau;
      }
    }

    await ctx.close().catch(() => {});

    return {
      ok: !hong.length,
      ma: hong.length ? 3 : 0,
      thongDiep: hong.length
        ? 'Có ô không điền được'
        : daLuu
          ? 'Đã điền xong và đã bấm Lưu'
          : 'Đã điền xong, chưa bấm Lưu',
      orderId,
      product: flow.product,
      dryRun,
      kiemChung: kq.kiemChung,
      canXem: kq.canXem,
      anh,
      daLuu,
      ...(bamLuu && !xin.duoc && xin.vi ? { khongBamLuuVi: xin.vi } : {}),
    };
  } catch (e) {
    await ctx.close().catch(() => {});
    return { ok: false, ma: 3, thongDiep: `Lỗi khi chạy trang: ${e.message}`, orderId, product: flow.product };
  }
}

module.exports = { taoDon };
