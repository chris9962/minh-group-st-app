// Chạy trọn một đơn bằng MỘT lệnh: bảo đảm phiên đăng nhập rồi điền form.
// Script KHÔNG bấm Lưu.
//
//   cat payload.example.json | node chay-don.js
//
// Gộp hai bước mà trước đây người chạy phải gọi tay theo thứ tự:
//   1. ensure-login.js — còn phiên thì thoát ngay, hết phiên thì đăng nhập lại
//   2. lib/order.js    — mở form, điền, chụp ảnh, in báo cáo
//
// Tài khoản lấy theo thứ tự: biến môi trường → `.env.local` → payload.
// Mã thoát: 0 điền xong · 1 payload sai · 2 cần người vận hành · 3 lỗi trang

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { request } = require('playwright');
const { taoDon } = require('./lib/order');
const { dongBrowser } = require('./lib/browser');
const { URL_FORM, SELECTOR_FORM, STATE_PATH } = require('./config');

const ENV_LOCAL = path.join(__dirname, '..', '.env.local');

const T0 = Date.now();
/** Mốc thời gian ra stderr, không ra stdout — BE đọc stdout và chỉ chờ JSON ở đó. */
const moc = (ten) => console.error(`[${((Date.now() - T0) / 1000).toFixed(2)}s] ${ten}`);

// Điền xong mà đóng trình duyệt ngay thì không ai kịp nhìn form. Đặt 0 để tắt.
const CHO_MAC_DINH = 90;

const inRa = (kq, ma) => {
  console.log(JSON.stringify(kq, null, 1));
  process.exit(ma ?? kq.ma ?? 0);
};

const doiStdin = () =>
  new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
  });

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

/**
 * Kiểm phiên bằng một lượt HTTP, không mở trình duyệt.
 *
 * `ensure-login.js` cũng kiểm phiên, nhưng nó khởi động Chromium để làm việc đó
 * — đo trên máy macOS 2026-08-23: 4.6 giây, so với 1.0 giây của lượt HTTP này.
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
function baoDamPhien({ orderId, taiKhoan, matKhau }) {
  return new Promise((resolve) => {
    const con = spawn(process.execPath, [path.join(__dirname, 'ensure-login.js')], {
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

(async () => {
  let payload;
  try {
    payload = JSON.parse(await doiStdin());
  } catch (e) {
    inRa({ ok: false, ma: 1, thongDiep: `Payload không phải JSON hợp lệ: ${e.message}` });
  }

  const orderId = payload.orderId || 'khong-co-id';
  const taiKhoan = process.env.PVI_USER || tuEnvLocal('PVI_USER') || payload.taiKhoan || '';
  const matKhau = process.env.PVI_PASS || tuEnvLocal('PVI_PASS') || payload.matKhau || '';

  const daCoPhien = await conPhien();
  moc(daCoPhien ? 'kiểm phiên: còn dùng được' : 'kiểm phiên: phải đăng nhập lại');

  const phien = daCoPhien
    ? { ma: 0, bao: { daDangNhap: true, thongDiep: 'Phiên còn dùng được' } }
    : await baoDamPhien({ orderId, taiKhoan, matKhau });
  if (!daCoPhien) moc('đăng nhập xong');
  if (phien.ma !== 0) {
    const thieuTaiKhoan = !taiKhoan || !matKhau;
    inRa(
      {
        ok: false,
        ma: 2,
        thongDiep: thieuTaiKhoan
          ? 'Hết phiên đăng nhập và không có tài khoản. Đặt PVI_USER và PVI_PASS trong .env.local.'
          : `Đăng nhập không thành: ${phien.bao?.thongDiep || 'không rõ lý do'}`,
        orderId,
        buoc: 'ensure-login',
        chiTiet: phien.bao,
      },
      2,
    );
  }

  // `--cho-nguoi-bam=0` để đóng trình duyệt ngay sau khi điền.
  const cho = /--cho-nguoi-bam=(\d+)/.exec(process.argv.join(' '));

  const choGiay = cho ? Number(cho[1]) : CHO_MAC_DINH;
  if (choGiay > 0) moc(`mở trình duyệt, điền form, rồi giữ mở ${choGiay} giây`);
  else moc('mở trình duyệt và điền form');

  const kq = await taoDon(payload, {
    dryRun: process.argv.includes('--dry-run'),
    ghiVet: process.argv.includes('--ghi-vet'),
    choNguoiBamGiay: choGiay,
    moc,
  });
  moc('điền xong, đóng trình duyệt');
  await dongBrowser();
  inRa({ ...kq, phienDaCoSan: phien.bao?.daDangNhap === true });
})();
