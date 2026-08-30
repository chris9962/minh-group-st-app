import { FEEDBACK_SORT, FeedbackBody } from "@/lib/api/feedback";
import { actorWith, badRequest, jsonBody, signedIn } from "@/server/auth";
import { createFeedback, listFeedbacks } from "@/server/feedback";
import { pageArgsFrom } from "@/server/pagination";

/**
 * P-96 · Hộp góp ý.
 *
 * Hai chiều gác KHÁC NHAU, và đó là chủ ý: gửi góp ý thì ai đăng nhập cũng gửi
 * được, đọc cả hộp thì phải có `system:handle-feedback`. Dựng thêm một quyền
 * "được gửi góp ý" là dựng một quyền ai cũng phải có, và bỏ tích nhầm nó ở P-92
 * là chặn mất đường báo lỗi của chính người đó.
 */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "handle-feedback");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);

  return Response.json(
    await listFeedbacks(
      // Trạng thái lạ rơi về "mọi trạng thái", xử lý trong `listFeedbacks`.
      { status: url.searchParams.get("status") ?? "" },
      pageArgsFrom(url, FEEDBACK_SORT, "createdAt"),
    ),
  );
}

export async function POST(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const parsed = FeedbackBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Nội dung góp ý không hợp lệ");

  const row = await createFeedback(guard.actor, parsed.data);
  if (!row) return badRequest("Không gửi được góp ý");

  // KHÔNG ghi `audit_log`: dòng `feedbacks` đã mang đủ ai gửi và gửi lúc nào.
  return Response.json(row, { status: 201 });
}
