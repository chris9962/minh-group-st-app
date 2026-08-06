import { HamletForm } from "@/lib/api/wardCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody, notFound } from "@/server/auth";
import { addHamlet } from "@/server/catalog";

/** Ấp nhập tay — dữ liệu nhà nước không có cấp này. */
export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = HamletForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await addHamlet(parsed.data.wardId, parsed.data.name);
  if (!result.ok) return badRequest("Xã này đã có ấp trùng tên");
  const province = result.item;
  if (!province) return notFound();

  // Ghi nhật ký SAU khi biết kết quả. Ghi trước thì thao tác 404, hoặc bản trùng
  // bị bỏ qua âm thầm, vẫn để lại một dòng "đã thêm" trong P-93 — nhật ký truy
  // vết mà ghi việc chưa từng xảy ra thì mất sạch giá trị đối chứng.
  await logAudit(guard.actor, {
    module: "system",
    action: "create",
    targetLabel: `Thêm ấp ${parsed.data.name} (${province.name})`,
    targetTable: "hamlets",
    targetId: province.id,
  });

  return Response.json(province, { status: 201 });
}
