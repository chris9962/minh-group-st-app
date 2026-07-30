import { z } from 'zod';

/**
 * P-70 · Danh mục kênh (mgst-feature-list.md §4.6, mgst-platform-spec.md §2.3).
 *
 * `inputKind` là DỮ LIỆU, không phải nhánh code theo TÊN kênh — thêm kênh mới
 * (vd. "Trường học") chỉ cần chọn đúng kiểu nhập, không ai phải sửa code hay
 * phát hành lại app (spec §2.3 "chỗ này làm sai thì rất khó sửa").
 */

export const ChannelInputKind = z.enum(['ward-hamlet', 'list', 'free-text', 'none']);
export type ChannelInputKind = z.infer<typeof ChannelInputKind>;

export const INPUT_KIND_LABEL: Record<ChannelInputKind, string> = {
  'ward-hamlet': 'Chọn xã rồi chọn ấp',
  list: 'Chọn từ danh sách',
  'free-text': 'Nhập tự do',
  none: 'Không nhập gì thêm',
};

export const Channel = z.object({
  id: z.string(),
  name: z.string(),
  inputKind: ChannelInputKind,
  /** Chỉ có ý nghĩa khi inputKind = 'list' — các lựa chọn do người cấu hình tự nhập. */
  listOptions: z.array(z.string()),
});
export type Channel = z.infer<typeof Channel>;

export const ChannelForm = z.object({
  name: z.string().trim().min(1, 'Chưa nhập tên kênh'),
  inputKind: ChannelInputKind,
  listOptions: z.array(z.string().trim().min(1, 'Lựa chọn không được để trống')),
});
export type ChannelForm = z.infer<typeof ChannelForm>;

export async function fetchChannels(): Promise<Channel[]> {
  const res = await fetch('/api/settings/channels');
  if (!res.ok) throw new Error('Không tải được danh mục kênh');
  return z.array(Channel).parse(await res.json());
}

async function send(url: string, method: string, form: ChannelForm) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw new Error('Không lưu được kênh này');
  return Channel.parse(await res.json());
}

export const createChannel = (form: ChannelForm) => send('/api/settings/channels', 'POST', form);

export const updateChannel = (id: string, form: ChannelForm) =>
  send(`/api/settings/channels/${id}`, 'PATCH', form);
