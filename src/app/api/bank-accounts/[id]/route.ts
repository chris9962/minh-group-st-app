import { BankAccountUpdateForm } from "@/lib/api/bankAccounts";
import { can } from "@/lib/permissions";
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
import { deleteDraft, updateFinishedAccount } from "@/server/banking";

/**
 * Sửa một tài khoản ĐÃ hoàn thành (chốt 07/08).
 *
 * Đường riêng chứ không dùng lại `/finish`: hai việc khác nhau. `/finish` là
 * bước chuyển trạng thái và nó TIÊU một lượt mã giới thiệu; đường này chỉ sửa
 * chữ trên một bản ghi đã xong, không đụng kho mã.
 *
 * Khách, ngân hàng và mã giới thiệu KHÔNG nằm trong biểu mẫu — đổi ba thứ đó là
 * viết lại lịch sử kho mã, và người dùng có nút xoá bản nháp cho ca nhập nhầm.
 *
 * Cũng là đường ghi BƯỚC 3 (spec §4.2): ngày khách phát sinh giao dịch. Ảnh
 * giao dịch đi đường `/photos` riêng, cùng nhịp với ảnh chứng minh.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "update")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = BankAccountUpdateForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateFinishedAccount(actor, id, parsed.data);
  // `null` = không có hoặc ngoài tầm nhìn — 404 giống hệt nhau.
  if (result === null) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  // Ngày giao dịch nói riêng ra: ô để trống là lệnh XOÁ ghi nhận, mà nhãn chung
  // "Sửa tài khoản" thì người soát nhật ký không có cách nào biết nó vừa mất.
  const { account } = result.value;
  const transaction = account.transactionAt
    ? `, ngày giao dịch ${account.transactionAt}`
    : ", không có ngày giao dịch";

  await logAudit(actor, {
    module: "banking",
    action: "update",
    targetLabel: `Sửa tài khoản ${account.bankCode} của ${account.customerName}${transaction}`,
    targetTable: "bank_accounts",
    targetId: id,
  });
  return Response.json(result.value);
}

/**
 * Bỏ dở một tài khoản đang tạo — nhả chỗ mã về kho ngay (spec §4.5).
 *
 * Tài khoản đã hoàn thành KHÔNG xoá được: nó đã tiêu một lượt mã và đã vào điểm
 * KPI. Tầng dưới trả `null` cho ca đó, và ở đây thành 404 y như "không có" —
 * phân biệt hai ca là nói cho người gọi biết id nào có thật.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "delete")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const removed = await deleteDraft(actor, id);
  if (!removed) return notFound();

  await logAudit(actor, {
    module: "banking",
    action: "delete",
    targetLabel: `Bỏ dở tài khoản ${removed.bankCode} của ${removed.customerName}, nhả mã ${removed.referralCode}`,
    targetTable: "bank_accounts",
    targetId: removed.id,
  });
  return new Response(null, { status: 204 });
}
