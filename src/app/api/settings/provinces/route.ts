import { AddProvinceForm } from "@/lib/api/wardCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, signedIn, badRequest, jsonBody, notFound } from "@/server/auth";
import { addProvince, listProvinceTree } from "@/server/catalog";

/** P-71 · Địa bàn công ty — cây tỉnh · xã/phường · ấp. */
export async function GET(request: Request) {
  // Danh mục dùng chung: mọi form nghiệp vụ đều phải đọc được để đổ vào ô chọn,
  // nên chỉ chặn ở mức đã đăng nhập. Quyền SỬA bên dưới vẫn gác như cũ.
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  return Response.json(await listProvinceTree());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = AddProvinceForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const province = await addProvince(parsed.data.provinceId);
  if (!province) return notFound();

  // Ghi nhật ký SAU khi biết kết quả. Ghi trước thì thao tác 404, hoặc bản trùng
  // bị bỏ qua âm thầm, vẫn để lại một dòng "đã thêm" trong P-93 — nhật ký truy
  // vết mà ghi việc chưa từng xảy ra thì mất sạch giá trị đối chứng.
  await logAudit(guard.actor, {
    module: "system",
    action: "create",
    targetLabel: `Thêm tỉnh ${province.name} vào địa bàn`,
    targetTable: "provinces",
    targetId: province.id,
  });

  return Response.json(province, { status: 201 });
}
