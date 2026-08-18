import { z } from "zod";
import { canOrg } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import {
  badRequest,
  forbidden,
  getActor,
  isUuid,
  jsonBody,
  notFound,
  unauthorized,
} from "@/server/auth";
import { orgError, setDepartmentActive } from "@/server/org";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({ active: z.boolean() });

export async function POST(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  // Ngừng hoạt động là XOÁ MỀM (phòng không xoá cứng, quyết định #32) nên nó
  // hỏi `delete`, không phải `update`.
  if (!canOrg(actor, "delete")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  // Thiếu trường `active` thì trước đây drizzle bỏ qua khoá undefined: phòng
  // KHÔNG đổi gì, route vẫn trả 200 và vẫn ghi một dòng nhật ký "đã ngừng
  // hoạt động" — nhật ký P-93 là append-only nên dòng sai đó nằm lại vĩnh viễn.
  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();
  const { active } = parsed.data;

  const result = await setDepartmentActive(id, active);
  if (!result) return notFound();
  if (!result.ok) return Response.json(orgError(result.code), { status: 422 });

  await logAudit(actor, {
    module: "department",
    action: "delete",
    targetLabel: `${active ? "Mở lại" : "Ngừng hoạt động"} phòng ${result.department.name}`,
    targetTable: "departments",
    targetId: id,
  });
  return Response.json(result.department);
}
