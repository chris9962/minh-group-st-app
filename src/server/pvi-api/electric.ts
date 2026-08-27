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
import { pviDateFromIso } from "@/lib/pvi";
import { PVI_CERTIFICATE_EMAIL } from "./constants";
import { pviPeriod } from "./period";

/**
 * Mục 11 · `TaoDon_HSDD_CP` — tạo đơn bảo hiểm Tai nạn hộ sử dụng điện.
 *
 * ⚠️ PVI KHÔNG có API tính phí cho sản phẩm này (tài liệu chỉ có mục tạo đơn).
 * Bên mình tự tính `tongPhi` rồi truyền sang, và PVI cấp đơn theo con số đó.
 * Sai một con số 0 là hợp đồng lệch mười lần — nơi gọi phải lấy phí từ đơn đã
 * duyệt, không tính lại tại chỗ.
 */

const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Giờ hiệu lực đặt sau lúc gọi 10 phút — cùng số bot Playwright dùng. */
const MINUTES_AHEAD = 10;

/** Ngành nghề kinh doanh — cố định cho mọi đơn (chốt 2026-08-15). */
export const PVI_ELECTRIC_TRADE = "TỰ DO";

/**
 * Tỷ lệ phí tham gia, đơn vị phần trăm.
 *
 * Form web tự ghi `0.26` khi tick điều khoản bổ sung 01; bot ghi đè xuống
 * `0.25`, và đơn đã cấp thật `26/21/14/TNCN/0099106` ghi `0.25`.
 */
export const PVI_ELECTRIC_FEE_RATE = 0.25;

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

  /** Người thụ hưởng — cột `beneficiary_name`. */
  khachHang: z.string().trim().min(1),
  cmtKhachHang: z.string().trim().default(""),
  /**
   * Ngày sinh người thụ hưởng, `YYYY-MM-DD` — cột `beneficiary_dob`.
   *
   * Form của mình bắt buộc ô này với đơn tai nạn hộ sử dụng điện. Cần để dựng
   * `list_nguoithamgia`: `ngay_sinh` là một trong bảy trường của mỗi người.
   */
  ngaySinh: z.string().trim().regex(ISO_DATE, "Phải theo dạng YYYY-MM-DD"),
  diaChi: z.string().trim().min(1),
  email: z.string().trim().email().default(PVI_CERTIFICATE_EMAIL),
  soDienThoai: z.string().trim().default(""),
  nngheKd: z.string().trim().default(PVI_ELECTRIC_TRADE),

  /**
   * Hai cột `date` của đơn, dạng `YYYY-MM-DD`. Module tự ghép giờ và tách thành
   * bốn field PVI nhận — xem `pviPeriod`.
   *
   * Khác xe máy: mục 11 tách NGÀY và GIỜ thành hai field riêng, không gộp một
   * chuỗi.
   */
  ngayBatDau: z.string().trim().regex(ISO_DATE, "Phải theo dạng YYYY-MM-DD"),
  ngayKetThuc: z.string().trim().regex(ISO_DATE, "Phải theo dạng YYYY-MM-DD"),

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
  /** Tỷ lệ phí — xem `PVI_ELECTRIC_FEE_RATE`. */
  phiTyLePhi: z.number().nonnegative().default(PVI_ELECTRIC_FEE_RATE),

  /** Số thành viên trong hộ khẩu — khớp `insurance_orders.household_size`. */
  soNguoiHoKhau: z.number().int().nonnegative(),
  /**
   * Người sống cùng chủ hộ nhưng không có trong hộ khẩu — LUÔN LÀ 0.
   *
   * Form web có ba ô đếm người, API chỉ có hai. Chú thích của PVI khớp ô "không
   * đăng ký thường trú", còn tên trường `Thue` khớp ô "tạm trú hoặc thuê trọ".
   * Không cần phân biệt: cả hai ô đều là 0 ở mọi đơn, đơn đã cấp thật
   * `26/21/14/TNCN/0099106` cũng vậy. Bên mình chỉ bán cho hộ gia đình.
   */
  soNguoiThue: z.number().int().nonnegative().default(0),

  /**
   * Người tham gia bảo hiểm. Để TRỐNG thì module tự dựng đúng MỘT người —
   * người thụ hưởng của đơn. Xem `nguoiThuHuongThamGia`.
   *
   * Bên mình chỉ lưu `household_size` là một con số, không có bảng thành viên
   * hộ, nên không dựng được người thứ hai. Truyền mảng đầy đủ vào đây khi nào
   * có bảng đó.
   */
  nguoiThamGia: z.array(ElectricParticipant).default([]),
});
export type ElectricOrderInput = z.infer<typeof ElectricOrderInput>;

/**
 * Người tham gia duy nhất — NGƯỜI THỤ HƯỞNG của đơn, dựng từ năm cột
 * `beneficiary_*`.
 *
 * Form web PVI ghi ngay dưới nút Tải file mẫu: "không cần nhập thông tin những
 * người có tên trong đăng ký thường trú", và đơn đã cấp thật
 * `26/21/14/TNCN/0099106` để trống danh sách. Nhưng request mẫu mục 11 gửi đủ
 * người, nên gửi ít nhất người thụ hưởng là cách khớp được cả hai nguồn.
 *
 * `nhom_khach` là QUAN HỆ VỚI CHỦ HỘ theo cách gọi của PVI, không phải tên
 * người. Đơn tai nạn hộ sử dụng điện đứng tên người thụ hưởng, nên quan hệ đó
 * là `Chủ hộ`. `loai: 1` = cùng hộ khẩu.
 */
function nguoiThuHuongThamGia(input: ElectricOrderInput): ElectricParticipant {
  return {
    tenKhach: input.khachHang,
    soCmnd: input.cmtKhachHang,
    diaChi: input.diaChi,
    ngaySinh: pviDateFromIso(input.ngaySinh),
    dienThoai: input.soDienThoai,
    nhomKhach: "Chủ hộ",
    loai: 1,
  };
}

export function buildElectricPayload(
  input: ElectricOrderInput,
  now?: Date,
): Record<string, unknown> {
  const config = readPviApiConfig();
  if (!config) {
    throw new PviApiError({
      kind: "config",
      endpoint: "TaoDon_HSDD_CP",
      message: "Chưa cấu hình PVI_API_BASE_URL / PVI_API_CPID / PVI_API_KEY trong .env.local",
    });
  }

  const period = pviPeriod({
    startDate: input.ngayBatDau,
    endDate: input.ngayKetThuc,
    minutesAhead: MINUTES_AHEAD,
    now,
  });
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
    period.startDate,
    period.endDate,
    maGiaoDich,
    email,
    pviNumber(input.soTienBh),
    tongPhi,
  ]);

  return {
    CpId: config.cpId,
    Sign: sign,
    ma_giaodich: maGiaoDich,
    list_nguoithamgia: (input.nguoiThamGia.length ? input.nguoiThamGia : [nguoiThuHuongThamGia(input)]).map((p) => ({
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
    thoihan_bh: period.endDate,
    endtime: period.endTime,
    phi_tyle_phi: input.phiTyLePhi,
    tong_phi: tongPhi,
    email,
    ngay_batdau: period.startDate,
    starttime: period.startTime,
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
  now?: Date,
): Promise<PviOrderResult> {
  const parsed = ElectricOrderInput.parse(input);
  return pviPost("TaoDon_HSDD_CP", buildElectricPayload(parsed, now));
}
