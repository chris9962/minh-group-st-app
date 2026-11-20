import { businessMonth } from "@/lib/format";
import { MyBlanksForm } from "@/lib/api/myBlanks";
import { logAudit } from "@/server/audit";
import { badRequest, jsonBody, signedIn } from "@/server/auth";
import { myBlanks, saveMyBlanks } from "@/server/myBlanks";

/** Phôi bảo hiểm và phiếu ngân hàng người đang đăng nhập đang giữ. Ai ở phòng kinh doanh cũng báo được, không cần quyền. */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  return Response.json(await myBlanks(guard.actor));
}

export async function PUT(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  const parsed = MyBlanksForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);

  const saved = await saveMyBlanks(guard.actor, parsed.data);
  if (!saved.ok) return Response.json({ message: saved.message }, { status: 409 });

  const month = businessMonth();
  if (parsed.data.insurance.length > 0)
    await logAudit(guard.actor, {
      module: "insurance",
      action: "update",
      targetLabel: `Báo phôi bảo hiểm còn lại tháng ${month}`,
      targetTable: "insurance_blank_staff_quotas",
      targetId: saved.departmentId,
    });
  if (parsed.data.bank.length > 0)
    await logAudit(guard.actor, {
      module: "banking",
      action: "update",
      targetLabel: `Báo phiếu ngân hàng còn lại tháng ${month}`,
      targetTable: "bank_blank_staff_quotas",
      targetId: saved.departmentId,
    });
  return Response.json(await myBlanks(guard.actor));
}
