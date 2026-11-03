import { CustomerInspectionForm } from "@/lib/api/customers";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { logAudit } from "@/server/audit";
import {
  clearCustomerInspection,
  markCustomerInspected,
  updateCustomerInspectionNote,
} from "@/server/customers";
import { imageKeyOf } from "@/server/storage";

type Params = { params: Promise<{ id: string }> };

/**
 * Dấu "đã kiểm tra" của Phòng Thanh tra trên một hồ sơ khách (chốt 2026-10-14),
 * kèm một ảnh (chốt 2026-11-03). Gác bằng `customer:lookup`, cùng quyền với việc
 * đọc dấu. Mỗi lượt ghi vào nhật ký, hành động `lookup`, để tra "ai kiểm hồ sơ
 * này lúc nào".
 */
async function parseForm(request: Request) {
  const parsed = CustomerInspectionForm.safeParse(await jsonBody(request));
  if (!parsed.success) return { error: "Ghi chú phải là văn bản, tối đa 500 ký tự" } as const;
  // Ảnh đã lên kho qua `POST /api/uploads`; ở đây chỉ nhận lại khoá của mình.
  const photo = parsed.data.photoUrl === null ? "" : imageKeyOf(parsed.data.photoUrl);
  if (photo === null) return { error: "Ảnh không hợp lệ" } as const;
  return { note: parsed.data.note, photo } as const;
}

export async function PUT(request: Request, { params }: Params) {
  const guard = await actorWith(request, "customer", "lookup");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const form = await parseForm(request);
  if ("error" in form) return badRequest(form.error);
  const result = await markCustomerInspected(guard.actor, id, form.note, form.photo);
  if (!result) return notFound();
  await logAudit(guard.actor, {
    module: "customer", action: "lookup",
    targetLabel: `Đánh dấu đã kiểm tra hồ sơ ${result.fullName}`,
    targetTable: "customers", targetId: id,
  });
  return Response.json(result.inspection);
}

export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "customer", "lookup");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const form = await parseForm(request);
  if ("error" in form) return badRequest(form.error);
  const result = await updateCustomerInspectionNote(guard.actor, id, form.note, form.photo);
  if (!result) return notFound();
  await logAudit(guard.actor, {
    module: "customer", action: "lookup",
    targetLabel: `Sửa ghi chú kiểm tra hồ sơ ${result.fullName}`,
    targetTable: "customers", targetId: id,
  });
  return Response.json(result.inspection);
}

export async function DELETE(request: Request, { params }: Params) {
  const guard = await actorWith(request, "customer", "lookup");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const result = await clearCustomerInspection(guard.actor, id);
  if (!result) return notFound();
  await logAudit(guard.actor, {
    module: "customer", action: "lookup",
    targetLabel: `Bỏ dấu đã kiểm tra hồ sơ ${result.fullName}`,
    targetTable: "customers", targetId: id,
  });
  return Response.json({ ok: true });
}
