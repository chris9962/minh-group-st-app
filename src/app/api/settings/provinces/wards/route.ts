import { AddWardForm } from "@/lib/api/wardCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody, notFound } from "@/server/auth";
import { addWard } from "@/server/catalog";

/** Trả về ĐÚNG tỉnh vừa nhận xã mới — hợp đồng ở `wardCatalog.ts` parse một `Province`. */
export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = AddWardForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const province = await addWard(parsed.data.provinceId, parsed.data.wardId);
  if (!province) return notFound();

  // Ghi nhật ký SAU khi biết kết quả. Ghi trước thì thao tác 404, hoặc bản trùng
  // bị bỏ qua âm thầm, vẫn để lại một dòng "đã thêm" trong P-93 — nhật ký truy
  // vết mà ghi việc chưa từng xảy ra thì mất sạch giá trị đối chứng.
  await logAudit(guard.actor, {
    module: "system",
    action: "create",
    targetLabel: `Thêm xã/phường vào ${province.name}`,
    targetTable: "wards",
    targetId: province.id,
  });

  return Response.json(province, { status: 201 });
}
