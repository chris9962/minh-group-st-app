import { StaffPaymentForm, type StaffPayment } from "@/lib/api/staffPayment";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, forbidden, isUuid, jsonBody, notFound } from "@/server/auth";
import { saveStaffPayment, staffPaymentOf } from "@/server/staffPayment";

type Params = { params: Promise<{ id: string }> };

const FIELD_LABEL: Record<keyof StaffPayment, string> = {
  bankAccountNumber: "Số tài khoản",
  bankName: "Ngân hàng nhận",
  bankCode: "Mã ngân hàng",
};

/** Tab Thông tin thanh toán ở hồ sơ nhân viên. Cùng quyền với nút Chốt lương: file chuyển lương đọc ba ô này. */
export async function GET(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "close-salary");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const found = await staffPaymentOf(id);
  if (!found) return notFound();
  return Response.json(found.payment);
}

/** Không ai tự sửa tài khoản nhận lương của chính mình (chốt 2026-11-13), kể cả người có quyền chốt lương. */
export async function PUT(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "close-salary");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  if (id === guard.actor.id) return forbidden();
  const parsed = StaffPaymentForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);

  const saved = await saveStaffPayment(id, parsed.data);
  if (!saved) return notFound();

  const changes = (Object.keys(FIELD_LABEL) as (keyof StaffPayment)[])
    .filter((key) => saved.before[key] !== saved.after[key])
    .map((key) => `${FIELD_LABEL[key]}: ${saved.before[key] ?? "trống"} → ${saved.after[key] ?? "trống"}`);
  if (changes.length > 0)
    await logAudit(guard.actor, {
      module: "system",
      action: "close-salary",
      targetLabel: `Sửa thông tin thanh toán của ${saved.fullName} - ${changes.join(", ")}`,
      targetTable: "staff_profiles",
      targetId: id,
    });

  return Response.json(saved.after);
}
