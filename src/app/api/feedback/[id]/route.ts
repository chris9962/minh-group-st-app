import { z } from "zod";
import { FEEDBACK_STATUS_LABEL, FeedbackStatus } from "@/lib/api/feedback";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { setFeedbackStatus } from "@/server/feedback";

const StatusBody = z.object({ status: FeedbackStatus });

type Params = { params: Promise<{ id: string }> };

/** P-96 · Đánh dấu một góp ý đã xử lý, hoặc trả nó về chưa xử lý. */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "handle-feedback");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = StatusBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const row = await setFeedbackStatus(guard.actor, id, parsed.data.status);
  if (!row) return notFound();

  await logAudit(guard.actor, {
    module: "system",
    action: "handle-feedback",
    targetLabel: `${FEEDBACK_STATUS_LABEL[row.status]} — góp ý của ${row.senderName}`,
    targetTable: "feedbacks",
    targetId: id,
  });
  return Response.json(row);
}
