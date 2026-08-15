// Địa chỉ gốc của hệ thống PVI. Mọi flow dựng URL từ đây.
//
// Đặt `PVI_BASE_URL` để trỏ sang máy chủ giả lập lúc thử nghiệm:
//   PVI_BASE_URL=http://localhost:3010 bun run pvi:order:dry
//
// KHÔNG có dấu `/` ở cuối — flow nối chuỗi `${BASE_URL}/Electrical/...`, thừa
// một dấu là địa chỉ có `//` ở giữa và máy chủ giả lập không khớp route.

const MAC_DINH = 'https://qlcd.pvi.com.vn';

const BASE_URL = (process.env.PVI_BASE_URL || MAC_DINH).replace(/\/+$/, '');

/** `true` khi đang trỏ sang máy chủ giả lập — dùng để in cảnh báo cho người chạy. */
const LA_GIA_LAP = BASE_URL !== MAC_DINH;

module.exports = { BASE_URL, MAC_DINH, LA_GIA_LAP };
