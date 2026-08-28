/**
 * Gọi thật ba API PVI mà hệ thống cần.
 *
 *   Mục 3  Get_DanhMuc     chỉ đọc, lấy danh mục loại xe máy
 *   Mục 10 TaoDon_XeMay    TẠO ĐƠN THẬT trên máy chủ test
 *   Mục 11 TaoDon_HSDD_CP  TẠO ĐƠN THẬT trên máy chủ test
 *
 * ⚠️ Hai lệnh sau ghi dữ liệu bên PVI. Chỉ chạy trên `piastest`, và mỗi lần
 * chạy dùng một `ma_giaodich` khác — PVI đòi mã này không trùng.
 *
 * Chạy: bun scripts/pvi-api-smoke.ts
 */

import { PviApiError, pviRequest, pviSign } from "@/server/pvi-api/client";
import { readPviApiConfig } from "@/server/pvi-api/config";
import { MotorbikeOrderInput, buildMotorbikePayload, createMotorbikeOrder } from "@/server/pvi-api/motorbike";
import { ElectricOrderInput, buildElectricPayload, createElectricAccidentOrder } from "@/server/pvi-api/electric";

process.env.PVI_API_BASE_URL ??= "http://piastest.pvi.com.vn";

const config = readPviApiConfig();
if (!config) throw new Error("Thiếu PVI_API_BASE_URL / PVI_API_CPID / PVI_API_KEY");

// Mã giao dịch phải khác nhau mỗi lần chạy; giờ chạy đủ để tách.
const STAMP = new Date().toISOString().replace(/\D/g, "").slice(2, 14);

function ke(e: unknown): string {
  if (e instanceof PviApiError)
    return `${e.kind}${e.status ? ` · Status=${e.status}` : ""} · ${e.message}`;
  return e instanceof Error ? `${e.name} · ${e.message}` : String(e);
}

const che = (o: unknown) =>
  JSON.stringify(o, null, 2).replace(/("(?:CpId|Sign)": ")[^"]+/g, "$1…");

console.log("Máy chủ:", config.baseUrl, "· chữ ký:", config.signUppercase ? "HOA" : "thường");
console.log("Mã giao dịch:", STAMP, "\n");

// ── Mục 3 · Get_DanhMuc ────────────────────────────────────────────────────
{
  const tenDmuc = "LOAIXEMOTOR";
  const maUser = "";
  const maDonvi = "34"; // tài liệu ghi `fix=34`
  const giatriChon = "";
  console.log("── Mục 3 · Get_DanhMuc ·", tenDmuc);
  try {
    const { raw } = await pviRequest("Get_DanhMuc", {
      parent_value: "",
      ten_dmuc: tenDmuc,
      ma_user: maUser,
      ma_donvi: maDonvi,
      giatri_chon: giatriChon,
      CpId: config.cpId,
      Sign: pviSign(config, [tenDmuc, maUser, maDonvi, giatriChon]),
    });
    const data = raw.Data as unknown[] | undefined;
    console.log(`   Status=00 · ${data?.length ?? 0} mục`);
    console.log("  ", JSON.stringify(data?.slice(0, 5)));
  } catch (e) {
    console.log("  ", ke(e));
  }
}

// ── Mục 10 · TaoDon_XeMay ──────────────────────────────────────────────────
{
  const input = MotorbikeOrderInput.parse({
    maGiaoDich: `MGST-XM-${STAMP}`,
    tenChuXe: "NGUYEN VAN TEST",
    diaChi: "Ấp 1, Xã An Xuyên, Cà Mau",
    soDienThoai: "0901110000",
    bienKiemSoat: "69B1-12345",
    soMay: "",
    soKhung: "",
    loaiXe: "1",
    ngayBatDau: "2026-08-29",
    ngayKetThuc: "2027-08-29",
  });
  console.log("\n── Mục 10 · TaoDon_XeMay");
  console.log("   gửi đi:", che(buildMotorbikePayload(input)));
  try {
    console.log("   kết quả:", JSON.stringify(await createMotorbikeOrder(input)));
  } catch (e) {
    console.log("  ", ke(e));
  }
}

// ── Mục 11 · TaoDon_HSDD_CP ────────────────────────────────────────────────
{
  const input = ElectricOrderInput.parse({
    maGiaoDich: `MGST-HSDD-${STAMP}`,
    khachHang: "NGUYEN VAN TEST",
    cmtKhachHang: "272866539",
    ngaySinh: "1990-05-15",
    diaChi: "Ấp 1, Xã An Xuyên, Cà Mau",
    soDienThoai: "0901110000",
    ngayBatDau: "2026-08-29",
    ngayKetThuc: "2027-08-29",
    soTienBh: 20_000_000,
    tongPhi: 50_000,
    soNguoiHoKhau: 4,
  });
  console.log("\n── Mục 11 · TaoDon_HSDD_CP");
  console.log("   gửi đi:", che(buildElectricPayload(input)));
  try {
    console.log("   kết quả:", JSON.stringify(await createElectricAccidentOrder(input)));
  } catch (e) {
    console.log("  ", ke(e));
  }
}
