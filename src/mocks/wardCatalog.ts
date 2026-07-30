import type {
  AddProvinceForm,
  AddWardForm,
  HamletForm,
  Province,
  ReferenceProvince,
  ReferenceWard,
} from "@/lib/api/wardCatalog";
import vnAddress from "./data/vnAddress.json";

/**
 * P-71 · Danh mục xã / ấp — cây ba cấp Tỉnh → Xã → Ấp.
 *
 * `vnAddress.json` là dữ liệu THAM CHIẾU tĩnh (34 tỉnh + 3.321 xã/phường
 * thật, nguồn production.cas.so/address-kit sau sáp nhập 2025) — chỉ dùng để
 * TÌM VÀ CHỌN. Danh mục ĐANG DÙNG (`provinces` dưới đây) bắt đầu HOÀN TOÀN
 * RỖNG — quản lý tự thêm từng tỉnh/xã một khi thật sự triển khai ở đó.
 */

const referenceProvinces = vnAddress.provinces as ReferenceProvince[];
const referenceWards = vnAddress.wards as ReferenceWard[];

export const referenceProvincesFor = (): ReferenceProvince[] => referenceProvinces;

export const referenceWardsFor = (provinceId: string): ReferenceWard[] =>
  referenceWards.filter((w) => w.provinceId === provinceId);

let provinces: Province[] = [];

let nextHamletId = 1;

export const provincesFor = (): Province[] => provinces;

export function addProvince(form: AddProvinceForm): Province | null {
  if (provinces.some((p) => p.id === form.provinceId)) return null;
  const ref = referenceProvinces.find((p) => p.id === form.provinceId);
  if (!ref) return null;

  const province: Province = { id: ref.id, name: ref.name, wards: [] };
  provinces = [...provinces, province];
  return province;
}

export function addWard(form: AddWardForm): Province | null {
  const province = provinces.find((p) => p.id === form.provinceId);
  if (!province) return null;
  if (province.wards.some((w) => w.id === form.wardId)) return null;

  const ref = referenceWards.find(
    (w) => w.id === form.wardId && w.provinceId === form.provinceId,
  );
  if (!ref) return null;

  const nextProvince: Province = {
    ...province,
    wards: [...province.wards, { id: ref.id, name: ref.name, hamlets: [] }],
  };
  provinces = provinces.map((p) => (p.id === province.id ? nextProvince : p));
  return nextProvince;
}

export function createHamlet(form: HamletForm): Province | null {
  const province = provinces.find((p) => p.wards.some((w) => w.id === form.wardId));
  if (!province) return null;

  const hamlet = { id: `hl-new-${nextHamletId++}`, name: form.name };
  const nextProvince: Province = {
    ...province,
    wards: province.wards.map((w) =>
      w.id === form.wardId ? { ...w, hamlets: [...w.hamlets, hamlet] } : w,
    ),
  };
  provinces = provinces.map((p) => (p.id === province.id ? nextProvince : p));
  return nextProvince;
}
