// Chạy trọn một đơn bằng MỘT lệnh: bảo đảm phiên đăng nhập rồi điền form.
//
//   cat payload.example.json | node chay-don.js
//
// ⚠️ Mặc định KHÔNG bấm "Chấp nhận". Bấm là tạo đơn thật bên PVI, nên cần cả
// cờ `--bam-luu` lẫn biến `PVI_CHO_PHEP_LUU=1`:
//
//   PVI_CHO_PHEP_LUU=1 node chay-don.js --bam-luu
//
// Gộp hai bước mà trước đây người chạy phải gọi tay theo thứ tự:
//   1. ensure-login.js — còn phiên thì thoát ngay, hết phiên thì đăng nhập lại
//   2. lib/order.js    — mở form, điền, chụp ảnh, in báo cáo
//
// Tài khoản lấy theo thứ tự: biến môi trường → `.env.local` → payload.
// Mã thoát: 0 điền xong · 1 payload sai · 2 cần người vận hành · 3 lỗi trang

const { taoDon } = require('./lib/order');
const { dongBrowser } = require('./lib/browser');
const { baoDamPhien } = require('./lib/phien');

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

(async () => {
  let payload;
  try {
    payload = JSON.parse(await doiStdin());
  } catch (e) {
    inRa({ ok: false, ma: 1, thongDiep: `Payload không phải JSON hợp lệ: ${e.message}` });
  }

  const orderId = payload.orderId || 'khong-co-id';

  const phien = await baoDamPhien({ orderId, payload });
  moc(phien.daCoSan ? 'kiểm phiên: còn dùng được' : 'kiểm phiên: đã đăng nhập lại');
  if (phien.ma !== 0)
    inRa(
      { ok: false, ma: 2, thongDiep: phien.bao?.thongDiep, orderId, buoc: 'ensure-login' },
      2,
    );

  // `--cho-nguoi-bam=0` để đóng trình duyệt ngay sau khi điền.
  const cho = /--cho-nguoi-bam=(\d+)/.exec(process.argv.join(' '));

  const choGiay = cho ? Number(cho[1]) : CHO_MAC_DINH;
  if (choGiay > 0) moc(`mở trình duyệt, điền form, rồi giữ mở ${choGiay} giây`);
  else moc('mở trình duyệt và điền form');

  const kq = await taoDon(payload, {
    dryRun: process.argv.includes('--dry-run'),
    ghiVet: process.argv.includes('--ghi-vet'),
    // `lib/order.js` còn đòi PVI_CHO_PHEP_LUU=1 mới thật sự bấm trên PVI thật.
    bamLuu: process.argv.includes('--bam-luu'),
    choNguoiBamGiay: choGiay,
    moc,
  });
  moc('điền xong, đóng trình duyệt');
  await dongBrowser();
  inRa({ ...kq, phienDaCoSan: phien.daCoSan });
})();
