import { create } from 'zustand';

/**
 * Hàng đợi toast — báo kết quả của một THAO TÁC (lưu, khoá, đặt lại mật khẩu).
 *
 * Trước đây quy ước là "im lặng = thành công": hộp thoại tự đóng, danh sách tự
 * tải lại, và người dùng tự suy ra. Quy ước đó gãy ở những form không đóng sau
 * khi lưu — sửa số điện thoại xong không có gì đổi trên màn hình, người dùng
 * không biết đã lưu hay vừa bấm nhầm Huỷ.
 *
 * Chỉ dùng cho KẾT QUẢ thao tác. Không dùng cho:
 * - lỗi tải dữ liệu → `ErrorState`, vì nó cần nút Tải lại và phải nằm đúng chỗ
 *   đáng ra là nội dung;
 * - lỗi từng ô của biểu mẫu → `error` của `TextField`, vì toast không trỏ được
 *   vào ô nào sai.
 */

/**
 * `warn` KHÁC `fail`: thao tác ĐÃ THÀNH CÔNG, đây là lời nhắc nghiệp vụ đi kèm.
 *
 * Cảnh báo mềm của spec §4.8 ("khách mới cài 1 app", "MSBa phải đủ 3 app") rơi
 * đúng vào chỗ này — báo bằng `fail` thì người dùng tưởng chưa lưu và bấm lại,
 * báo bằng `ok` thì lời nhắc chìm nghỉm giữa các thông báo thành công.
 */
export type ToastTone = 'ok' | 'warn' | 'fail';

export type ToastItem = {
  id: number;
  tone: ToastTone;
  message: string;
};

type ToastStore = {
  items: ToastItem[];
  dismiss: (id: number) => void;
};

let nextId = 0;

export const useToasts = create<ToastStore>((set) => ({
  items: [],
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

const push = (tone: ToastTone, message: string) => {
  const id = nextId++;
  useToasts.setState((s) => ({ items: [...s.items, { id, tone, message }] }));
};

/**
 * Gọi được từ bất cứ đâu, kể cả ngoài component — `onSuccess`/`onError` của
 * mutation không phải lúc nào cũng ở trong thân component.
 */
export const toast = {
  ok: (message: string) => push('ok', message),
  /** Đã lưu xong, nhưng có điều đáng nhắc — không phải lỗi. */
  warn: (message: string) => push('warn', message),
  fail: (message: string) => push('fail', message),
};

/**
 * Câu lỗi của máy chủ nếu có, không thì câu dự phòng.
 *
 * Đọc được cả ba dạng lỗi trong app — `OrgError`/`SaveError` (`{code, message}`
 * từ 422) và `Error` trần (403, mất mạng) — vì cả ba đều có `message`. Không
 * lấy `Error.message` mặc định của trình duyệt làm câu hiển thị: `"Failed to
 * fetch"` không nói được gì với người dùng, nên tầng `lib/api/*` luôn đặt câu
 * tiếng Việt trước khi ném.
 */
export const errorMessage = (e: unknown, fallback: string): string => {
  const message = (e as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
};
