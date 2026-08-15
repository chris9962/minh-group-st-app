import { CUSTOMER_ERROR, CustomerForm, type CustomerSort } from "@/lib/api/customers";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody, signedIn, uuidParam } from "@/server/auth";
import { createCustomer, listCustomers } from "@/server/customers";
import { pageArgsFrom } from "@/server/pagination";

const SORTABLE: readonly CustomerSort[] = ["name", "accounts", "insurance", "created"];

/**
 * P-40 · Danh sách khách hàng.
 *
 * Chỉ chặn ở mức đã đăng nhập: hồ sơ khách không áp trục phạm vi (spec §2.1b),
 * và sidebar cũng hiện mục này cho mọi người — hai nơi phải khớp, lệch nhau thì
 * menu dẫn tới một màn bị chính nó chặn.
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const params = url.searchParams;

  return Response.json(
    await listCustomers(
      {
        search: params.get("search") ?? "",
        channelId: uuidParam(params.get("channelId")),
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
        // Nhân viên chỉ thấy khách MÌNH tạo ở bảng P-40 (chốt 2026-08-15).
        // Chỉ áp cho danh sách này: hồ sơ chi tiết, ô tìm khách của form mở
        // tài khoản / ghi dịch vụ vẫn thấy mọi khách (spec §2.1b giữ nguyên).
        createdBy: guard.actor.role === "staff" ? guard.actor.id : "",
      },
      pageArgsFrom(url, SORTABLE, "created"),
    ),
  );
}

/** P-41 · Tạo hồ sơ khách. */
export async function POST(request: Request) {
  const guard = await actorWith(request, "customer", "create");
  if (!guard.ok) return guard.response;

  const parsed = CustomerForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createCustomer(guard.actor, parsed.data);
  if (!result.ok) {
    // Không có hồ sơ trùng để chỉ ra thì khoá duy nhất bị đụng là số điện thoại
    // chính — nói "CCCD trùng" lúc đó là chỉ sai chỗ.
    if (!result.existing) return badRequest("Không lưu được hồ sơ khách này");
    return Response.json(
      {
        code: CUSTOMER_ERROR.DUPLICATE_ID,
        message: "CCCD này đã có hồ sơ trong hệ thống",
        existing: result.existing,
      },
      { status: 422 },
    );
  }

  await logAudit(guard.actor, {
    module: "customer",
    action: "create",
    targetLabel: `Thêm khách hàng ${result.customer.fullName}`,
    targetTable: "customers",
    targetId: result.customer.id,
  });
  return Response.json(result.customer, { status: 201 });
}
