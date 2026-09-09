/**
 * Giá trị cố định dùng chung cho MỌI sản phẩm.
 *
 * Thứ riêng của từng sản phẩm — mã nhãn hiệu xe, mức trách nhiệm lái phụ, tỷ lệ
 * phí, ngành nghề — nằm ở file sản phẩm đó, không nằm ở đây.
 */

/**
 * Hòm thư nhận giấy chứng nhận — MỘT địa chỉ của nhân viên khai thác cho mọi
 * đơn, không lấy theo khách và cũng không lấy theo người tạo đơn.
 *
 * Bên mình không lưu email ở đâu cả: `customers` và `insurance_orders` đều
 * không có cột nào. Đơn tai nạn hộ sử dụng điện đã cố định một địa chỉ từ
 * 2026-08-15 (xem `src/lib/pvi.ts`), và đơn đã cấp thật
 * `26/21/14/TNCN/0099106` ghi đúng địa chỉ của bản đó. Xe máy dùng chung để
 * giấy chứng nhận của hai sản phẩm về cùng một chỗ.
 *
 * Đổi sang hòm thư của NGÔ THỊ NGỌC DUYÊN 2026-09-08, cùng lượt đổi cán bộ
 * khai thác sang `21.CN062362` ở worker bot (`pvi-qlcd-playwright/lib/flows`).
 */
export const PVI_CERTIFICATE_EMAIL = "duyenntn98@gmail.com";
