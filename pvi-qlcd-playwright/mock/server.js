// Máy chủ giả lập PVI. Chạy: bun run pvi:mock
//
// Phục vụ NGUYÊN VĂN DOM thật của PVI (mock/html/*.html), chỉ đổi địa chỉ tuyệt
// đối `https://qlcd.pvi.com.vn` thành đường dẫn tương đối. Không viết lại HTML:
// id, option, `onchange` và cả năm hàm của trang phải giống thật 100%, nếu
// không thì bot chạy đúng ở đây rồi hỏng ở PVI.
//
// Bot trỏ sang đây bằng:
//   PVI_BASE_URL=http://localhost:3010 bun run pvi:order

const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.PVI_MOCK_PORT || 3010);
const HTML_DIR = path.join(__dirname, 'html');
const DON_DIR = process.env.PVI_MOCK_DON_DIR || path.join(__dirname, 'don');
const HOST_THAT = 'https://qlcd.pvi.com.vn';

/* ── Phục vụ HTML ──────────────────────────────────────────────────── */

/**
 * Bỏ tên miền PVI khỏi mọi địa chỉ tuyệt đối.
 *
 * `change_endDate` và `gettongphi_bh` viết thẳng `https://qlcd.pvi.com.vn/API/...`
 * trong thân hàm. Không đổi thì trang giả lập gọi API của PVI thật — mất hết ý
 * nghĩa của việc dựng máy chủ này, và tệ hơn là đụng vào hệ thống thật.
 */
const doiVeTuongDoi = (html) => html.split(HOST_THAT).join('');

const docHtml = (ten) => doiVeTuongDoi(fs.readFileSync(path.join(HTML_DIR, ten), 'utf8'));

/* ── Dữ liệu giả ───────────────────────────────────────────────────── */

/** Kênh bán hàng theo nhóm. Bot chọn nhóm `012` rồi chờ kênh `907`. */
const KENH_THEO_NHOM = {
  '012': [
    { Value: '907', Text: '907 - Bảo hiểm xã hội' },
    { Value: '908', Text: '908 - Liên kết ngân hàng' },
    { Value: '909', Text: '909 - Liên kết khác' },
  ],
};

/**
 * Tổng phí. Suy ra từ MỘT điểm dữ liệu đo trên trang thật ngày 2026-08-15:
 * STBH 40 000 000 với tỷ lệ 0.25 cho tổng phí 100 000, tức STBH × tỷ lệ / 100.
 *
 * Công thức thật của PVI có thể còn nhân theo số ngày hiệu lực hoặc số người
 * thuê trọ — chưa đo được. Đây là chỗ bản giả lập KHÁC bản thật, ghi ra để
 * người đọc biết mà không tin số này là con số PVI sẽ tính.
 */
function tinhPhi({ stbh, tylePhi, giamPhi }) {
  const so = (v) => Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;
  const tongTienBh = so(stbh);
  const phiTheoTyLe = Math.round((tongTienBh * so(tylePhi)) / 100);
  const tongPhi = Math.max(0, phiTheoTyLe - so(giamPhi));
  // Thứ tự khớp cách `gettongphi_bh` cắt chuỗi: phí | phí tỷ lệ | tổng tiền BH
  // | trạng thái khoá ô | phí tạm | rỗng | STBH tai nạn khác.
  // Trạng thái `0` = mở hết ô, để bot ghi đè tỷ lệ phí được như trên bản thật.
  return [tongPhi, phiTheoTyLe, tongTienBh, '0', phiTheoTyLe, '', ''].join('|');
}

/** `dd/mm/yyyy` cộng một năm — trang thật nhận ngày kết thúc từ API này. */
function congMotNam(ddmmyyyy) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(ddmmyyyy).trim());
  if (!m) return '';
  const d = new Date(Number(m[3]) + 1, Number(m[2]) - 1, Number(m[1]));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/* ── Tiện ích HTTP ─────────────────────────────────────────────────── */

const traVe = (res, code, kieu, than) =>
  res.writeHead(code, { 'Content-Type': kieu, 'Cache-Control': 'no-store' }).end(than);

const traHtml = (res, html) => traVe(res, 200, 'text/html; charset=utf-8', html);
const traJson = (res, o) => traVe(res, 200, 'application/json; charset=utf-8', JSON.stringify(o));
const traText = (res, s) => traVe(res, 200, 'text/plain; charset=utf-8', s);

const docBody = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });

/* ── Định tuyến ────────────────────────────────────────────────────── */

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  const q = u.searchParams;

  // jQuery thật, lấy từ node_modules của mgst-app. Trang nạp nó ở nhiều đường
  // dẫn khác nhau; đường nào cũng trả cùng một bản.
  if (/jquery/i.test(p) && p.endsWith('.js')) {
    const f = require.resolve('jquery/dist/jquery.min.js');
    return traVe(res, 200, 'application/javascript; charset=utf-8', fs.readFileSync(f));
  }

  // Asset còn lại (bootstrap, select2, datepicker, CSS, ảnh) chỉ lo hình thức.
  // Trả rỗng chứ không 404: 404 làm Playwright ghi lỗi mạng đầy log, mà thiếu
  // chúng thì bot vẫn điền được — nó thao tác trên select gốc, không qua select2.
  if (p.startsWith('/asset_pvi/') || p.startsWith('/Content/')) {
    if (p.endsWith('.css')) return traVe(res, 200, 'text/css', '');
    if (/\.(png|jpg|gif|svg|ico)$/i.test(p)) return traVe(res, 200, 'image/png', '');
    return traVe(res, 200, 'application/javascript', '');
  }

  /* API của trang */

  if (p === '/API/ConvertDateTimeFormat') {
    const ngay = congMotNam(q.get('value'));
    const gio = q.get('time') || '';
    // Trang bóc hai dấu ngoặc kép rồi tách theo dấu cách — trả đúng dạng đó.
    return traText(res, `"${ngay} ${gio}"`);
  }

  if (p === '/API/GetTongPhi_HoSD_Dien') {
    return traText(
      res,
      tinhPhi({
        stbh: q.get('STBH__quytac_hienhanh'),
        tylePhi: q.get('tylephi'),
        giamPhi: q.get('phi_giamphi'),
      }),
    );
  }

  if (p === '/Electrical/GetKenhKT' && req.method === 'POST') {
    const body = new URLSearchParams(await docBody(req));
    return traJson(res, KENH_THEO_NHOM[body.get('ID')] || []);
  }

  if (p === '/Electrical/GetMaKhach') return traJson(res, []);

  if (p === '/API/UploadFile_OCR') {
    return traJson(res, [{ info: { name: '', address: '', name_confidence: 0, address_confidence: 0 } }]);
  }

  /* Màn hình */

  if (p === '/' || p === '/Service/Manager') {
    res.writeHead(302, { Location: '/Electrical/ElectricalService' });
    return res.end();
  }

  if (p === '/Electrical/ElectricalService') {
    if (req.method === 'POST') {
      const don = Object.fromEntries(new URLSearchParams(await docBody(req)));
      fs.mkdirSync(DON_DIR, { recursive: true });
      const ten = `don-${Date.now()}.json`;
      fs.writeFileSync(path.join(DON_DIR, ten), JSON.stringify(don, null, 1));
      console.log(`  [đã lưu] ${ten} — ${Object.keys(don).length} trường`);
      return traHtml(res, docHtml('assign-duyet.html'));
    }
    return traHtml(res, docHtml('electrical-service.html'));
  }

  if (p === '/Service/AssignDuyet') return traHtml(res, docHtml('assign-duyet.html'));

  traVe(res, 404, 'text/plain; charset=utf-8', `Máy chủ giả lập chưa có đường dẫn ${p}`);
});

server.listen(PORT, () => {
  console.log(`Máy chủ giả lập PVI: http://localhost:${PORT}`);
  console.log(`Đơn đã gửi lưu ở  : ${DON_DIR}`);
  console.log(`Bot trỏ sang đây  : PVI_BASE_URL=http://localhost:${PORT} bun run pvi:order`);
});
