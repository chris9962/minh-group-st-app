// Flow BH Tai nạn hộ sử dụng điện.
//
// Mọi thứ RIÊNG của sản phẩm này nằm trong file: địa chỉ form, danh sách trường
// bắt buộc, giá trị cố định, cách tính ngày, và hàm điền. `lib/order.js` không
// biết tên ô nào của PVI — thêm sản phẩm mới là thêm một file cạnh file này.

const { fmtNgay, fmtGio, fmtTien, doiISO, congNgay, congNam, congPhut } = require('../ngay');
const { BASE_URL } = require('../base-url');

const URL_FORM = `${BASE_URL}/Electrical/ElectricalService`;

// Ô đầu tiên của form. Không có ô này nghĩa là phiên đăng nhập đã hết hạn.
const SELECTOR_FORM = '#khach_hang';

const FIXED = {
  // Chốt 2026-08-15: một tài khoản khai thác cho mọi đơn, không lấy email của
  // người tạo đơn bên mình.
  email: 'ngoctuyenmgst@gmail.com',
  nganhNghe: 'TỰ DO',
  canBoKhaiThac: '21.CN062364',
  nhomKenh: '012',
  kenhBanHang: '907',
  phuongThucThanhToan: '1',
  phuongThucKhaiThac: '1',
  daiLy: '21.GROUP ST',
  maTienTe: 'VND',
  tyLePhi: '0.25',
  /**
   * Ô `MaKhach` là autocomplete jQuery UI, KHÔNG phải select.
   *
   * Nguồn của nó map `{ label: item.Text, value: item.Text }`, nên người dùng
   * chọn từ danh sách là ô nhận CHUỖI HIỂN THỊ đầy đủ, không phải mã trần. Đo
   * `POST /TNDSMotor/GetMaKhach` và `/Electrical/GetMaKhach` 2026-08-23: cả hai
   * trả `Text = "21.80000000 - KHÁCH LẺ"`, `Value = "21.80000000"`.
   *
   * Điền mã trần là ghi khác thứ trang tự ghi khi người ta thao tác tay.
   */
  maKhach: '21.80000000 - KHÁCH LẺ',
};

// Giờ hiệu lực đặt sau lúc chạy 10 phút, để đơn không mang giờ đã qua khi PVI nhận.
const BU_PHUT = 10;

const BAT_BUOC = ['hoTen', 'soThanhVien', 'diaChi', 'ngayBatDau', 'soTienBaoHiem'];

function dungGiaTri(payload, homNay = new Date()) {
  const thieu = BAT_BUOC.filter((k) => payload[k] === undefined || payload[k] === '');
  if (thieu.length) throw new Error(`Payload thiếu trường: ${thieu.join(', ')}`);

  const batDau = doiISO(payload.ngayBatDau);
  const gio = fmtGio(congPhut(homNay, BU_PHUT));
  return {
    ...FIXED,
    gioBatDau: gio,
    gioKetThuc: gio,
    hoTen: payload.hoTen,
    soThanhVien: String(payload.soThanhVien),
    diaChi: payload.diaChi,
    soTienBaoHiem: fmtTien(payload.soTienBaoHiem),
    ngayCap: fmtNgay(homNay),
    ngayBatDau: fmtNgay(batDau),
    // Mỗi đơn tối đa 1 năm. Khách cần 2 năm thì BE gọi hai lần, ngày bắt đầu
    // của đơn sau bằng ngày kết thúc của đơn trước.
    ngayKetThuc: fmtNgay(congNam(batDau)),
    ngayThanhToan: fmtNgay(congNgay(homNay, 30)),
  };
}

// Hàm này chạy TRONG TRANG, không chạy trong Node. Playwright serialize nó rồi
// gửi sang trình duyệt, nên nó không được tham chiếu biến nào ngoài tham số.
// Mọi giá trị đã định dạng sẵn ở phía Node và truyền vào qua `v`.
async function dien({ v, dryRun }) {
  const $ = window.jQuery;
  if (!$) return { loi: 'Trang không có jQuery' };

  const log = [];
  const rec = (field, status, detail) => log.push({ field, status, detail });
  const el = (id) => document.getElementById(id);

  const set = (field, id, value) => {
    const e = el(id);
    if (!e) return rec(field, 'KHÔNG CÓ Ô', id);
    if (dryRun) return rec(field, 'DRY_RUN', `${id} ← ${value}`);
    if (e.readOnly) e.removeAttribute('readonly');
    $(e).val(value).trigger('change');
    rec(field, e.value === String(value) ? 'ĐÃ ĐIỀN' : 'GHI KHÔNG VÀO', `${id} = ${e.value}`);
  };

  const pick = (field, id, value) => {
    const e = el(id);
    if (!e) return rec(field, 'KHÔNG CÓ Ô', id);
    if (dryRun) return rec(field, 'DRY_RUN', `${id} ← ${value}`);
    if (![...e.options].some((o) => o.value === value))
      return rec(field, 'KHÔNG CÓ OPTION', `${id} ← ${value}, có ${e.options.length} option`);
    $(e).val(value).trigger('change');
    rec(field, e.value === value ? 'ĐÃ CHỌN' : 'CHỌN KHÔNG VÀO', `${id} = ${e.value}`);
  };

  // bootstrap-timepicker giữ giờ trong state riêng của plugin. Đặt bằng `.val()`
  // thì lần plugin vẽ lại là giá trị cũ quay về, nên gọi API của nó trước.
  const setGio = (field, id, value) => {
    const e = el(id);
    if (!e) return rec(field, 'KHÔNG CÓ Ô', id);
    if (dryRun) return rec(field, 'DRY_RUN', `${id} ← ${value}`);
    try {
      $(e).timepicker('setTime', value);
    } catch {
      $(e).val(value);
    }
    if (e.value !== value) $(e).val(value);
    $(e).trigger('change').trigger('blur');
    rec(field, e.value === value ? 'ĐÃ ĐIỀN' : 'GHI KHÔNG VÀO', `${id} = ${e.value}`);
  };

  const check = (field, id, wanted = true) => {
    const e = el(id);
    if (!e) return rec(field, 'KHÔNG CÓ Ô', id);
    if (e.checked === wanted) return rec(field, 'ĐÚNG SẴN', `${id} = ${wanted}`);
    if (dryRun) return rec(field, 'DRY_RUN', `${id} click → ${wanted}`);
    e.click();
    rec(field, e.checked === wanted ? 'ĐÃ TICK' : 'CLICK KHÔNG ĐỔI', `${id} = ${e.checked}`);
  };

  const waitOptions = (id, ms = 10000) =>
    new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (el(id) && el(id).options.length > 0) return resolve(true);
        if (Date.now() - t0 > ms) return resolve(false);
        setTimeout(tick, 150);
      };
      tick();
    });

  set('Người mua bảo hiểm', 'khach_hang', v.hoTen);

  // MaKhach là ô autocomplete gọi POST /Electrical/GetMaKhach. Script ghi thẳng
  // giá trị, không qua danh sách gợi ý — form gửi theo `name` nên vẫn tới nơi.
  set('Mã khách hàng', 'MaKhach', v.maKhach);

  set('Email', 'Email', v.email);
  pick('Cán bộ khai thác', 'Select_Ma_CanBo_KT', v.canBoKhaiThac);
  set('Số thành viên', 'SoNguoi_HoKhau', v.soThanhVien);
  set('Địa chỉ', 'dia_chi', v.diaChi);
  set('Ngành nghề kinh doanh', 'nnghe_kd', v.nganhNghe);
  set('Ngày cấp', 'ngay_capd', v.ngayCap);

  // change_endDate() gọi API của PVI rồi ghi thoihan_bh. API là nguồn đúng cho ngày kết thúc,
  // script chỉ điền khi API để trống, và báo lại khi API cho ngày khác ngày tự tính.
  set('Ngày bắt đầu', 'ngay_batdau', v.ngayBatDau);

  // StartTime có onblur="change_endDate()". Điền giờ TRƯỚC khi đọc thoihan_bh,
  // không thì đọc xong trang mới tính lại và con số vừa đọc là của lần trước.
  setGio('Giờ bắt đầu', 'StartTime', v.gioBatDau);
  if (!dryRun) await new Promise((r) => setTimeout(r, 1200));

  if (dryRun) {
    rec('Ngày kết thúc', 'DRY_RUN', `để trang tự tính, đối chiếu với ${v.ngayKetThuc}`);
  } else {
    const auto = el('thoihan_bh').value;
    if (auto === v.ngayKetThuc) rec('Ngày kết thúc', 'TRANG TỰ ĐIỀN ĐÚNG', auto);
    else if (!auto) {
      rec('Ngày kết thúc', 'TRANG ĐỂ TRỐNG — SCRIPT ĐIỀN', v.ngayKetThuc);
      set('Ngày kết thúc', 'thoihan_bh', v.ngayKetThuc);
    } else {
      rec('Ngày kết thúc', 'TRANG KHÁC SCRIPT — GIỮ CỦA TRANG', `trang: ${auto} · script tính: ${v.ngayKetThuc}`);
    }
  }

  setGio('Giờ kết thúc', 'EndTime', v.gioKetThuc);

  // change_ngaythanhtoan() ghi ngày chạy khi chọn Thanh toán ngay. Ghi đè sau bước này.
  pick('Phương thức thanh toán', 'select_PhuongThuc_ThanhToan', v.phuongThucThanhToan);
  set('Ngày thanh toán', 'NgayThanhToan', v.ngayThanhToan);

  // kenh_bh rỗng lúc nạp trang, option đến từ POST /Electrical/GetKenhKT.
  pick('Nhóm kênh bán hàng', 'select_nhomkenh', v.nhomKenh);
  if (dryRun) rec('Kênh bán hàng', 'DRY_RUN', `kenh_bh ← ${v.kenhBanHang}`);
  else if (!(await waitOptions('kenh_bh')))
    rec('Kênh bán hàng', 'AJAX KHÔNG TRẢ OPTION', 'kenh_bh rỗng sau 10 giây');
  else pick('Kênh bán hàng', 'kenh_bh', v.kenhBanHang);

  pick('Phương thức khai thác', 'select_phuongthuc_kt', v.phuongThucKhaiThac);
  pick('Đại lý', 'DanhSach_DaiLy', v.daiLy);
  pick('Mã tiền tệ', 'Select_MaTT', v.maTienTe);
  check('Gom đơn', 'gom_don');
  check('Ngoài các đối tượng trên', 'dtbh_khac');
  check('Theo quy tắc hiện hành', 'pvbh_quytac_hienhanh');

  // ChangeDKBS_01() ghi tỷ lệ phí 0.26. Tick trước, ghi đè 0.25 sau.
  check('Điều khoản bổ sung 01', 'pvbh_dkbs_01');
  set('Số tiền bảo hiểm', 'STBH__quytac_hienhanh', v.soTienBaoHiem);
  set('Tỷ lệ phí (%)', 'tyle_phi_quytac_hienhanh', v.tyLePhi);

  check('ĐMCPKD/ĐMTL theo quy định hiện hành', 'dmcpkd_tl_qdinh_hienhanh');

  await new Promise((r) => setTimeout(r, 1500));

  const doc = (id) => (el(id) ? el(id).value : null);
  return {
    log,
    canXem: log.filter((r) => /KHÔNG|GHI ĐÈ|KHÔNG ĐỔI/.test(r.status)),
    kiemChung: {
      maKhach: doc('MaKhach'),
      ngayBatDau: doc('ngay_batdau'),
      gioBatDau: doc('StartTime'),
      ngayKetThuc: doc('thoihan_bh'),
      gioKetThuc: doc('EndTime'),
      ngayThanhToan: doc('NgayThanhToan'),
      soTienBaoHiem: doc('STBH__quytac_hienhanh'),
      tyLePhi: doc('tyle_phi_quytac_hienhanh'),
      tongPhi: doc('tong_phi'),
    },
  };
}

module.exports = {
  product: 'electric-accident',
  ten: 'BH Tai nạn hộ sử dụng điện',
  urlForm: URL_FORM,
  selectorForm: SELECTOR_FORM,
  // Nút "Chấp nhận" không có `id`, chỉ có `type=submit` trong form của trang.
  selectorLuu: 'form[action="/Electrical/ElectricalService"] button[type=submit]',
  batBuoc: BAT_BUOC,
  fixed: FIXED,
  dungGiaTri,
  dien,
};
