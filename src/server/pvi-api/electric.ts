import { z } from "zod";
import { readPviApiConfig } from "./config";
import {
  PviApiError,
  pviNumber,
  pviPost,
  pviSign,
  pviText,
  type PviOrderResult,
} from "./client";

/**
 * Mục 11 · `TaoDon_HSDD_CP` — tạo đơn bảo hiểm Tai nạn hộ sử dụng điện.
 *
 * ⚠️ PVI KHÔNG có API tính phí cho sản phẩm này (tài liệu chỉ có mục tạo đơn).
 * Bên mình tự tính `tongPhi` rồi truyền sang, và PVI cấp đơn theo con số đó.
 * Sai một con số 0 là hợp đồng lệch mười lần — nơi gọi phải lấy phí từ đơn đã
 * duyệt, không tính lại tại chỗ.
 */

const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const TIME = /^\d{2}:\d{2}$/;

export const ElectricParticipant = z.object({
  tenKhach: z.string().trim().min(1),
  /** CMND/CCCD — request mẫu của PVI để rỗng, nên không bắt buộc. */
  soCmnd: z.string().trim().default(""),
  diaChi: z.string().trim().min(1),
  ngaySinh: z.string().trim().regex(DATE, "Phải theo dạng dd/MM/yyyy"),
  dienThoai: z.string().trim().default(""),
  /** Quan hệ với chủ hộ, PVI nhận chữ tự do: `Chủ hộ`, `Em`, `Chị`… */
  nhomKhach: z.string().trim().min(1),
  /**
   * `1` = cùng hộ khẩu, `0` = không cùng hộ khẩu.
   *
   * Tài liệu PVI chú thích cả hai giá trị đều là "cùng hộ khẩu" — lỗi gõ. Suy
   * ra từ cặp `SoNguoi_HoKhau` / `SoNguoi_Thue`, nhưng CHƯA hỏi PVI xác nhận.
   */
  loai: z.union([z.literal(0), z.literal(1)]),
});
export type ElectricParticipant = z.infer<typeof ElectricParticipant>;

/** Mọi ô chữ `.trim()` NGAY TRONG schema: một dấu cách thừa ở cuối ra một MD5 khác (xem `pviText`). */
export const ElectricOrderInput = z.object({
  /** Duy nhất trên hệ thống PVI — xem ghi chú ở `MotorbikeOrderInput`. */
  maGiaoDich: z.string().trim().min(1).max(50),

  /** Chủ hộ đứng tên đơn. */
  khachHang: z.string().trim().min(1),
  cmtKhachHang: z.string().trim().default(""),
  diaChi: z.string().trim().min(1),
  email: z.string().trim().email(),
  soDienThoai: z.string().trim().default(""),
  /** Tài liệu ghi không bắt buộc; luồng của mình cố định `TỰ DO` (chốt 2026-08-15). */
  nngheKd: z.string().trim().default(""),

  /** `dd/MM/yyyy` + `HH:mm` tách riêng — khác hẳn sản phẩm xe máy gộp một trường. */
  ngayBatDau: z.string().trim().regex(DATE, "Phải theo dạng dd/MM/yyyy"),
  startTime: z.string().trim().regex(TIME, "Phải theo dạng HH:mm").default("00:00"),
  /** Ngày KẾT THÚC bảo hiểm, tên trường PVI là `thoihan_bh`. */
  thoiHanBh: z.string().trim().regex(DATE, "Phải theo dạng dd/MM/yyyy"),
  endTime: z.string().trim().regex(TIME, "Phải theo dạng HH:mm").default("23:59"),

  /**
   * Mức CHI TRẢ, không phải phí khách trả. Hai bậc PVI bán: 40tr và 80tr
   * (`SUM_INSURED_OPTIONS` trong `src/lib/pvi.ts`).
   *
   * Bắt số nguyên vì giá trị này đi vào chữ ký qua `.ToString()`. Số lẻ thì
   * C# và JavaScript có thể dựng ra hai chuỗi khác nhau, và PVI trả `-105` mà
   * không nói vì sao.
   */
  soTienBh: z.number().int().positive(),
  /** Tổng phí đồng, cũng đi vào chữ ký nên cũng phải nguyên. */
  tongPhi: z.number().int().nonnegative(),
  /** Tỷ lệ phí, tài liệu ghi không bắt buộc. `0` = không gửi tỷ lệ. */
  phiTyLePhi: z.number().nonnegative().default(0),

  /** Số thành viên trong hộ khẩu — khớp `insurance_orders.household_size`. */
  soNguoiHoKhau: z.number().int().nonnegative(),
  /** Người sống cùng chủ hộ nhưng không có trong hộ khẩu. */
  soNguoiThue: z.number().int().nonnegative().default(0),

  nguoiThamGia: z.array(ElectricParticipant).min(1),
});
export type ElectricOrderInput = z.infer<typeof ElectricOrderInput>;

export function buildElectricPayload(input: ElectricOrderInput): Record<string, unknown> {
  const config = readPviApiConfig();
  if (!config) {
    throw new PviApiError({
      kind: "config",
      endpoint: "TaoDon_HSDD_CP",
      message: "Chưa cấu hình PVI_API_BASE_URL / PVI_API_CPID / PVI_API_KEY trong .env.local",
    });
  }

  const ngayBatDau = pviText(input.ngayBatDau);
  const thoiHanBh = pviText(input.thoiHanBh);
  const maGiaoDich = pviText(input.maGiaoDich);
  const email = pviText(input.email);
  const tongPhi = pviNumber(input.tongPhi);

  /**
   * Công thức tài liệu ghi:
   * `MD5(Key + ngay_batdau + thoihan_bh + ma_gdich_doitac + Email + sotien_bh.ToString() + tong_phi.ToString())`
   *
   * ⚠️ `ma_gdich_doitac` và `Email` KHÔNG có trong class `ElectricalContent` —
   * class khai `ma_giaodich` và `email`. Hai tên, một giá trị: đây là tài liệu
   * chép lại từ sản phẩm khác mà quên đổi tên. Ký bằng giá trị của
   * `ma_giaodich` / `email` vì đó là thứ thật sự gửi đi. Nếu PVI trả `-105` ở
   * mọi đơn thì đây là chỗ đầu tiên phải hỏi lại.
   *
   * `tong_phi` gửi đi dạng CHUỖI (class khai `string`) nên ký bằng đúng chuỗi
   * đó — ký một đằng gửi một nẻo là sai chữ ký.
   */
  const sign = pviSign(config, [
    ngayBatDau,
    thoiHanBh,
    maGiaoDich,
    email,
    pviNumber(input.soTienBh),
    tongPhi,
  ]);

  return {
    CpId: config.cpId,
    Sign: sign,
    ma_giaodich: maGiaoDich,
    list_nguoithamgia: input.nguoiThamGia.map((p) => ({
      ten_khach: pviText(p.tenKhach),
      so_cmnd: pviText(p.soCmnd),
      dia_chi: pviText(p.diaChi),
      ngay_sinh: pviText(p.ngaySinh),
      dien_thoai: pviText(p.dienThoai),
      nhom_khach: pviText(p.nhomKhach),
      loai: p.loai,
    })),
    khach_hang: pviText(input.khachHang),
    cmt_khachhang: pviText(input.cmtKhachHang),
    sotien_bh: input.soTienBh,
    thoihan_bh: thoiHanBh,
    endtime: pviText(input.endTime),
    phi_tyle_phi: input.phiTyLePhi,
    tong_phi: tongPhi,
    email,
    ngay_batdau: ngayBatDau,
    starttime: pviText(input.startTime),
    dia_chi: pviText(input.diaChi),
    nnghe_kd: pviText(input.nngheKd),
    so_dienthoai: pviText(input.soDienThoai),
    SoNguoi_HoKhau: input.soNguoiHoKhau,
    SoNguoi_Thue: input.soNguoiThue,
  };
}

/** Gọi `TaoDon_HSDD_CP`. Ném `PviApiError` khi PVI từ chối; không tự gọi lại. */
export async function createElectricAccidentOrder(
  input: ElectricOrderInput,
): Promise<PviOrderResult> {
  const parsed = ElectricOrderInput.parse(input);
  return pviPost("TaoDon_HSDD_CP", buildElectricPayload(parsed));
}
