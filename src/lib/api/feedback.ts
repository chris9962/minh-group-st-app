import { z } from 'zod';
import { pageOf, pageParams, type Page, type PageQuery } from './pagination';

/**
 * P-96 · Góp ý — nhân viên gửi, người có `system:handle-feedback` đọc và đánh
 * dấu đã xử lý.
 *
 * Hai chiều gác khác nhau: GỬI thì ai đăng nhập cũng gửi được, ĐỌC thì phải có
 * quyền. Cố ý không dựng quyền "được gửi góp ý" — đó sẽ là quyền ai cũng phải
 * có, nên thứ duy nhất nó thêm vào là một ô tích ở P-92 mà bỏ tích là chặn mất
 * đường báo lỗi của chính người đó.
 */

export const FeedbackStatus = z.enum(['pending', 'done']);
export type FeedbackStatus = z.infer<typeof FeedbackStatus>;

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  pending: 'Chưa xử lý',
  done: 'Đã xử lý',
};

/** Trần độ dài. Ô nhập đặt `maxLength` cùng số này để chặn gõ quá. */
export const FEEDBACK_MAX = 2000;

/** Phần người dùng GÕ. Hộp thoại chỉ có đúng ô này. */
export const FeedbackForm = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Bạn chưa nhập nội dung')
    .max(FEEDBACK_MAX, `Nội dung nhiều nhất ${FEEDBACK_MAX} ký tự`),
});
export type FeedbackForm = z.infer<typeof FeedbackForm>;

/**
 * Phần GỬI LÊN — thêm đường dẫn trang, do component đọc từ `usePathname` chứ
 * không phải người dùng gõ.
 *
 * Tách khỏi `FeedbackForm` chứ không dùng `.default('')`: zod v4 làm kiểu vào
 * và kiểu ra lệch nhau, và `zodResolver` của react-hook-form từ chối schema đó
 * (AGENTS.md §4).
 *
 * Máy chủ tin `path` ở mức "ghi lại để tra", không dùng nó quyết định gì — nó
 * chỉ là chuỗi trình duyệt gửi lên.
 */
export const FeedbackBody = FeedbackForm.extend({
  path: z.string().max(200),
});
export type FeedbackBody = z.infer<typeof FeedbackBody>;

export const Feedback = z.object({
  id: z.string(),
  content: z.string(),
  path: z.string(),
  status: FeedbackStatus,
  /** ISO datetime — lúc người dùng gửi. */
  createdAt: z.string(),
  senderName: z.string(),
  senderDepartmentName: z.string(),
  /**
   * Người đánh dấu đã xử lý và lúc đánh dấu. Chuỗi RỖNG khi chưa xử lý, không
   * phải `null`: màn hiện dấu gạch cho cả hai, thêm một kiểu rỗng thứ hai chỉ
   * là thêm một nhánh phải kiểm ở mọi chỗ dùng.
   */
  handledByName: z.string(),
  handledAt: z.string(),
});
export type Feedback = z.infer<typeof Feedback>;

/**
 * Đúng MỘT khoá sắp, cùng lý do với `AUDIT_LOG_SORT`: bảng `feedbacks` chỉ có
 * chỉ mục theo `created_at`. Cho sắp theo tên người gửi là bắt Postgres sắp cả
 * bảng mỗi lần mở màn để lấy 15 dòng. Cột khác vẫn hiện, chỉ là không bấm sắp được.
 */
export const FEEDBACK_SORT = ['createdAt'] as const;
export type FeedbackSort = (typeof FEEDBACK_SORT)[number];

export type FeedbackQuery = PageQuery<FeedbackSort> & {
  /** Rỗng = mọi trạng thái. */
  status: FeedbackStatus | '';
};

const FeedbackPage = pageOf(Feedback);

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(data?.message?.trim() || 'Không gửi được');
  }
  return res.json();
}

/** Gửi một góp ý. Ai đăng nhập cũng gọi được. */
export const submitFeedback = (body: FeedbackBody): Promise<Feedback> =>
  send('/api/feedback', 'POST', body).then(Feedback.parse);

/** MỘT trang góp ý. Lọc, sắp và cắt trang đều do máy chủ làm (AGENTS.md §5.1). */
export async function fetchFeedbacks(query: FeedbackQuery): Promise<Page<Feedback>> {
  const res = await fetch(`/api/feedback?${pageParams(query, { status: query.status })}`);
  if (res.status === 403) throw new Error('Bạn không có quyền xem hộp góp ý');
  if (!res.ok) throw new Error('Không tải được hộp góp ý');
  return FeedbackPage.parse(await res.json());
}

export const setFeedbackStatus = (id: string, status: FeedbackStatus): Promise<Feedback> =>
  send(`/api/feedback/${encodeURIComponent(id)}`, 'PATCH', { status }).then(Feedback.parse);
