/**
 * Tên xã/phường và tỉnh/thành từ tọa độ, qua Nominatim của OpenStreetMap: không
 * cần key, nhưng luật dùng của họ giới hạn 1 lượt/giây và bắt khai `User-Agent`.
 *
 * Dữ liệu sau sáp nhập 2025-07-01 chưa đều: có điểm trả "Xã Liêu Tú", có điểm
 * chỉ trả "Khu vực Thuận Hóa". Ưu tiên tên có tiền tố hành chính, không có thì
 * lấy tên gần nhất dịch vụ trả về.
 *
 * Lỗi thì trả `null`: chấm công không được phụ thuộc dịch vụ ngoài.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";

const COMMUNE_KEYS = ["suburb", "city_district", "village", "town", "quarter", "hamlet", "municipality"];
const PROVINCE_KEYS = ["state", "province", "city"];

const pick = (address: Record<string, string>, keys: string[], prefix: RegExp): string | undefined => {
  const values = keys.map((k) => address[k]).filter(Boolean);
  return values.find((v) => prefix.test(v)) ?? values[0];
};

export async function placeName(latitude: number, longitude: number): Promise<string | null> {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: "14",
    addressdetails: "1",
    "accept-language": "vi",
  });
  try {
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { "User-Agent": "mgst-app (https://app.mgst.com.vn)" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const { address = {} } = (await res.json()) as { address?: Record<string, string> };
    const commune = pick(address, COMMUNE_KEYS, /^(Xã|Phường|Đặc khu|Thị trấn) /);
    const province = pick(address, PROVINCE_KEYS, /^(Tỉnh|Thành phố) /);
    const parts = [...new Set([commune, province].filter((p): p is string => Boolean(p)))];
    return parts.length > 0 ? parts.join(" - ") : null;
  } catch {
    return null;
  }
}
