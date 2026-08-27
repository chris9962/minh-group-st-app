import { z } from "zod";
import { readPviApiConfig } from "./config";
import { PviApiError, pviPost, pviSign, pviText, type PviOrderResult } from "./client";
import { PVI_CERTIFICATE_EMAIL } from "./constants";
import { asDateTime, pviPeriod } from "./period";

/**
 * Mục 10 · `TaoDon_XeMay` — tạo đơn TNDS bắt buộc xe máy.
 *
 * Tên trường ở đây là camelCase tiếng Việt như `src/lib/pvi.ts`; tên PVI nhận
 * nằm ở `buildMotorbikePayload` bên dưới, mỗi dòng một cặp. Giữ hai lớp vì tên
 * PVI trộn snake_case (`ma_giaodich`) với PascalCase (`CpId`) — bắt cả app phải
 * viết theo là mang cái lộn xộn đó đi khắp nơi.
 *
 * Trạng thái bắt buộc của từng trường theo bảng lồng trong ô `Required?` của
 * tài liệu — xem `docs/pvi-field-tao-don-xe-may.md`.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_OR_EMPTY = /^(\d{4})?$/;

/** Giờ hiệu lực đặt sau lúc gọi 20 phút — cùng số bot Playwright dùng. */
const MINUTES_AHEAD = 20;

/**
 * Mã nhãn hiệu xe — một giá trị cho mọi đơn, danh mục `HIEUXEMOTOR` của PVI.
 *
 * `270` là XE MAY KHAC, mã gộp mọi hiệu xe. PVI đánh trường này KHÔNG bắt buộc,
 * nhưng bot Playwright đặt mã này cho mọi đơn từ 2026-08-23 và đơn
 * `26/21/14/MOTO/0109539` ghi đúng nó. Hệ quả: giấy chứng nhận của mọi đơn đều
 * ghi hiệu xe là XE MAY KHAC.
 */
export const PVI_VEHICLE_BRAND = "270";

/**
 * Bảo hiểm bồi thường cho người ngồi trên xe — mức trách nhiệm mỗi người và số
 * người tham gia.
 *
 * Hai số của bot Playwright, đơn `26/21/14/MOTO/0109539` ghi đúng: mức
 * 5.000.000 một người, 2 người, tổng mức trách nhiệm 10.000.000, phí 20.000đ.
 */
/**
 * `ma_user` trong công thức ký của mục 10 — CHUỖI RỖNG.
 *
 * Tài liệu không định nghĩa trường này ở mục 10; nó chỉ được khai ở mục 3
 * `Get_DanhMuc`, kèm chú thích `//để trống empty`, và request mẫu của mục đó
 * cũng gửi `""`. Giữ nó trong công thức để code đọc khớp tài liệu.
 *
 * `ServiceMotoContent` không khai `ma_user` nên nó KHÔNG nằm trong payload,
 * chỉ nối vào chuỗi băm.
 */
export const PVI_MA_USER = "";

export const PVI_LIABILITY_PER_PERSON = 5_000_000;
export const PVI_PASSENGERS_COVERED = 2;

/**
 * Khối hoá đơn điện tử — chỉ gửi khi khách yêu cầu xuất hoá đơn.
 *
 * Tài liệu ghi "KH có yêu cầu xuất hóa đơn thì truyền về ko thì thôi", nên
 * không có thì bỏ hẳn năm trường khỏi payload thay vì gửi chuỗi rỗng.
 */
export const MotorbikeInvoice = z.object({
  maSoThue: z.string().trim().min(1),
  noiDung: z.string().trim().min(1),
  nguoiMuaHang: z.string().trim().min(1),
  diaChi: z.string().trim().min(1),
});
export type MotorbikeInvoice = z.infer<typeof MotorbikeInvoice>;

/** Mọi ô chữ `.trim()` NGAY TRONG schema: một dấu cách thừa ở cuối ra một MD5 khác (xem `pviText`). */
export const MotorbikeOrderInput = z.object({
  /**
   * Mã giao dịch, cũng chính là `RequestId` PVI trả lại ở callback mục 13 và
   * nhận ở mục 14 `GetPolicyNumber`.
   *
   * Truyền thẳng `insurance_orders.order_code` — cột đó duy nhất, không đổi,
   * không tái sử dụng. PVI đòi duy nhất trong phạm vi một `CpId`, và môi trường
   * test chạy trên host riêng nên không phải thêm tiền tố.
   */
  maGiaoDich: z.string().trim().min(1).max(50),

  /**
   * Hai ô người mua bảo hiểm — PVI đánh KHÔNG bắt buộc, và form web
   * `/TNDSMotor/Motor` không có ô nào cho chúng. Mặc định để rỗng.
   *
   * Chủ xe trên cà vẹt mới là hai ô bắt buộc: `tenChuXe` và `diaChi`.
   */
  tenNguoiMuaBh: z.string().trim().default(""),
  diaChiNguoiMuaBh: z.string().trim().default(""),

  /**
   * Hai cột `date` của đơn, dạng `YYYY-MM-DD`. Module tự ghép giờ và đổi sang
   * `dd/MM/yyyy HH:mm` mà PVI nhận — xem `pviPeriod`.
   */
  ngayBatDau: z.string().trim().regex(ISO_DATE, "Phải theo dạng YYYY-MM-DD"),
  ngayKetThuc: z.string().trim().regex(ISO_DATE, "Phải theo dạng YYYY-MM-DD"),

  bienKiemSoat: z.string().trim().min(1),
  /**
   * PVI đánh hai ô này BẮT BUỘC, nhưng khách hay không đọc được số trên xe nên
   * form của mình để trống được. Gửi nguyên văn thứ đơn đang có, rỗng thì gửi
   * rỗng — KHÔNG `.trim()` và không thay bằng ký tự giữ chỗ.
   *
   * Bot Playwright điền một dấu cách vì form web chặn ô rỗng lúc bấm Chấp nhận.
   * Đường API chưa biết có chặn không, và nhét dấu cách vào hợp đồng là ghi một
   * số máy không tồn tại. Để PVI từ chối và người vận hành đi hỏi lại khách còn
   * hơn.
   */
  soMay: z.string().default(""),
  soKhung: z.string().default(""),

  /** Mã danh mục `LOAIXEMOTOR` của PVI, ví dụ `1002`. Xem `VEHICLE_TYPES`. */
  loaiXe: z.string().trim().min(1),
  /** Mã danh mục `HIEUXEMOTOR`. PVI đánh không bắt buộc; xem `PVI_VEHICLE_BRAND`. */
  nhanHieu: z.string().trim().default(PVI_VEHICLE_BRAND),
  /**
   * Năm sản xuất — PVI đánh KHÔNG bắt buộc và ghi "nếu không có thì truyền
   * rỗng". Bên mình chưa có cột nào chứa nó, nên mặc định rỗng.
   */
  namSanXuat: z.string().trim().regex(YEAR_OR_EMPTY, "Phải là 4 chữ số năm hoặc để rỗng").default(""),

  tenChuXe: z.string().trim().min(1),
  /** Địa chỉ chủ xe trên cà vẹt — KHÁC `diaChiNguoiMuaBh` khi mua hộ. */
  diaChi: z.string().trim().min(1),
  email: z.string().trim().email().default(PVI_CERTIFICATE_EMAIL),
  /** PVI đánh KHÔNG bắt buộc, dù form của mình bắt buộc. */
  soDienThoai: z.string().trim().default(""),

  /**
   * Bảo hiểm bồi thường cho người ngồi trên xe — BÁN KÈM MỌI ĐƠN.
   *
   * `TaoDon_XeMay` không có ô phí nào, PVI tự tính từ loại xe, thời hạn và ba
   * trường này. Gửi `false` là PVI cấp đơn thiếu phần lái phụ: đơn
   * `26/21/14/MOTO/0109539` ra 132.000đ thay vì 152.000đ, trong khi app đã thu
   * của khách theo `fee` đủ cả hai phần.
   */
  thamGiaLaiPhu: z.boolean().default(true),
  mucTrachNhiemLaiPhu: z.number().int().nonnegative().default(PVI_LIABILITY_PER_PERSON),
  /** Tài liệu PVI cũng ghi mặc định 2. */
  soNguoiTgiaLaiPhu: z.number().int().nonnegative().default(PVI_PASSENGERS_COVERED),

  /** Ẩn biển kiểm soát trên giấy chứng nhận. */
  anBienKs: z.boolean().default(false),

  hoaDon: MotorbikeInvoice.optional(),
});
export type MotorbikeOrderInput = z.infer<typeof MotorbikeOrderInput>;

/**
 * Dựng payload đúng tên trường PVI.
 *
 * Tách khỏi `createMotorbikeOrder` để test được chữ ký mà không gọi mạng, và
 * để đọc đối chiếu với tài liệu bằng mắt.
 */
export function buildMotorbikePayload(
  input: MotorbikeOrderInput,
  now?: Date,
): Record<string, unknown> {
  const config = readPviApiConfig();
  if (!config) {
    throw new PviApiError({
      kind: "config",
      endpoint: "TaoDon_XeMay",
      message: "Chưa cấu hình PVI_API_BASE_URL / PVI_API_CPID / PVI_API_KEY trong .env.local",
    });
  }

  const bienKiemSoat = pviText(input.bienKiemSoat);
  const email = pviText(input.email);
  const soDienThoai = pviText(input.soDienThoai);
  const nhanHieu = pviText(input.nhanHieu);
  const loaiXe = pviText(input.loaiXe);
  const namSanXuat = pviText(input.namSanXuat);

  const period = pviPeriod({
    startDate: input.ngayBatDau,
    endDate: input.ngayKetThuc,
    minutesAhead: MINUTES_AHEAD,
    now,
  });

  /**
   * Thứ tự lấy nguyên văn ô `Tham số` của mục 10:
   * `MD5(Key + bien_kiemsoat + email + ma_user + so_dienthoai + nhan_hieu + loai_xe + nam_sanxuat)`
   *
   * Bảng bắt buộc trong ô `Required?` của cùng mục 10 ghi công thức thiếu
   * `ma_user`. Hai chỗ khác nhau, nhưng `PVI_MA_USER` là chuỗi rỗng nên cả hai
   * cho ra CÙNG một chuỗi băm.
   */
  const sign = pviSign(config, [
    bienKiemSoat,
    email,
    PVI_MA_USER,
    soDienThoai,
    nhanHieu,
    loaiXe,
    namSanXuat,
  ]);

  const payload: Record<string, unknown> = {
    CpId: config.cpId,
    Sign: sign,
    ma_giaodich: pviText(input.maGiaoDich),
    ten_nguoimua_bh: pviText(input.tenNguoiMuaBh),
    diachi_nguoimua_bh: pviText(input.diaChiNguoiMuaBh),
    ngay_dau: asDateTime(period.startDate, period.startTime),
    ngay_cuoi: asDateTime(period.endDate, period.endTime),
    bien_kiemsoat: bienKiemSoat,
    so_may: input.soMay,
    so_khung: input.soKhung,
    loai_xe: loaiXe,
    nhan_hieu: nhanHieu,
    nam_sanxuat: namSanXuat,
    ten_chuxe: pviText(input.tenChuXe),
    email,
    so_dienthoai: soDienThoai,
    dia_chi: pviText(input.diaChi),
    thamgia_laiphu: input.thamGiaLaiPhu,
    muc_trachnhiem_laiphu: input.mucTrachNhiemLaiPhu,
    so_nguoi_tgia_laiphu: input.soNguoiTgiaLaiPhu,
    an_bien_ks: input.anBienKs,
  };

  if (input.hoaDon) {
    payload.is_hdon_dt = true;
    payload.ma_sovat = pviText(input.hoaDon.maSoThue);
    payload.ttin_hd_dientu = pviText(input.hoaDon.noiDung);
    payload.nmua_hang = pviText(input.hoaDon.nguoiMuaHang);
    payload.dchi_xhoadon = pviText(input.hoaDon.diaChi);
  }

  return payload;
}

/** Gọi `TaoDon_XeMay`. Ném `PviApiError` khi PVI từ chối; không tự gọi lại. */
export async function createMotorbikeOrder(
  input: MotorbikeOrderInput,
  now?: Date,
): Promise<PviOrderResult> {
  const parsed = MotorbikeOrderInput.parse(input);
  return pviPost("TaoDon_XeMay", buildMotorbikePayload(parsed, now));
}
