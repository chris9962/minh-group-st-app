// Lớp bọc CLI cho lib/session.js. Lõi nằm ở lib/, dùng chung với Next.
// Mã thoát: 0 phiên dùng được · 2 không dùng được

const { kiemTraPhien } = require('./lib/session');
const { dongBrowser } = require('./lib/browser');

(async () => {
  const kq = await kiemTraPhien();
  await dongBrowser();
  console.log(JSON.stringify(kq, null, 1));
  process.exit(kq.ma);
})();
