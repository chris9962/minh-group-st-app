import { z } from "zod";
import { ReferralCodeAllocationItem } from "@/lib/api/bankCatalog";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, isUuid, jsonBody, notFound, signedIn } from "@/server/auth";
import {
  referralCodeAllocationSheet,
  saveReferralCodeAllocations,
  type AllocationResult,
} from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

/**
 * Chia chỗ của một mã cho nhân viên trong phòng — form mở từ nút MGT ở màn
 * Ngân hàng (chốt 2026-10-19).
 *
 * Gác bằng `signedIn` rồi để `catalog` chốt: ai quản phòng dùng mã mới đọc và
 * ghi được (`canAllocateReferralCodes`), và phòng đó phải đọc từ CHÍNH mã,
 * không nhận từ request.
 */
function respond(result: AllocationResult) {
  if (result.ok) return Response.json(result.sheet);
  if (result.status === 404) return notFound();
  if (result.status === 403) return forbidden();
  return badRequest(result.message);
}

export async function GET(request: Request, { params }: Params) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  return respond(await referralCodeAllocationSheet(guard.actor, id));
}

const Body = z.object({ items: z.array(ReferralCodeAllocationItem).max(200) });

export async function PUT(request: Request, { params }: Params) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await saveReferralCodeAllocations(guard.actor, id, parsed.data.items);
  if (result.ok)
    await logAudit(guard.actor, {
      module: "banking",
      action: "update",
      targetLabel: `Chia mã giới thiệu ${result.sheet.code.displayName} cho ${result.sheet.rows.filter((r) => r.quota > 0).length} nhân viên`,
      targetTable: "referral_codes",
      targetId: id,
    });
  return respond(result);
}
