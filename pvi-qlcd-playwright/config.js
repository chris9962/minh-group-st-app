// Cấu hình CHUNG cho mọi sản phẩm: phiên đăng nhập và cách mở trình duyệt.
//
// Thứ riêng của từng sản phẩm — địa chỉ form, tên ô, giá trị cố định, cách tính
// ngày — nằm ở `lib/flows/<sản phẩm>.js`, không nằm ở đây.

const path = require('path');
const { flowFor, PRODUCT_MAC_DINH } = require('./lib/flows');

const URL_GOC = 'https://qlcd.pvi.com.vn/';

const STATE_PATH = process.env.PVI_STATE || path.join(__dirname, 'storageState.json');

// Trang đặt cookie chống bot x-bni-*. Chạy có giao diện an toàn hơn headless.
const HEADED = process.env.PVI_HEADED !== '0';

/**
 * Trang dùng để KIỂM PHIÊN, mượn của flow mặc định.
 *
 * Mọi trang sau đăng nhập đều hỏi được câu "phiên còn dùng được không", nên
 * không cần địa chỉ riêng. Mượn của flow thay vì chép lại chuỗi: chép thì hai
 * chỗ cùng một URL, PVI đổi đường dẫn là một chỗ sửa và một chỗ quên.
 */
const flowKiemPhien = flowFor(PRODUCT_MAC_DINH);
const URL_FORM = flowKiemPhien.urlForm;
const SELECTOR_FORM = flowKiemPhien.selectorForm;

module.exports = { URL_GOC, URL_FORM, SELECTOR_FORM, STATE_PATH, HEADED };
