import type { Hospital, HospitalForm } from '@/lib/api/hospitalCatalog';

/** P-2.5 · Danh mục bệnh viện — dữ liệu mẫu, admin tự thêm theo thực tế hợp tác. */
let hospitals: Hospital[] = [
  { id: 'hv-1', name: 'Bệnh viện Đa khoa Tân Bình' },
  { id: 'hv-2', name: 'Bệnh viện Chợ Rẫy' },
  { id: 'hv-3', name: 'Bệnh viện Nhân dân 115' },
  { id: 'hv-4', name: 'Bệnh viện Nhi đồng 1' },
  { id: 'hv-5', name: 'Quân y Cà Mau' },
  { id: 'hv-6', name: 'Quân y Bạc Liêu' },
  { id: 'hv-7', name: 'Quân y Sóc Trăng' },
  { id: 'hv-8', name: 'Thạnh Trị' },
  { id: 'hv-9', name: 'Ngã Năm' },
  { id: 'hv-10', name: 'Phước Long' },
  { id: 'hv-11', name: 'Châu Thành' },
  { id: 'hv-12', name: 'Mỹ Tú' },
  { id: 'hv-13', name: 'Long Mỹ' },
  { id: 'hv-14', name: 'Hòa Bình' },
];

let nextId = 1;

export const hospitalsFor = (): Hospital[] => hospitals;

export function createHospital(form: HospitalForm): Hospital {
  const hospital: Hospital = { id: `hv-new-${nextId++}`, ...form };
  hospitals = [...hospitals, hospital];
  return hospital;
}
