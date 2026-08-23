// Luồng 2 — duyệt đơn đang ở trạng thái "Chờ" bên PVI.
//
// Tách hẳn khỏi luồng tạo đơn vì PVI KHÔNG trả `pr_key` lúc bấm "Chấp nhận".
// Khoá đó chỉ hiện ở màn `/Service/Manager`, trong `href` của mục "Duyệt".
// Xem `../LUONG-TAO-VA-DUYET.md`.

const { BASE_URL, MAC_DINH } = require('./base-url');

const URL_MANAGER = `${BASE_URL}/Service/Manager`;

/** Mã bộ lọc "Nghiệp vụ" của PVI, tra theo mã sản phẩm bên mình. */
const NGHIEP_VU = {
  'electric-accident': 'TNDT',
  motorbike: 'MOTO',
};

/** Mã bộ lọc "Trạng thái": 01 Chờ · 02 Chuyển · 00 Duyệt đơn · -01 Hủy · 03 Đã tạo đơn. */
const TRANG_THAI_CHO = '01';

/** Chữ ở cột "Nghiệp vụ" của bảng, để đối chiếu với mã sản phẩm bên mình. */
const TEN_NGHIEP_VU = {
  'electric-accident': 'Hộ SD điện',
  motorbike: 'TNDS xe máy',
};

const SEL = {
  locNghiepVu: '#nghiepvu',
  locTrangThai: '#tthai_don',
  bang: '#qlpdtable',
  captcha: '#cpatchaTextBox',
  nutDuyet: '#btnConfirm',
};

/**
 * Bấm "Chấp nhận" ở màn duyệt là DUYỆT ĐƠN THẬT bên PVI.
 *
 * Mặc định không bấm. Trên PVI thật phải truyền `thatSuBam` rõ ràng — cùng lối
 * với `duocBamLuu` ở `order.js`, và cùng lý do.
 */
function duocBamDuyet(muonBam) {
  if (!muonBam) return { duoc: false, vi: 'Không yêu cầu bấm Duyệt' };
  if (BASE_URL === MAC_DINH && process.env.PVI_CHO_PHEP_DUYET !== '1')
    return {
      duoc: false,
      vi: 'Đang trỏ vào PVI thật. Đặt PVI_CHO_PHEP_DUYET=1 mới bấm Duyệt được',
    };
  return { duoc: true };
}

/** Bỏ dấu, gộp khoảng trắng, viết hoa — để so tên khách giữa PVI và database. */
function chuanHoaTen(s) {
  return String(s ?? '')
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Bỏ mọi ký tự không phải số — phí trên bảng ghi `76 000`, script cầm `76000`. */
const chiSo = (s) => String(s ?? '').replace(/\D/g, '');

/**
 * Tìm dòng ứng với đơn script vừa tạo.
 *
 * Đơn vừa tạo nằm ở dòng ĐẦU vì bảng sắp mới nhất trước, nhưng dòng đầu không
 * phải lúc nào cũng đúng — người khác có thể tạo đơn cùng lúc. Nên duyệt từ trên
 * xuống và đòi khớp CẢ NĂM điều kiện. Không dòng nào khớp thì trả `null`, và
 * người gọi phải dừng chứ không duyệt bừa: duyệt nhầm đơn của người khác là thao
 * tác không đảo ngược trên dữ liệu ngoài phạm vi.
 */
function timDongVuaTao(dong, { tenKhach, product, ngayChungTu, tongPhi }) {
  const ten = chuanHoaTen(tenKhach);
  const nghiepVu = TEN_NGHIEP_VU[product];
  const phi = chiSo(tongPhi);

  const lech = (d) => {
    const sai = [];
    if (d.trangThai !== 'Chờ') sai.push(`trạng thái ${d.trangThai}`);
    if (chuanHoaTen(d.tenKhach) !== ten) sai.push(`tên "${d.tenKhach}" ≠ "${tenKhach}"`);
    if (nghiepVu && chuanHoaTen(d.nghiepVu) !== chuanHoaTen(nghiepVu))
      sai.push(`nghiệp vụ "${d.nghiepVu}" ≠ "${nghiepVu}"`);
    if (ngayChungTu && d.ngayChungTu !== ngayChungTu)
      sai.push(`ngày ${d.ngayChungTu} ≠ ${ngayChungTu}`);
    if (phi && chiSo(d.phi) !== phi) sai.push(`phí "${d.phi}" ≠ "${tongPhi}"`);
    return sai;
  };

  for (const d of dong) {
    if (!lech(d).length) return d;
  }

  /**
   * Không dòng nào khớp. Trả về `null` kèm chẩn đoán ở `timDongVuaTao.viSao` —
   * thiếu nó thì người đọc log chỉ biết "không khớp" mà không biết điều kiện nào
   * lệch, và phải mở lại bảng Manager để đoán.
   */
  timDongVuaTao.viSao = dong
    .filter((d) => d.trangThai === 'Chờ')
    .slice(0, 3)
    .map((d) => `${d.soDonDienTu}: ${lech(d).join(' · ')}`);
  return null;
}

/**
 * Đọc bảng đơn "Chờ" ở màn Manager.
 *
 * Bảng sắp MỚI NHẤT TRƯỚC, nên đơn cũ nhất nằm ở dòng CUỐI. Hàm trả nguyên thứ
 * tự của trang; người gọi tự lấy phần tử cuối.
 */
async function docDonCho(page, { product } = {}) {
  await page.goto(URL_MANAGER, { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (!(await page.locator(SEL.bang).count()))
    return { loi: 'Không thấy bảng đơn — phiên đăng nhập có thể đã hết hạn' };

  const maNghiepVu = product ? NGHIEP_VU[product] : null;
  if (product && !maNghiepVu) return { loi: `Chưa biết mã nghiệp vụ PVI của sản phẩm "${product}"` };

  // Đặt bộ lọc rồi gọi chính hàm của trang. `clickSearchDataProcess()` gọi
  // `GET /Service/ItemManager?...` bằng XHR đồng bộ rồi ghi thẳng vào
  // `#displayContent`, nên DOM đã xong khi hàm trả về.
  const dat = await page.evaluate(
    ({ locNghiepVu, locTrangThai, maNghiepVu, trangThaiCho }) => {
      const $ = window.jQuery;
      const set = (sel, v) => {
        const e = document.querySelector(sel);
        if (!e) return false;
        $ ? $(e).val(v) : (e.value = v);
        return true;
      };
      if (maNghiepVu && !set(locNghiepVu, maNghiepVu)) return { loi: 'Không thấy ô lọc nghiệp vụ' };
      if (!set(locTrangThai, trangThaiCho)) return { loi: 'Không thấy ô lọc trạng thái' };
      if (typeof window.clickSearchDataProcess !== 'function')
        return { loi: 'Trang không có hàm clickSearchDataProcess' };
      window.clickSearchDataProcess();
      return { ok: true };
    },
    { ...SEL, maNghiepVu, trangThaiCho: TRANG_THAI_CHO },
  );
  if (dat.loi) return dat;

  await page.waitForTimeout(1500);
  return docBangHienTai(page);
}

/**
 * Đọc bảng Manager của trang ĐANG mở, không tải lại và không đặt bộ lọc.
 *
 * Dùng ngay sau khi bấm "Chấp nhận": PVI trả 302 tới `/Service/Manager` nên
 * trang đã ở đó rồi, và đơn vừa tạo nằm ở dòng đầu. Tải lại là mất trạng thái
 * đó, và tốn thêm một lượt nạp bảng 1,7 MB.
 */
async function docBangHienTai(page) {
  // Bảng Manager nặng khoảng 1,7 MB. `domcontentloaded` xong không có nghĩa là
  // `tbody` đã dựng đủ dòng, nên phải đợi dòng đầu tiên xuất hiện. Bỏ bước này
  // thì hàm đọc một bảng rỗng và người gọi tưởng PVI không nhận đơn.
  try {
    await page.waitForSelector(`${SEL.bang} tbody tr`, { timeout: 20000 });
  } catch {
    return { loi: 'Bảng đơn không dựng xong sau 20 giây' };
  }

  return page.evaluate((selBang) => {
    const chu = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
    const bang = document.querySelector(selBang);
    if (!bang) return { loi: 'Bảng biến mất sau khi lọc' };

    const dong = [...bang.querySelectorAll('tbody tr')].map((tr) => {
      const o = [...tr.querySelectorAll('td')];
      // Mục "Duyệt" nằm sẵn trong DOM, không phải bấm dấu ba chấm mới hiện.
      const a = [...tr.querySelectorAll('a[href*="tthai=DUYET"]')][0];
      const url = a ? a.getAttribute('href') : '';
      const m = /pr_key=([^&]+)/.exec(url || '');
      return {
        tenKhach: chu(o[0]),
        soDonDienTu: chu(o[1]),
        soDonBaoHiem: chu(o[2]),
        nghiepVu: chu(o[3]),
        loaiRuiRo: chu(o[4]),
        phi: chu(o[5]),
        ngayChungTu: chu(o[6]),
        trangThai: chu(o[7]),
        donVi: chu(o[8]),
        canBoTao: chu(o[9]),
        daiLy: chu(o[10]),
        // Giải mã một lần: `href` mang bản đã url-encode, database lưu bản thô.
        prKey: m ? decodeURIComponent(m[1]) : '',
        urlDuyet: a ? a.href : '',
      };
    });

    return { dong: dong.filter((d) => d.trangThai === 'Chờ' && d.prKey) };
  }, SEL.bang);
}

/**
 * Mở màn duyệt của một `pr_key`, đọc thông tin, và bấm Duyệt khi được phép.
 *
 * Màn duyệt chỉ hiện tên khách, loại rủi ro, ngày chứng từ và cán bộ tạo. Không
 * có năm hiệu lực, nên hai đơn liền kề năm của cùng một khách không phân biệt
 * được ở đây — xem `../LUONG-TAO-VA-DUYET.md`.
 */
async function duyetTheoPrKey(page, prKey, { thatSuBam = false } = {}) {
  const xin = duocBamDuyet(thatSuBam);
  const url = `${BASE_URL}/Service/Assign/?pr_key=${encodeURIComponent(prKey)}&tthai=DUYET`;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const thongTin = await page.evaluate(() => {
    const doc = (id) => {
      const e = document.getElementById(id);
      return e ? e.value : null;
    };
    return {
      // Nhãn trên trang ghi "Tên dịch vụ", nhưng giá trị là TÊN KHÁCH.
      tenKhach: doc('ten_dvu'),
      // `id` của ô này có dấu tiếng Việt, đúng như PVI đặt.
      loaiRuiRo: doc('loại_ruiro'),
      ngayChungTu: doc('ngay_ctu'),
      canBoTao: doc('canbo_gui'),
      prKeyTrenTrang: doc('pr_key_dv'),
      coOCaptcha: !!document.getElementById('cpatchaTextBox'),
      coNutDuyet: !!document.getElementById('btnConfirm'),
    };
  });

  if (!thongTin.coOCaptcha || !thongTin.coNutDuyet)
    return { ok: false, thongTin, thongDiep: 'Không thấy ô captcha hoặc nút Chấp nhận' };

  if (!xin.duoc) return { ok: true, daDuyet: false, khongDuyetVi: xin.vi, thongTin, url };

  // Captcha sinh ở trình duyệt bằng canvas, đáp án nằm ở biến toàn cục `code`.
  // Ô nhập không có `name` nên không đi theo form — trang tự so sánh rồi mới
  // submit. PVI kiểm lại ở máy chủ hay không thì chưa đo được.
  const dapAn = await page.evaluate(() => window.code || '');
  if (!dapAn) return { ok: false, thongTin, thongDiep: 'Không đọc được biến `code` của captcha' };

  await page.fill(SEL.captcha, dapAn);

  const canhBao = [];
  page.once('dialog', (d) => {
    canhBao.push(d.message());
    d.dismiss().catch(() => {});
  });

  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 60000 }),
    page.locator(SEL.nutDuyet).click(),
  ]);

  return {
    ok: !canhBao.length,
    daDuyet: !canhBao.length,
    captcha: dapAn,
    canhBao,
    thongTin,
    urlSauKhiDuyet: page.url(),
  };
}

module.exports = {
  URL_MANAGER,
  NGHIEP_VU,
  TEN_NGHIEP_VU,
  TRANG_THAI_CHO,
  docDonCho,
  docBangHienTai,
  timDongVuaTao,
  chuanHoaTen,
  duyetTheoPrKey,
  duocBamDuyet,
};
