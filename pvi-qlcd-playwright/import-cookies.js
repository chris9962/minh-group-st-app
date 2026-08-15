// Đổi chuỗi cookie lấy từ Chrome đang đăng nhập thành storageState.json.
// Dùng khi bạn không muốn cài Playwright trên máy cá nhân.
//   node import-cookies.js cookie.txt
//   pbpaste | node import-cookies.js
//
// Lấy chuỗi cookie: mở tab đã đăng nhập, F12 → Network → tải lại trang →
// click request đầu tiên → Request Headers → copy toàn bộ giá trị của dòng `cookie:`.

const fs = require('fs');
const { STATE_PATH } = require('./config');

const DOMAIN = 'qlcd.pvi.com.vn';

const doiStdin = () =>
  new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
  });

(async () => {
  const duongDan = process.argv[2];
  const raw = duongDan ? fs.readFileSync(duongDan, 'utf8') : await doiStdin();

  // Người dùng hay copy cả tên header, cắt bỏ cho đỡ phải dặn.
  const chuoi = raw.trim().replace(/^cookie\s*:\s*/i, '');
  if (!chuoi) {
    console.error('Không có nội dung. Truyền file, hoặc đưa chuỗi cookie qua stdin.');
    process.exit(1);
  }

  const cookies = chuoi
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf('=');
      if (i < 1) return null;
      return {
        name: p.slice(0, i).trim(),
        value: p.slice(i + 1).trim(),
        domain: DOMAIN,
        path: '/',
        // Header Cookie không mang hạn dùng, nên đánh dấu là cookie phiên.
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      };
    })
    .filter(Boolean);

  if (!cookies.length) {
    console.error('Không đọc ra cookie nào. Chuỗi phải dạng "ten=gia_tri; ten2=gia_tri2".');
    process.exit(1);
  }

  const state = { cookies, origins: [{ origin: `https://${DOMAIN}`, localStorage: [] }] };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));
  fs.chmodSync(STATE_PATH, 0o600);

  console.log(`Đã ghi ${cookies.length} cookie vào ${STATE_PATH}`);
  console.log('Tên cookie:', cookies.map((c) => c.name).join(', '));
  console.log('File này thay cho mật khẩu. Không commit, không gửi cho ai.');
})();
