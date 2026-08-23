// Phiên đăng nhập PVI: kiểm còn dùng được không, và đăng nhập lại khi hết.
// Dùng chung cho luồng tạo đơn (`chay-don.js`) và luồng duyệt (`duyet-don.js`).

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { request } = require('playwright');
const { URL_FORM, SELECTOR_FORM, STATE_PATH } = require('../config');

const ENV_LOCAL = path.join(__dirname, '..', '..', '.env.local');

/** Đọc một biến trong `.env.local`. Không nạp cả file để khỏi ghi đè env đang có. */
function tuEnvLocal(ten) {
  if (!fs.existsSync(ENV_LOCAL)) return '';
  const dong = fs
    .readFileSync(ENV_LOCAL, 'utf8')
    .split('\n')
    .find((d) => d.trim().startsWith(`${ten}=`));
  if (!dong) return '';
  return dong.slice(dong.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}

/** Tài khoản theo thứ tự: biến môi trường → `.env.local` → payload. */
function layTaiKhoan(payload = {}) {
  return {
    taiKhoan: process.env.PVI_USER || tuEnvLocal('PVI_USER') || payload.taiKhoan || '',
    matKhau: process.env.PVI_PASS || tuEnvLocal('PVI_PASS') || payload.matKhau || '',
  };
}

/**
 * Kiểm phiên bằng một lượt HTTP, không mở trình duyệt.
 *
 * `ensure-login.js` cũng kiểm phiên, nhưng nó khởi động Chromium để làm việc đó
 * — đo trên macOS 2026-08-23: 4,6 giây, so với 1,0 giây của lượt HTTP này.
 * Còn phiên là bỏ được cả lần khởi động ấy.
 *
 * Trả `null` khi không kết luận được; người gọi cứ chạy `ensure-login.js`.
 */
async function conPhien() {
  if (!fs.existsSync(STATE_PATH)) return false;
  let ctx;
  try {
    ctx = await request.newContext({ storageState: STATE_PATH });
    const res = await ctx.get(URL_FORM, { timeout: 30000 });
    if (!res.ok()) return false;
    // Hết phiên thì PVI trả màn hình đăng nhập, không còn ô đầu của form.
    return (await res.text()).includes(`id="${SELECTOR_FORM.replace('#', '')}"`);
  } catch {
    return null;
  } finally {
    await ctx?.dispose().catch(() => {});
  }
}

/**
 * Gọi `ensure-login.js` như tiến trình con.
 *
 * Chạy riêng chứ không require: nó tự mở và đóng Chromium của nó, còn
 * `lib/browser.js` giữ một Chromium khác dùng chung cho các đơn sau.
 */
function dangNhapLai({ orderId, taiKhoan, matKhau }) {
  return new Promise((resolve) => {
    const con = spawn(process.execPath, [path.join(__dirname, '..', 'ensure-login.js')], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, PVI_USER: '', PVI_PASS: '' },
    });
    let out = '';
    con.stdout.on('data', (c) => (out += c));
    con.on('close', (ma) => {
      let bao = null;
      try {
        bao = JSON.parse(out);
      } catch {
        bao = { thongDiep: out.trim() };
      }
      resolve({ ma, bao });
    });
    con.stdin.end(JSON.stringify({ orderId, taiKhoan, matKhau }));
  });
}

/**
 * Bảo đảm có phiên dùng được. Trả `{ ma, bao, daCoSan }`.
 * `ma` khác 0 nghĩa là không vào được, người gọi phải dừng.
 */
async function baoDamPhien({ orderId = 'khong-co-id', payload = {} } = {}) {
  const daCoSan = await conPhien();
  if (daCoSan)
    return { ma: 0, daCoSan: true, bao: { daDangNhap: true, thongDiep: 'Phiên còn dùng được' } };

  const { taiKhoan, matKhau } = layTaiKhoan(payload);
  if (!taiKhoan || !matKhau)
    return {
      ma: 2,
      daCoSan: false,
      bao: {
        thongDiep: 'Hết phiên đăng nhập và không có tài khoản. Đặt PVI_USER và PVI_PASS trong .env.local.',
      },
    };

  const kq = await dangNhapLai({ orderId, taiKhoan, matKhau });
  return { ma: kq.ma === 0 ? 0 : 2, daCoSan: false, bao: kq.bao };
}

module.exports = { conPhien, dangNhapLai, baoDamPhien, layTaiKhoan, tuEnvLocal };
