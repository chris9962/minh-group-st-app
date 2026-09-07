/**
 * Gửi cố ý payload hỏng lên `piastest` để xem PVI trả mã gì cho ca nào.
 *
 * Tài liệu chỉ ghi một dòng cho `-400` và `-404`, không có ví dụ, và bốn ngày
 * gọi thật (2026-09-03 tới 2026-09-06) chưa gặp mã nào trong hai mã đó.
 *
 * Mỗi ca một `ma_giaodich` riêng, không đọc không ghi database. Ca đã đo ghi
 * kết quả vào `measured`, và mặc định KHÔNG gửi lại: mỗi ca PVI chấp nhận là
 * một đơn thật trên máy chủ test. `--all` gửi lại toàn bộ.
 *
 * ⚠️ Chỉ chạy với `PVI_API_BASE_URL` trỏ về `piastest` hoặc proxy trỏ về đó.
 *
 * Chạy: bun scripts/pvi-api-probe-errors.ts [--all]
 */

import { PviApiError, pviRequest, pviSign } from "@/server/pvi-api/client";
import { readPviApiConfig } from "@/server/pvi-api/config";
import { MotorbikeOrderInput, PVI_MA_USER, buildMotorbikePayload } from "@/server/pvi-api/motorbike";
import { ElectricOrderInput, buildElectricPayload } from "@/server/pvi-api/electric";

const config = readPviApiConfig();
if (!config) throw new Error("Thiếu PVI_API_BASE_URL / PVI_API_CPID / PVI_API_KEY");

const RUN_ALL = process.argv.includes("--all");

const STAMP = new Date().toISOString().replace(/\D/g, "").slice(2, 14);

/** Ngày mai theo UTC luôn lớn hơn hoặc bằng hôm nay theo giờ Việt Nam, tránh `-505`/`-401`. */
const NGAY_BAT_DAU = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const NGAY_KET_THUC = `${Number(NGAY_BAT_DAU.slice(0, 4)) + 1}${NGAY_BAT_DAU.slice(4)}`;

type Payload = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));

let seq = 0;
const nextCode = () => `MGST-PROBE-${STAMP}-${String(++seq).padStart(2, "0")}`;

function motorbike(): Payload {
  return buildMotorbikePayload(
    MotorbikeOrderInput.parse({
      maGiaoDich: nextCode(),
      tenChuXe: "NGUYEN VAN PROBE",
      diaChi: "Ấp 1, Xã An Xuyên, Cà Mau",
      soDienThoai: "0901110000",
      bienKiemSoat: "69B1-99999",
      loaiXe: "1002",
      ngayBatDau: NGAY_BAT_DAU,
      ngayKetThuc: NGAY_KET_THUC,
    }),
  );
}

function electric(): Payload {
  return buildElectricPayload(
    ElectricOrderInput.parse({
      maGiaoDich: nextCode(),
      khachHang: "NGUYEN VAN PROBE",
      ngaySinh: "1990-05-15",
      diaChi: "Ấp 1, Xã An Xuyên, Cà Mau",
      soDienThoai: "0901110000",
      ngayBatDau: NGAY_BAT_DAU,
      ngayKetThuc: NGAY_KET_THUC,
      soTienBh: 20_000_000,
      tongPhi: 50_000,
      soNguoiHoKhau: 4,
    }),
  );
}

/**
 * Ký lại SAU khi sửa payload, để chữ ký luôn khớp thứ gửi đi. Không ký lại thì
 * mọi ca sửa trường có trong công thức đều ra `-105`, không đo được gì.
 */
function resignMotorbike(p: Payload): Payload {
  p.Sign = pviSign(config!, [
    str(p.bien_kiemsoat),
    str(p.email),
    PVI_MA_USER,
    str(p.so_dienthoai),
    str(p.nhan_hieu),
    str(p.loai_xe),
    str(p.nam_sanxuat),
  ]);
  return p;
}

function resignElectric(p: Payload): Payload {
  p.Sign = pviSign(config!, [
    str(p.ngay_batdau),
    str(p.thoihan_bh),
    str(p.ma_giaodich),
    str(p.email),
    str(p.sotien_bh),
    str(p.tong_phi),
  ]);
  return p;
}

type Case = { label: string; endpoint: string; build: () => Payload; measured?: string };

const xm = (label: string, mutate: (p: Payload) => void, measured?: string): Case => ({
  label,
  endpoint: "TaoDon_XeMay",
  measured,
  build: () => {
    const p = motorbike();
    mutate(p);
    return resignMotorbike(p);
  },
});

const dien = (label: string, mutate: (p: Payload) => void, measured?: string): Case => ({
  label,
  endpoint: "TaoDon_HSDD_CP",
  measured,
  build: () => {
    const p = electric();
    mutate(p);
    return resignElectric(p);
  },
});

const ACCEPTED = "CHẤP NHẬN, thành đơn thật";

const CASES: Case[] = [
  // ── Lượt đo 2026-09-07, xe máy ──
  xm("xe máy · dia_chi rỗng", (p) => { p.dia_chi = ""; }, ACCEPTED),
  xm("xe máy · ten_chuxe rỗng", (p) => { p.ten_chuxe = ""; }, ACCEPTED),
  xm("xe máy · bien_kiemsoat rỗng", (p) => { p.bien_kiemsoat = ""; }, ACCEPTED),
  xm("xe máy · thiếu hẳn trường bien_kiemsoat", (p) => { delete p.bien_kiemsoat; }, ACCEPTED),
  xm("xe máy · thiếu hẳn trường ngay_cuoi", (p) => { delete p.ngay_cuoi; }, "-506 Ngày bắt đầu phải nhỏ hơn ngày kết thúc"),
  xm("xe máy · ngay_dau dạng ISO 2026-09-08 10:00", (p) => { p.ngay_dau = `${NGAY_BAT_DAU} 10:00`; }, "-505 Ngày bắt đầu phải lớn hơn hoặc bằng ngày hiện tại"),
  xm("xe máy · ngay_cuoi trước ngay_dau", (p) => { const a = p.ngay_dau; p.ngay_dau = p.ngay_cuoi; p.ngay_cuoi = a; }, "-506"),
  xm("xe máy · loai_xe = 9999 không có trong danh mục", (p) => { p.loai_xe = "9999"; }, ACCEPTED),
  xm("xe máy · loai_xe rỗng", (p) => { p.loai_xe = ""; }, ACCEPTED),
  xm("xe máy · so_dienthoai có chữ 09abc", (p) => { p.so_dienthoai = "09abc"; }, ACCEPTED),
  xm("xe máy · email sai dạng", (p) => { p.email = "khong-phai-email"; }, "-955 Email khong hop le"),
  xm("xe máy · thamgia_laiphu = chuỗi \"true\"", (p) => { p.thamgia_laiphu = "true"; }, ACCEPTED),
  xm("xe máy · muc_trachnhiem_laiphu = chuỗi \"5.000.000\"", (p) => { p.muc_trachnhiem_laiphu = "5.000.000"; }, "-1 JsonSerializationException Int64"),
  xm("xe máy · ma_giaodich rỗng", (p) => { p.ma_giaodich = ""; }, "-503 ma giao dich khong duoc empty"),
  // ── Lượt đo 2026-09-07, điện ──
  dien("điện · list_nguoithamgia = []", (p) => { p.list_nguoithamgia = []; }, "-309 Không tồn tại danh sách người tham gia"),
  dien("điện · thiếu hẳn trường list_nguoithamgia", (p) => { delete p.list_nguoithamgia; }, "-309"),
  dien("điện · dia_chi rỗng", (p) => { p.dia_chi = ""; }, ACCEPTED),

  // ── Lượt đo 2026-09-07, lần hai. Lần đầu năm ca điện dùng chung CCCD nên bị `-556` che ──
  dien("điện · khach_hang rỗng", (p) => { p.khach_hang = ""; }, ACCEPTED),
  dien("điện · ngay_sinh người tham gia dạng ISO", (p) => {
    (p.list_nguoithamgia as Payload[])[0].ngay_sinh = "1990-05-15";
  }, "-1 SoapException OleDbException"),
  dien("điện · sotien_bh = 0", (p) => { p.sotien_bh = 0; }, ACCEPTED),
  dien("điện · sotien_bh = chuỗi \"20000000\"", (p) => { p.sotien_bh = "20000000"; }, ACCEPTED),
  dien("điện · SoNguoi_HoKhau = 0", (p) => { p.SoNguoi_HoKhau = 0; }, ACCEPTED),
  dien("điện · ten_khach người tham gia rỗng", (p) => {
    (p.list_nguoithamgia as Payload[])[0].ten_khach = "";
  }, ACCEPTED),
  dien("điện · so_cmnd người tham gia rỗng, cmt_khachhang rỗng", (p) => {
    (p.list_nguoithamgia as Payload[])[0].so_cmnd = "";
    p.cmt_khachhang = "";
  }, ACCEPTED),
  dien("điện · ngay_batdau dạng ISO", (p) => { p.ngay_batdau = NGAY_BAT_DAU; }, "-401"),
  dien("điện · tong_phi = chuỗi rỗng", (p) => { p.tong_phi = ""; }, "-1 FormatException ParseDouble"),
  xm("xe máy · nam_sanxuat = abcd", (p) => { p.nam_sanxuat = "abcd"; }, ACCEPTED),
  xm("xe máy · nhan_hieu = 999999 không có trong danh mục", (p) => { p.nhan_hieu = "999999"; }, ACCEPTED),
  xm("xe máy · an_bien_ks = chuỗi \"x\"", (p) => { p.an_bien_ks = "x"; }, "-1 JsonSerializationException Boolean"),
  xm("xe máy · so_nguoi_tgia_laiphu = -1", (p) => { p.so_nguoi_tgia_laiphu = -1; }, ACCEPTED),
  xm("xe máy · thêm trường lạ truong_la", (p) => { p.truong_la = "x"; }, ACCEPTED),
  xm("xe máy · ngay_dau = null", (p) => { p.ngay_dau = null; }, "-505"),
  xm("xe máy · CpId không tồn tại", (p) => { p.CpId = "00000000000000000000000000000000"; }, "-1 NullReferenceException"),
  { label: "xe máy · Sign sai", endpoint: "TaoDon_XeMay", measured: "-105 Chu ky xac thuc khong chinh xac", build: () => { const p = motorbike(); p.Sign = "0".repeat(32); return p; } },
  xm("xe máy · email hợp lệ khác hằng PVI_CERTIFICATE_EMAIL", (p) => { p.email = "mgst.probe.2026@gmail.com"; }, ACCEPTED),
  xm("xe máy · ma_giaodich là UUID 36 ký tự", (p) => { p.ma_giaodich = crypto.randomUUID(); }, ACCEPTED),
  {
    label: "Get_DanhMuc · ten_dmuc không tồn tại",
    endpoint: "Get_DanhMuc",
    measured: "-500 Khong ton tai du lieu trong danh muc",
    build: () => ({
      parent_value: "",
      ten_dmuc: "KHONGCO",
      ma_user: "",
      ma_donvi: "34",
      giatri_chon: "",
      CpId: config.cpId,
      Sign: pviSign(config, ["KHONGCO", "", "34", ""]),
    }),
  },
  {
    label: "Get_DanhMuc · ten_dmuc rỗng",
    endpoint: "Get_DanhMuc",
    measured: "-500",
    build: () => ({
      parent_value: "",
      ten_dmuc: "",
      ma_user: "",
      ma_donvi: "34",
      giatri_chon: "",
      CpId: config.cpId,
      Sign: pviSign(config, ["", "", "34", ""]),
    }),
  },
  {
    label: "GetPolicyNumber · RequestId rỗng",
    endpoint: "GetPolicyNumber",
    measured: "-500 Khong ton tai requestId",
    build: () => ({ CpId: config.cpId, Sign: pviSign(config, [""]), RequestId: "" }),
  },
  {
    label: "GetPolicyNumber · RequestId không tồn tại",
    endpoint: "GetPolicyNumber",
    measured: "-500 Khong ton tai requestId",
    build: () => ({ CpId: config.cpId, Sign: pviSign(config, ["KHONG-CO"]), RequestId: "KHONG-CO" }),
  },
];

/** Thân request không phải JSON hợp lệ, đi thẳng `fetch` vì `pviRequest` luôn `JSON.stringify`. */
const RAW_BODIES: Array<{ label: string; endpoint: string; body: string; measured?: string }> = [
  { label: "xe máy · thân JSON hỏng `{`", endpoint: "TaoDon_XeMay", body: "{", measured: "-1 Unexpected end when deserializing" },
  { label: "xe máy · thân JSON là mảng `[]`", endpoint: "TaoDon_XeMay", body: "[]", measured: "-1 Cannot deserialize JSON array" },
  { label: "xe máy · thân JSON là object rỗng `{}`", endpoint: "TaoDon_XeMay", body: "{}", measured: "-1 NullReferenceException" },
];

function describe(e: unknown): string {
  if (e instanceof PviApiError) return `${e.kind}${e.status ? ` · Status=${e.status}` : ""} · ${e.message.slice(0, 160)}`;
  return e instanceof Error ? `${e.name} · ${e.message}` : String(e);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log("Máy chủ:", config.baseUrl, "· mã:", `MGST-PROBE-${STAMP}-*`, "· ngày bắt đầu:", NGAY_BAT_DAU, "\n");

for (const c of CASES) {
  if (c.measured && !RUN_ALL) {
    console.log(`${c.label.padEnd(56)} = ${c.measured}  (đã đo, bỏ qua)`);
    continue;
  }
  const payload = c.build();
  process.stdout.write(`${c.label.padEnd(56)} → `);
  try {
    const r = await pviRequest(c.endpoint, payload);
    const key = r.raw.Pr_key ?? r.raw.pr_key;
    console.log(`${ACCEPTED}${key ? ` · Pr_key=${key}` : ""} · ${payload.ma_giaodich ?? ""} · ${JSON.stringify(r.raw).slice(0, 120)}`);
  } catch (e) {
    console.log(describe(e));
  }
  await sleep(500);
}

const proxyToken = (process.env.PVI_API_PROXY_TOKEN ?? "").trim();
for (const c of RAW_BODIES) {
  if (c.measured && !RUN_ALL) {
    console.log(`${c.label.padEnd(56)} = ${c.measured}  (đã đo, bỏ qua)`);
    continue;
  }
  process.stdout.write(`${c.label.padEnd(56)} → `);
  try {
    const res = await fetch(`${config.baseUrl}/API_CP/ManagerApplication/${c.endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(proxyToken ? { "x-pvi-proxy-token": proxyToken } : {}),
      },
      body: c.body,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const text = await res.text();
    console.log(`HTTP ${res.status} · ${text.slice(0, 200).replace(/\s+/g, " ")}`);
  } catch (e) {
    console.log(describe(e));
  }
  await sleep(500);
}
