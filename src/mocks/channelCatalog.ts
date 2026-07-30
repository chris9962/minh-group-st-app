import type { Channel, ChannelForm } from '@/lib/api/channelCatalog';

/**
 * P-70 · Danh mục kênh — năm kênh khởi tạo khớp bảng ví dụ ở spec §2.3.
 * ATM chưa rõ có nhập kèm gì (spec đánh dấu ❓) nên tạm để `none`.
 */
let channels: Channel[] = [
  { id: 'ch-ap', name: 'Ấp', inputKind: 'ward-hamlet', listOptions: [] },
  { id: 'ch-dinh-danh', name: 'Định danh', inputKind: 'ward-hamlet', listOptions: [] },
  { id: 'ch-benh-vien', name: 'Bệnh viện', inputKind: 'list', listOptions: [] },
  { id: 'ch-tu-do', name: 'Tự do', inputKind: 'free-text', listOptions: [] },
  { id: 'ch-atm', name: 'ATM', inputKind: 'none', listOptions: [] },
];

let nextId = 1;

export const channelsFor = (): Channel[] => channels;

export function createChannel(form: ChannelForm): Channel {
  const channel: Channel = { id: `ch-new-${nextId++}`, ...form };
  channels = [...channels, channel];
  return channel;
}

export function updateChannel(id: string, form: ChannelForm): Channel | null {
  const current = channels.find((c) => c.id === id);
  if (!current) return null;
  const next = { ...current, ...form };
  channels = channels.map((c) => (c.id === id ? next : c));
  return next;
}
