// Ghi lại mọi thứ trang gửi và nhận trong một lượt chạy.
//
// Dùng cho lần bấm "Chấp nhận" ĐẦU TIÊN trên PVI thật: đơn đó dù sao cũng phải
// tạo, nên phải lấy được trọn thông tin ngay lần đó. Sau khi có vết, đọc file để
// biết PVI trả `pr_key` ở đâu — trong header `Location`, trong HTML, hay không
// trả và phải đi tìm ở danh sách đơn.

const fs = require('fs');
const path = require('path');

/**
 * Header KHÔNG được ghi ra file.
 *
 * `cookie` và `set-cookie` của phiên PVI thay cho mật khẩu. File vết hay bị gửi
 * qua chat hoặc đính vào ticket để nhờ xem hộ, nên lọc ngay từ chỗ ghi chứ không
 * dặn người đọc tự xoá.
 */
const HEADER_BO = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization']);

const locHeader = (h) =>
  Object.fromEntries(
    Object.entries(h || {}).map(([k, v]) => [k, HEADER_BO.has(k.toLowerCase()) ? '(đã lược)' : v]),
  );

/** Bỏ qua ảnh, font, CSS — chúng chiếm hết file vết mà không nói gì về luồng. */
const dangQuanTam = (req) => !['image', 'font', 'stylesheet', 'media'].includes(req.resourceType());

/**
 * Gắn vào một `page`, trả về hàm kết thúc để ghi file.
 *
 * Ghi cả HTML trang cuối: `pr_key` có thể nằm trong link của trang đó chứ không
 * nằm ở địa chỉ, mà địa chỉ thì nhìn thanh trình duyệt là thấy còn HTML thì không.
 */
function batDauGhiVet(page, { orderId = 'khong-co-id', thuMuc } = {}) {
  const vet = { batDau: new Date().toISOString(), dieuHuong: [], goi: [] };

  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) vet.dieuHuong.push({ luc: new Date().toISOString(), url: f.url() });
  });

  page.on('request', (req) => {
    if (!dangQuanTam(req)) return;
    vet.goi.push({
      luc: new Date().toISOString(),
      method: req.method(),
      url: req.url(),
      loai: req.resourceType(),
      // Dữ liệu form gửi lên — chỗ đọc lại được bot đã điền những gì.
      duLieuGui: req.postData() || null,
      header: locHeader(req.headers()),
    });
  });

  page.on('response', async (res) => {
    const req = res.request();
    if (!dangQuanTam(req)) return;
    const dong = vet.goi.find((g) => g.url === res.url() && !g.traVe);
    const h = res.headers();
    const ghi = {
      status: res.status(),
      header: locHeader(h),
      // Chuyển hướng nằm ở đây. Nếu PVI trả 302 kèm `pr_key` thì đọc đúng dòng này.
      chuyenTiepToi: h.location || null,
    };
    if (dong) dong.traVe = ghi;
    else vet.goi.push({ url: res.url(), method: req.method(), traVe: ghi });
  });

  return async function ketThucGhiVet() {
    vet.ketThuc = new Date().toISOString();
    vet.urlCuoi = page.url();
    try {
      vet.htmlCuoi = await page.content();
    } catch {
      vet.htmlCuoi = null;
    }

    const dir = thuMuc || path.join(__dirname, '..', 'vet');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${orderId}-vet.json`);
    fs.writeFileSync(f, JSON.stringify(vet, null, 1));
    return { file: f, soGoi: vet.goi.length, soDieuHuong: vet.dieuHuong.length };
  };
}

/** Dò `pr_key` trong vết đã ghi — chạy sau khi có file, không cần mở lại trang. */
function timPrKey(vet) {
  const thay = [];
  const bat = (nguon, chuoi) => {
    for (const m of String(chuoi || '').matchAll(/pr_key(?:_dv)?["'=:\s]+([A-Za-z0-9%+/=]{6,40})/g))
      thay.push({ nguon, giaTri: decodeURIComponent(m[1]) });
  };

  vet.dieuHuong?.forEach((d) => bat(`điều hướng → ${d.url}`, d.url));
  vet.goi?.forEach((g) => {
    bat(`URL ${g.method} ${g.url}`, g.url);
    bat(`dữ liệu gửi ${g.url}`, g.duLieuGui);
    bat(`chuyển tiếp từ ${g.url}`, g.traVe?.chuyenTiepToi);
  });
  bat('url cuối', vet.urlCuoi);
  bat('html trang cuối', vet.htmlCuoi);

  // Cùng một giá trị hiện ở nhiều nguồn là chuyện thường; giữ nguồn đầu tiên.
  const daCo = new Set();
  return thay.filter((t) => !daCo.has(t.giaTri) && daCo.add(t.giaTri));
}

module.exports = { batDauGhiVet, timPrKey };
