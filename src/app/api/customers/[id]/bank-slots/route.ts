import { can } from "@/lib/permissions";
import { forbidden, getActor, isUuid, notFound, unauthorized, uuidParam } from "@/server/auth";
import { customerBankSlots } from "@/server/banking";
import { departmentForNewRecord } from "@/server/writeDepartment";

/**
 * P-20 bước 1 — ngân hàng nào khách đã mở, còn mở thêm được mấy tài khoản.
 *
 * Gác bằng `banking:create` chứ không phải `signedIn`: chỉ người mở được tài
 * khoản mới cần con số này.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "create")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  // Tính phòng như route `/referral-codes/open`, để loại tài khoản mở được khớp ô chọn mã.
  const department = departmentForNewRecord(
    actor,
    "banking",
    uuidParam(new URL(request.url).searchParams.get("departmentId")),
  );
  const slots = await customerBankSlots(id, department.ok ? (department.departmentId ?? "") : "");
  return slots ? Response.json(slots) : notFound();
}
