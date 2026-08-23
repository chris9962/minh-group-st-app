// Bảng đăng ký flow. Thêm sản phẩm = thêm một file cạnh đây + một dòng ở FLOWS.
//
// Tra bằng BẢNG chứ không if/else: `lib/order.js` không phải sửa khi có sản phẩm
// mới, và danh sách sản phẩm chạy được nằm gọn ở một chỗ đọc được bằng mắt.

const electricAccident = require('./electric-accident');
const motorbike = require('./motorbike');

const FLOWS = {
  'electric-accident': electricAccident,
  motorbike,
};

/** Sản phẩm mặc định khi payload không khai — giữ cho lệnh chạy tay cũ dùng được. */
const PRODUCT_MAC_DINH = 'electric-accident';

class ChuaCoFlow extends Error {
  constructor(product) {
    super(
      `Chưa có script cho sản phẩm "${product}". Đang chạy được: ${Object.keys(FLOWS).join(', ')}`,
    );
    this.product = product;
  }
}

function flowFor(product = PRODUCT_MAC_DINH) {
  const flow = FLOWS[product];
  if (!flow) throw new ChuaCoFlow(product);
  return flow;
}

module.exports = { FLOWS, PRODUCT_MAC_DINH, ChuaCoFlow, flowFor };
