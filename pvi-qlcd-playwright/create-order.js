// Lớp bọc CLI cho lib/order.js. Lõi nằm ở lib/, dùng chung với Next.
// Đọc payload JSON từ stdin, in báo cáo JSON ra stdout. Script KHÔNG bấm Lưu.
//   echo '{"orderId":"DH-001","hoTen":"..."}' | node create-order.js
// Mã thoát: 0 điền xong · 1 payload sai · 2 phiên hết hạn · 3 lỗi trang

const { taoDon } = require('./lib/order');
const { dongBrowser } = require('./lib/browser');

const doiStdin = () =>
  new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
  });

const inRa = (kq) => {
  console.log(JSON.stringify(kq, null, 1));
  process.exit(kq.ma);
};

(async () => {
  let payload;
  try {
    payload = JSON.parse(await doiStdin());
  } catch (e) {
    inRa({ ok: false, ma: 1, thongDiep: `Payload không phải JSON hợp lệ: ${e.message}` });
  }

  const kq = await taoDon(payload, { dryRun: process.argv.includes('--dry-run') });
  await dongBrowser();
  inRa(kq);
})();
