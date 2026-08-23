// Luồng 2 — duyệt đơn "Chờ" bên PVI. Chạy độc lập với luồng tạo đơn.
//
//   node duyet-don.js                      # chỉ liệt kê đơn Chờ, không bấm gì
//   node duyet-don.js --san-pham=electric-accident
//   node duyet-don.js --duyet              # mở màn duyệt đơn cũ nhất, chưa bấm
//   PVI_CHO_PHEP_DUYET=1 node duyet-don.js --duyet   # bấm Duyệt thật
//
// ⚠️ Bấm "Chấp nhận" ở màn duyệt là DUYỆT ĐƠN THẬT. Không đặt
// `PVI_CHO_PHEP_DUYET=1` thì script mở trang, đọc thông tin, rồi dừng.
//
// Mã thoát: 0 xong · 2 phiên hết hạn · 3 lỗi trang

const { baoDamPhien } = require('./lib/phien');
const { layBrowser, dongBrowser } = require('./lib/browser');
const { docDonCho, duyetTheoPrKey } = require('./lib/duyet');
const { STATE_PATH } = require('./config');

const T0 = Date.now();
const moc = (ten) => console.error(`[${((Date.now() - T0) / 1000).toFixed(2)}s] ${ten}`);

const inRa = (kq, ma) => {
  console.log(JSON.stringify(kq, null, 1));
  process.exit(ma ?? kq.ma ?? 0);
};

const doiSo = (ten) => {
  const m = new RegExp(`--${ten}=([^\\s]+)`).exec(process.argv.join(' '));
  return m ? m[1] : null;
};

(async () => {
  const phien = await baoDamPhien({ orderId: 'duyet-don' });
  moc(phien.daCoSan ? 'kiểm phiên: còn dùng được' : 'kiểm phiên: đã đăng nhập lại');
  if (phien.ma !== 0)
    inRa({ ok: false, ma: 2, thongDiep: phien.bao?.thongDiep, buoc: 'ensure-login' }, 2);

  const browser = await layBrowser();
  const ctx = await browser.newContext({ storageState: STATE_PATH });
  const page = await ctx.newPage();

  try {
    const bang = await docDonCho(page, { product: doiSo('san-pham') });
    if (bang.loi) {
      await dongBrowser();
      inRa({ ok: false, ma: 3, thongDiep: bang.loi }, 3);
    }
    moc(`đọc bảng xong: ${bang.dong.length} đơn Chờ`);

    // Bảng sắp mới nhất trước, nên đơn cũ nhất là dòng CUỐI.
    const cuNhat = bang.dong[bang.dong.length - 1] || null;

    if (!process.argv.includes('--duyet') || !cuNhat) {
      await dongBrowser();
      inRa({
        ok: true,
        ma: 0,
        thongDiep: cuNhat ? 'Chỉ liệt kê, chưa mở màn duyệt' : 'Không có đơn nào ở trạng thái Chờ',
        soDonCho: bang.dong.length,
        cuNhat,
        donCho: bang.dong,
      });
    }

    moc(`mở màn duyệt của ${cuNhat.tenKhach} · ${cuNhat.soDonDienTu}`);
    const kq = await duyetTheoPrKey(page, cuNhat.prKey, {
      thatSuBam: process.argv.includes('--duyet'),
    });
    moc(kq.daDuyet ? 'đã bấm Duyệt' : 'chưa bấm Duyệt');

    await dongBrowser();
    inRa({
      ok: kq.ok,
      ma: kq.ok ? 0 : 3,
      thongDiep: kq.thongDiep || (kq.daDuyet ? 'Đã duyệt' : kq.khongDuyetVi),
      soDonCho: bang.dong.length,
      donTrenBang: cuNhat,
      manDuyet: kq,
    });
  } catch (e) {
    await dongBrowser();
    inRa({ ok: false, ma: 3, thongDiep: `Lỗi khi chạy trang: ${e.message}` }, 3);
  }
})();
