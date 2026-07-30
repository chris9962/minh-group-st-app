import type { HamletForm, Ward, WardForm } from '@/lib/api/wardCatalog';

/** P-71 · Danh mục xã / ấp — dữ liệu mẫu, admin tự thêm theo địa bàn thật. */
let wards: Ward[] = [
  {
    id: 'wd-tan-binh',
    name: 'Xã Tân Bình',
    hamlets: [
      { id: 'hl-1', name: 'Ấp 1' },
      { id: 'hl-2', name: 'Ấp 2' },
      { id: 'hl-3', name: 'Ấp 3' },
    ],
  },
  {
    id: 'wd-tan-hoa',
    name: 'Xã Tân Hoà',
    hamlets: [
      { id: 'hl-4', name: 'Ấp Tân Hoà A' },
      { id: 'hl-5', name: 'Ấp Tân Hoà B' },
    ],
  },
  {
    id: 'wd-binh-my',
    name: 'Xã Bình Mỹ',
    hamlets: [
      { id: 'hl-6', name: 'Ấp Bình Mỹ 1' },
      { id: 'hl-7', name: 'Ấp Bình Mỹ 2' },
    ],
  },
];

let nextWardId = 1;
let nextHamletId = 1;

export const wardsFor = (): Ward[] => wards;

export function createWard(form: WardForm): Ward {
  const ward: Ward = { id: `wd-new-${nextWardId++}`, name: form.name, hamlets: [] };
  wards = [...wards, ward];
  return ward;
}

export function createHamlet(form: HamletForm): Ward | null {
  const ward = wards.find((w) => w.id === form.wardId);
  if (!ward) return null;
  const next = { ...ward, hamlets: [...ward.hamlets, { id: `hl-new-${nextHamletId++}`, name: form.name }] };
  wards = wards.map((w) => (w.id === form.wardId ? next : w));
  return next;
}
