const fs = require('fs');
const path = require('path');
const { STATE_PATH, HEADED } = require('../config');
const { LA_GIA_LAP } = require('./base-url');
const { layBrowser } = require('./browser');
const { flowFor, ChuaCoFlow } = require('./flows');
const { batDauGhiVet, timPrKey } = require('./ghi-vet');

const ANH_DIR_MAC_DINH = process.env.PVI_SHOT_DIR || path.join(__dirname, '..', 'anh');

const tenAnToan = (s) => String(s).replace(/[^\w.-]/g, '_');

/**
 * Bấm nút "Chấp nhận" là TẠO ĐƠN THẬT bên PVI.
 *
 * Mặc định không bấm. Trên PVI thật còn đòi thêm `PVI_CHO_PHEP_LUU=1` — cùng
 * lối với `PVI_CHO_PHEP_DUYET` ở `lib/duyet.js`, và cùng lý do: tạo đơn không
 * đảo ngược được, nên một cờ dòng lệnh gõ nhầm không đủ để mở.
 */
function duocBamLuu(muonBam) {
  if (!muonBam) return { duoc: false };
  if (!LA_GIA_LAP && process.env.PVI_CHO_PHEP_LUU !== '1')
    return {
      duoc: false,
      vi: 'Đang trỏ vào PVI thật. Đặt PVI_CHO_PHEP_LUU=1 mới bấm Chấp nhận được',
    };
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
  {
    dryRun = false,
    thuMucAnh = ANH_DIR_MAC_DINH,
    chupAnh = true,
    bamLuu = false,
    /** Ghi mọi request/response ra `vet/<orderId>-vet.json`. */
    ghiVet = false,
    /**
     * Điền xong thì GIỮ trình duyệt mở bấy nhiêu giây cho người bấm tay.
     *
     * Dùng cho lần bấm "Chấp nhận" đầu tiên trên PVI thật: bot không bấm, người
     * bấm, còn bot ngồi ghi lại PVI trả gì. Đơn đó dù sao cũng phải tạo nên
     * không tốn thêm đơn rác, mà lấy được trọn thông tin để nối bước duyệt.
     */
    choNguoiBamGiay = 0,
    /** Nhận tên từng chặng để người gọi đo thời gian. Mặc định không làm gì. */
    moc = () => {},
    /**
     * Chạy ngay sau khi bấm "Chấp nhận", lúc trang còn mở.
     *
     * `async (page, { orderId, product, v, kq }) => any`. Kết quả nằm ở
     * `daLuu.sauKhiLuu`; ném lỗi thì lỗi nằm ở `daLuu.sauKhiLuuLoi` và luồng
     * chính vẫn đi tiếp — đơn đã tạo rồi, dừng ở đây không lấy lại được gì.
     */
    sauKhiLuu = null,
  } = {},
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
  moc('Chromium sẵn sàng');
  // `viewport: null` cho vùng vẽ bám theo cửa sổ thật. Bỏ nó thì Playwright ép
  // 1280x720 cố định: kéo to cửa sổ ra mà trang không tính lại bố cục.
  const ctx = await browser.newContext({
    storageState: STATE_PATH,
    ...(HEADED ? { viewport: null } : {}),
  });
  const page = await ctx.newPage();

  // Gắn TRƯỚC khi mở trang: lượt tải đầu cũng là dữ liệu, và chuyển hướng lúc
  // hết phiên chỉ thấy được nếu đã nghe từ đầu.
  const ketThucGhiVet = ghiVet || choNguoiBamGiay > 0 ? batDauGhiVet(page, { orderId }) : null;

  try {
    await page.goto(flow.urlForm, { waitUntil: 'domcontentloaded', timeout: 60000 });
    moc('nạp xong trang form');

    // Hết phiên thì trang chuyển sang màn hình đăng nhập, không còn ô của form.
    if (!(await page.locator(flow.selectorForm).count())) {
      await ctx.close().catch(() => {});
      return { ok: false, ma: 2, thongDiep: 'Phiên đăng nhập hết hạn', orderId, product: flow.product };
    }

    const kq = await page.evaluate(flow.dien, { v, dryRun });
    moc('điền xong 26 ô');
    if (kq.loi) {
      await ctx.close().catch(() => {});
      return { ok: false, ma: 3, thongDiep: kq.loi, orderId, product: flow.product };
    }

    let anh = null;
    if (chupAnh) {
      fs.mkdirSync(thuMucAnh, { recursive: true });
      anh = path.join(thuMucAnh, `${orderId}.png`);
      await page.screenshot({ path: anh, fullPage: true });
      moc('chụp ảnh xong');
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

      // Chạy TRONG LÚC trang còn mở, ngay sau khi PVI chuyển sang
      // `/Service/Manager`. Đó là lúc duy nhất đọc được dòng đơn vừa tạo mà
      // không phải nạp lại bảng 1,7 MB. Người gọi dùng nó để khớp và duyệt.
      if (sauKhiLuu) {
        try {
          daLuu.sauKhiLuu = await sauKhiLuu(page, { orderId, product: flow.product, v, kq });
        } catch (e) {
          daLuu.sauKhiLuuLoi = e.message;
        }
      }

      if (chupAnh && anh) {
        const anhSau = anh.replace(/\.png$/, '-sau-luu.png');
        await page.screenshot({ path: anhSau, fullPage: true });
        daLuu.anh = anhSau;
      }
    }

    // Người bấm tay. Trình duyệt phải MỞ (PVI_HEADED khác 0) thì mới có ai bấm
    // được — chạy headless mà chờ thì chỉ tốn thời gian.
    if (choNguoiBamGiay > 0 && !hong.length) {
      await page.waitForTimeout(choNguoiBamGiay * 1000);
      if (chupAnh && anh) {
        const anhCho = anh.replace(/\.png$/, '-sau-cho.png');
        await page.screenshot({ path: anhCho, fullPage: true });
      }
    }

    let vet = null;
    if (ketThucGhiVet) {
      const v = await ketThucGhiVet();
      const doc = JSON.parse(fs.readFileSync(v.file, 'utf8'));
      vet = { ...v, prKeyTimThay: timPrKey(doc), urlCuoi: doc.urlCuoi };
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
      ...(vet ? { vet } : {}),
      ...(bamLuu && !xin.duoc && xin.vi ? { khongBamLuuVi: xin.vi } : {}),
    };
  } catch (e) {
    await ctx.close().catch(() => {});
    return { ok: false, ma: 3, thongDiep: `Lỗi khi chạy trang: ${e.message}`, orderId, product: flow.product };
  }
}

module.exports = { taoDon };
