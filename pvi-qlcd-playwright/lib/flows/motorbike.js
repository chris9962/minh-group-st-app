// Flow BH TNDS xe máy.
//
// Mọi thứ RIÊNG của sản phẩm này nằm trong file: địa chỉ form, danh sách trường
// bắt buộc, giá trị cố định, cách tính ngày, và hàm điền.

const { fmtNgay, fmtGio, fmtTien, doiISO, congNgay, congNam, congPhut } = require('../ngay');
const { BASE_URL } = require('../base-url');

const URL_FORM = `${BASE_URL}/TNDSMotor/Motor`;

// Ô biển kiểm soát. Không có ô này nghĩa là phiên đăng nhập đã hết hạn.
const SELECTOR_FORM = '#BienKiemSoat';

const FIXED = {
  // Chốt 2026-08-23. Cán bộ khai thác KHÁC flow tai nạn điện: đơn xe máy do
  // TRẦN KIỀU PHƯƠNG đứng tên, đơn điện do ĐẶNG THỊ Ý NHẠT.
  canBoKhaiThac: '21.CN062367',
  nhomKenh: '012',
  kenhBanHang: '907',
  phuongThucKhaiThac: '1',
  daiLy: '21.GROUP ST',
  maTienTe: 'VND',
  maKhach: '21.80000000',
  // 270 - XE MAY KHAC. Trang chọn sẵn mã này, script vẫn đặt lại cho chắc.
  nhanHieuXe: '270',
  // Chốt 2026-08-23: mọi đơn khai là xe mới 100%. Đơn nối tiếp bảo hiểm cũ
  // (`TTTG1.03`) chưa làm.
  tinhTrangXe: 'TTTG1.01',
  mucTrachNhiemLaiPhu: 5000000,
  soNguoiToiDa: '2',
};

/** Mã loại xe của PVI. Cà vẹt không đọc ra được thì dùng mặc định. */
const LOAI_XE_MAC_DINH = '1002';

/** Một đơn tối đa 3 năm — PVI không cấp dài hơn. */
const SO_NAM_TOI_DA = 3;

// Giờ hiệu lực đặt sau lúc chạy 20 phút, để đơn không mang giờ đã qua khi PVI nhận.
const BU_PHUT = 20;

const BAT_BUOC = ['hoTen', 'diaChi', 'bienSo'];

function dungGiaTri(payload, homNay = new Date()) {
  const thieu = BAT_BUOC.filter((k) => payload[k] === undefined || payload[k] === '');
  if (thieu.length) throw new Error(`Payload thiếu trường: ${thieu.join(', ')}`);

  const soNam = Number(payload.soNam ?? 1);
  if (!Number.isInteger(soNam) || soNam < 1 || soNam > SO_NAM_TOI_DA)
    throw new Error(`soNam phải là số nguyên từ 1 đến ${SO_NAM_TOI_DA}, nhận "${payload.soNam}"`);

  /**
   * Ngày bắt đầu: đơn cấp mới thì tính từ ngày chạy, đơn nối tiếp bảo hiểm cũ
   * thì BE truyền ngày kết thúc của đơn cũ vào `ngayBatDau`.
   */
  const batDau = payload.ngayBatDau ? doiISO(payload.ngayBatDau) : homNay;
  const gio = fmtGio(congPhut(homNay, BU_PHUT));

  let ketThuc = batDau;
  for (let i = 0; i < soNam; i += 1) ketThuc = congNam(ketThuc);

  return {
    ...FIXED,
    mucTrachNhiemLaiPhu: fmtTien(FIXED.mucTrachNhiemLaiPhu),
    hoTen: payload.hoTen,
    diaChi: payload.diaChi,
    // Không bắt buộc: PVI nhận đơn không có số điện thoại.
    soDienThoai: payload.soDienThoai || '',
    bienSo: payload.bienSo,
    // PVI vẫn đòi có ký tự trong hai ô này. Cà vẹt không ghi số thì điền dấu
    // cách — bỏ trống là trang chặn lúc bấm Chấp nhận.
    soMay: payload.soMay || ' ',
    soKhung: payload.soKhung || ' ',
    loaiXe: payload.loaiXe || LOAI_XE_MAC_DINH,
    soNam,
    ngayBatDau: fmtNgay(batDau),
    ngayKetThuc: fmtNgay(ketThuc),
    gioBatDau: gio,
    gioKetThuc: gio,
    ngayThanhToan: fmtNgay(congNgay(homNay, 30)),
  };
}

// Hàm này chạy TRONG TRANG, không chạy trong Node. Playwright serialize nó rồi
// gửi sang trình duyệt, nên nó không được tham chiếu biến nào ngoài tham số.
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

  const check = (field, id, wanted = true) => {
    const e = el(id);
    if (!e) return rec(field, 'KHÔNG CÓ Ô', id);
    if (e.checked === wanted) return rec(field, 'ĐÚNG SẴN', `${id} = ${wanted}`);
    if (dryRun) return rec(field, 'DRY_RUN', `${id} click → ${wanted}`);
    e.click();
    rec(field, e.checked === wanted ? 'ĐÃ TICK' : 'CLICK KHÔNG ĐỔI', `${id} = ${e.checked}`);
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

  // Loại xe TRƯỚC mọi thứ: `TinhPhiBH()` gửi mã loại xe lên PVI để tính phí, nên
  // đặt sau là lần tính phí đầu chạy với ô rỗng.
  pick('Loại xe', 'select_loaixe', v.loaiXe);
  pick('Nhãn hiệu xe', 'ddlHieuXe', v.nhanHieuXe);
  pick('Tình trạng xe', 'select_ttxe', v.tinhTrangXe);

  // changeNgayBH() ghi đè EndDate thành StartDate + ĐÚNG một năm. Đặt ngày bắt
  // đầu trước, rồi mới ghi ngày kết thúc — đảo lại là mất đơn nhiều năm.
  set('Ngày bắt đầu', 'StartDate', v.ngayBatDau);
  set('Ngày kết thúc', 'EndDate', v.ngayKetThuc);
  setGio('Giờ bắt đầu', 'StartTime', v.gioBatDau);
  setGio('Giờ kết thúc', 'EndTime', v.gioKetThuc);

  set('Biển kiểm soát', 'BienKiemSoat', v.bienSo);
  set('Số máy', 'SoMay', v.soMay);
  set('Số khung', 'SoKhung', v.soKhung);

  // Tick trước rồi mới điền hai ô dưới: changeLaiPhu() bỏ `display:none` của
  // khối `.thamgialaiphu`, mà ô đang ẩn thì điền vào cũng không ai thấy để kiểm.
  check('BH tai nạn lái phụ xe', 'ThamGia_LaiPhu');
  set('Mức trách nhiệm lái phụ', 'MucTrachNhiem_LaiPhu', v.mucTrachNhiemLaiPhu);
  set('Số người tối đa', 'SoNguoiToiDa', v.soNguoiToiDa);

  set('Tên chủ xe', 'NameCustomer', v.hoTen);
  set('Địa chỉ', 'AddressCustomer', v.diaChi);
  // Payload không truyền thì để trống, không ghi đè bằng chuỗi rỗng cho có.
  if (v.soDienThoai) set('Số điện thoại', 'DienThoai', v.soDienThoai);
  // Ô Email giữ nguyên giá trị trang điền sẵn (chốt 2026-08-23) — script không đụng.

  // Kenh rỗng lúc nạp trang, option đến từ POST /TNDSMotor/GetKenhKT.
  pick('Nhóm kênh bán hàng', 'NhomKenh', v.nhomKenh);
  if (dryRun) rec('Kênh bán hàng', 'DRY_RUN', `Kenh ← ${v.kenhBanHang}`);
  else if (!(await waitOptions('Kenh')))
    rec('Kênh bán hàng', 'AJAX KHÔNG TRẢ OPTION', 'Kenh rỗng sau 10 giây');
  else pick('Kênh bán hàng', 'Kenh', v.kenhBanHang);

  pick('Cán bộ khai thác', 'Select_Ma_CanBo_KT', v.canBoKhaiThac);
  set('Ngày thanh toán', 'NgayThanhToan', v.ngayThanhToan);
  pick('Mã tiền tệ', 'Select_MaTT', v.maTienTe);
  pick('Phương thức khai thác', 'Select_PTKThac', v.phuongThucKhaiThac);
  pick('Đại lý', 'DanhSach_DaiLy', v.daiLy);
  set('Mã khách hàng', 'MaKhach', v.maKhach);

  /**
   * Phí do PVI tính, không phải script điền.
   *
   * `TinhPhiBH()` là `$.ajax` bất đồng bộ, và nhiều ô tự gọi nó lúc `change`:
   * loại xe, ngày bắt đầu, ngày kết thúc, ô tick lái phụ. Lượt gọi lúc tick lái
   * phụ chạy khi mức trách nhiệm còn RỖNG nên trả về 0 — về sau lượt gọi cuối
   * thì nó ghi đè phí đúng bằng 0.
   *
   * Đo 2026-08-23: bỏ quãng chờ này thì `Tong_MTN_LaiPhu` ra 0 và tổng phí
   * thiếu đúng phần lái phụ. Chờ cho các lượt cũ về hết rồi mới gọi lần cuối.
   */
  if (!dryRun && typeof window.TinhPhiBH === 'function') {
    await new Promise((r) => setTimeout(r, 1500));
    window.TinhPhiBH();
  }
  await new Promise((r) => setTimeout(r, 2500));

  const doc = (id) => (el(id) ? el(id).value : null);
  return {
    log,
    canXem: log.filter((r) => /KHÔNG|GHI ĐÈ|KHÔNG ĐỔI/.test(r.status)),
    kiemChung: {
      bienSo: doc('BienKiemSoat'),
      loaiXe: doc('select_loaixe'),
      tinhTrangXe: doc('select_ttxe'),
      email: doc('EmailCustomer'),
      soDienThoai: doc('DienThoai'),
      ngayBatDau: doc('StartDate'),
      gioBatDau: doc('StartTime'),
      ngayKetThuc: doc('EndDate'),
      gioKetThuc: doc('EndTime'),
      ngayThanhToan: doc('NgayThanhToan'),
      mucTrachNhiemLaiPhu: doc('MucTrachNhiem_LaiPhu'),
      soNguoiToiDa: doc('SoNguoiToiDa'),
      tongMtnLaiPhu: doc('Tong_MTN_LaiPhu'),
      tyLeGpLaiPhu: doc('Ty_Le_GP_LaiPhu'),
      phiLaiPhuTruoc: doc('Phi_BH_LaiPhu_Truoc'),
      phiTndsBatBuoc: doc('Phi_BH_TNDS_BB'),
      phiLaiPhu: doc('Phi_BH_LaiPhu'),
      tongPhi: doc('Tong_Phi_BH'),
    },
  };
}

module.exports = {
  product: 'motorbike',
  ten: 'BH TNDS xe máy',
  urlForm: URL_FORM,
  selectorForm: SELECTOR_FORM,
  // Nút "Chấp nhận" của form xe máy CÓ `id`, khác form tai nạn điện.
  selectorLuu: '#btnConfirm',
  batBuoc: BAT_BUOC,
  fixed: FIXED,
  soNamToiDa: SO_NAM_TOI_DA,
  dungGiaTri,
  dien,
};
