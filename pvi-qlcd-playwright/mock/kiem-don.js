// Kiểm dữ liệu đơn mà form gửi lên — thứ duy nhất chứng minh bot điền "vào thật".
//
// Đọc giá trị ở phía NHẬN, không đọc DOM. Bot báo "ĐÃ ĐIỀN" nghĩa là nó ghi
// được vào ô; còn ô đó có đi theo form lên máy chủ hay không lại là chuyện khác
// — ô `disabled`, ô nằm ngoài thẻ `<form>`, hoặc ô bị trang ghi đè sau đó đều
// báo "ĐÃ ĐIỀN" mà máy chủ không nhận được gì.

const flow = require('../lib/flows/electric-accident');

/** Checkbox của ASP.NET MVC gửi kèm ô hidden `false`; tick thì chuỗi có `true`. */
const daTick = (v) => String(v ?? '').includes('true');

const NGAY = /^\d{2}\/\d{2}\/\d{4}$/;

/**
 * Ô nào có `name` KHÁC `id` thì tra bằng `name`.
 *
 * Bot thao tác theo `id`, còn form gửi lên theo `name` — mà trên form này 14 ô
 * lệch hai tên đó. Tra nhầm thì máy chủ báo "không nhận được" ở đúng những ô bot
 * đã điền xong, và người đọc đi sửa bot trong khi bot không sai.
 */
const NAME_THEO_ID = {
  kenh_bh: 'select_kenhbh',
  DanhSach_DaiLy: 'select_DaiLy',
  keycode_dv: 'KeyCode',
  dtbh_tanphe: 'dtbh_sinhhoat_nhole',
  dtbh_tamthan_ungthu: 'dtbh_tantat_thuongtat',
  idcapmoi: 'loai_dcap',
  idtaituc: 'loai_dcap_taituc',
};

/**
 * Luật kiểm, viết theo spec chứ không theo payload — máy chủ không biết BE gửi
 * gì, nó chỉ biết một đơn hợp lệ trông ra sao.
 */
function luatKiem(don) {
  const lay = (id) => don[NAME_THEO_ID[id] ?? id];
  const co = (id) => String(lay(id) ?? '').trim();
  const f = flow.fixed;

  return [
    ['Người mua bảo hiểm', 'khach_hang', co('khach_hang').length > 0, co('khach_hang')],
    ['Email', 'Email', co('Email') === f.email, co('Email')],
    ['Cán bộ khai thác', 'Select_Ma_CanBo_KT', co('Select_Ma_CanBo_KT') === f.canBoKhaiThac, co('Select_Ma_CanBo_KT')],
    ['Số thành viên', 'SoNguoi_HoKhau', Number(co('SoNguoi_HoKhau')) > 0, co('SoNguoi_HoKhau')],
    ['Địa chỉ', 'dia_chi', co('dia_chi').length > 0, co('dia_chi')],
    ['Ngành nghề kinh doanh', 'nnghe_kd', co('nnghe_kd') === f.nganhNghe, co('nnghe_kd')],
    ['Ngày cấp', 'ngay_capd', NGAY.test(co('ngay_capd')), co('ngay_capd')],
    ['Ngày bắt đầu', 'ngay_batdau', NGAY.test(co('ngay_batdau')), co('ngay_batdau')],
    ['Ngày kết thúc', 'thoihan_bh', NGAY.test(co('thoihan_bh')), co('thoihan_bh')],
    ['Ngày thanh toán', 'NgayThanhToan', NGAY.test(co('NgayThanhToan')), co('NgayThanhToan')],
    ['Phương thức thanh toán', 'select_PhuongThuc_ThanhToan', co('select_PhuongThuc_ThanhToan') === f.phuongThucThanhToan, co('select_PhuongThuc_ThanhToan')],
    ['Nhóm kênh bán hàng', 'select_nhomkenh', co('select_nhomkenh') === f.nhomKenh, co('select_nhomkenh')],
    ['Kênh bán hàng', 'kenh_bh', co('kenh_bh') === f.kenhBanHang, co('kenh_bh')],
    ['Phương thức khai thác', 'select_phuongthuc_kt', co('select_phuongthuc_kt') === f.phuongThucKhaiThac, co('select_phuongthuc_kt')],
    ['Đại lý', 'DanhSach_DaiLy', co('DanhSach_DaiLy') === f.daiLy, co('DanhSach_DaiLy')],
    ['Mã tiền tệ', 'Select_MaTT', co('Select_MaTT') === f.maTienTe, co('Select_MaTT')],
    ['Gom đơn', 'gom_don', daTick(lay('gom_don')), String(lay('gom_don') ?? '')],
    ['Ngoài các đối tượng trên', 'dtbh_khac', daTick(lay('dtbh_khac')), String(lay('dtbh_khac') ?? '')],
    ['Theo quy tắc hiện hành', 'pvbh_quytac_hienhanh', daTick(lay('pvbh_quytac_hienhanh')), String(lay('pvbh_quytac_hienhanh') ?? '')],
    ['Số tiền bảo hiểm', 'STBH__quytac_hienhanh', Number(co('STBH__quytac_hienhanh').replace(/\s/g, '')) > 0, co('STBH__quytac_hienhanh')],
    ['Điều khoản bổ sung 01', 'pvbh_dkbs_01', daTick(lay('pvbh_dkbs_01')), String(lay('pvbh_dkbs_01') ?? '')],
    ['Tỷ lệ phí', 'tyle_phi_quytac_hienhanh', co('tyle_phi_quytac_hienhanh') === f.tyLePhi, co('tyle_phi_quytac_hienhanh')],
    ['ĐMCPKD/ĐMTL hiện hành', 'dmcpkd_tl_qdinh_hienhanh', daTick(lay('dmcpkd_tl_qdinh_hienhanh')), String(lay('dmcpkd_tl_qdinh_hienhanh') ?? '')],
    ['Tổng phí (trang tự tính)', 'tong_phi', Number(co('tong_phi')) > 0, co('tong_phi')],
  ].map(([nhan, id, dat, nhan_duoc]) => ({ nhan, id, dat, nhanDuoc: nhan_duoc }));
}

function kiemDon(don) {
  const dong = luatKiem(don);
  const hong = dong.filter((d) => !d.dat);
  return { dat: hong.length === 0, tong: dong.length, soHong: hong.length, dong, hong };
}

/**
 * Trang kết quả — bot đọc `#ket-qua` để biết đạt hay không.
 *
 * `prKey` và `linkDuyet` mô phỏng chỗ PVI trả khoá của đơn vừa tạo. Chưa ai bấm
 * nút trên hệ thống thật nên đây là PHỎNG ĐOÁN; nó có mặt để thử được cách bot
 * đọc lại khoá, không phải để tin là PVI làm y như vậy.
 */
function trangKetQua(kq, { prKey, linkDuyet } = {}) {
  const hang = kq.dong
    .map(
      (d) =>
        `<tr class="${d.dat ? 'dat' : 'hong'}"><td>${d.dat ? 'ĐẠT' : 'HỎNG'}</td>` +
        `<td>${d.nhan}</td><td><code>${d.id}</code></td><td>${d.nhanDuoc || '<em>rỗng</em>'}</td></tr>`,
    )
    .join('');

  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">
<title>Kết quả nhận đơn — BẢN GIẢ LẬP</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;padding:20px 28px}
table{border-collapse:collapse;width:100%;max-width:1000px}
td,th{border:1px solid #ccc;padding:5px 9px;font-size:13px;text-align:left}
.dat td:first-child{color:#0a7d28;font-weight:bold}
.hong td:first-child{color:#c00;font-weight:bold}
.tong{font-size:17px;font-weight:bold;padding:10px 14px;margin-bottom:14px;
      background:${kq.dat ? '#dff5e1' : '#ffe0e0'};border:1px solid ${kq.dat ? '#0a7d28' : '#c00'}}
</style></head><body>
<div id="ket-qua" data-dat="${kq.dat ? '1' : '0'}" data-so-hong="${kq.soHong}" class="tong">
${kq.dat ? `Máy chủ nhận đủ và đúng ${kq.tong}/${kq.tong} trường.` : `${kq.soHong}/${kq.tong} trường KHÔNG đạt.`}
</div>
${
  prKey
    ? `<p id="pr-key-don" data-pr-key="${prKey}">Khoá đơn vừa tạo:
<code>${prKey}</code> — <a id="link-duyet" href="${linkDuyet}">Sang bước duyệt</a></p>`
    : ''
}
<table><tr><th>Kết quả</th><th>Trường</th><th>id</th><th>Máy chủ nhận được</th></tr>${hang}</table>
</body></html>`;
}

module.exports = { kiemDon, trangKetQua };
