import { and, asc, desc, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { InsuranceOrderStatus } from "@/lib/api/insuranceOrders";
import {
  OPS_DAY_RANGES,
  OPS_DEFAULT_DAYS,
  type OpsBankCheck,
  type OpsHost,
  type OpsInsurance,
  type OpsOrderFilter,
  type OpsOrderRow,
  type OpsOrderSort,
  type OpsRecreateBody,
  type OpsRecreateOutcome,
  type OpsRecreateResult,
  type OpsRefreshBody,
  type OpsSummary,
} from "@/lib/api/ops";
import type { Page } from "@/lib/api/pagination";
import { businessDay } from "@/lib/format";
import { can } from "@/lib/permissions";
import { searchTerms } from "@/lib/search";
import { InsuranceProduct, type User } from "@/lib/types";
import { logAudit } from "./audit";
import { db } from "./db/client";
import {
  customers,
  hostMetrics,
  insuranceOrders,
  insuranceOrderStatusHistory,
} from "./db/schema";
import { cancelInsuranceOrder, recreateInsuranceOrder } from "./insurance";
import type { PageArgs } from "./pagination";
import { PVI_NEW_ORDER_CHANNEL } from "./pvi-api/route";
import { imageUrl } from "./storage";

/**
 * P-99 · Số liệu vận hành. Mọi câu ở đây là câu GỘP toàn công ty, không cắt
 * theo phòng — người cầm `system:view-ops` nhìn cả hệ thống hoặc không nhìn gì.
 */

/** Số ngày lạ rơi về mặc định, không trả 400 (AGENTS.md §5.1 điều 2). */
export const opsDaysFrom = (raw: string | null): number => {
  const n = Number(raw);
  return (OPS_DAY_RANGES as readonly number[]).includes(n) ? n : OPS_DEFAULT_DAYS;
};

/**
 * Hàng đợi kiểm ảnh và kết quả theo ngân hàng.
 *
 * `pending` KHÔNG kẹp theo khoảng ngày: hàng đợi là chuyện của hiện tại, một
 * lượt kẹt từ tuần trước vẫn phải hiện ra. Ba cột còn lại kẹp, vì chúng là
 * thống kê của khoảng đang chọn.
 *
 * Luật "đạt" chép ĐÚNG `photoCheckFilter` ở `photoCheck.ts`: xác nhận tay của
 * người duyệt thắng điểm máy. Hai nơi tính khác nhau thì màn này và màn Ngân
 * hàng nói hai con số khác nhau về cùng một tài khoản.
 */
async function photoCheckStats(days: number) {
  const rows = await db.execute<{
    bank_id: string;
    code: string;
    pending: string;
    passed: string;
    failed: string;
    error: string;
  }>(sql`
    select
      b.id as bank_id, b.code,
      count(*) filter (where c.status = 'pending') as pending,
      count(*) filter (
        where c.status = 'done' and c.created_at >= now() - ${`${days} days`}::interval
          and ((c.total > 0 and c.passed = c.total) or c.confirmed_at is not null)
      ) as passed,
      count(*) filter (
        where c.status = 'done' and c.created_at >= now() - ${`${days} days`}::interval
          and c.passed < c.total and c.confirmed_at is null
      ) as failed,
      count(*) filter (
        where c.status = 'failed' and c.created_at >= now() - ${`${days} days`}::interval
      ) as error
    from bank_account_checks c
    join bank_accounts a on a.id = c.account_id
    join banks b on b.id = a.bank_id
    where c.status = 'pending' or c.created_at >= now() - ${`${days} days`}::interval
    group by b.id, b.code
    order by b.code
  `);

  const [queue] = (
    await db.execute<{ pending: string; oldest: Date | null }>(sql`
      select count(*) as pending, min(created_at) as oldest
      from bank_account_checks where status = 'pending'
    `)
  ).rows;

  const banks: OpsBankCheck[] = rows.rows.map((r) => ({
    bankId: r.bank_id,
    bankCode: r.code,
    pending: Number(r.pending),
    passed: Number(r.passed),
    failed: Number(r.failed),
    error: Number(r.error),
  }));

  return {
    pending: Number(queue?.pending ?? 0),
    oldestPendingAt: queue?.oldest ? new Date(queue.oldest).toISOString() : "",
    banks,
  };
}

/**
 * Số đơn đang đợi GCN và đơn đợi lâu nhất — hai thẻ đầu khối bảo hiểm.
 *
 * Mốc chờ là lượt đổi trạng thái SANG `awaiting-certificate`, đọc bằng câu con
 * theo `order_id` — không phải `updated_at`, vì cột đó còn đổi theo mọi lượt sửa
 * khác của đơn.
 *
 * Tách khỏi bảng đơn: bảng lọc được sang trạng thái khác, còn hai thẻ này luôn
 * nói về hàng đợi GCN.
 */
async function awaitingCertificate(): Promise<OpsInsurance> {
  const [oldest] = (
    await db.execute<{ order_code: string; customer_name: string; waiting_since: Date }>(sql`
      select o.order_code, cu.full_name as customer_name,
        coalesce(h.changed_at, o.created_at) as waiting_since
      from insurance_orders o
      join customers cu on cu.id = o.customer_id
      left join lateral (
        select max(s.changed_at) as changed_at
        from insurance_order_status_history s
        where s.order_id = o.id and s.to_status = 'awaiting-certificate'
      ) h on true
      where o.status = 'awaiting-certificate'
      order by waiting_since asc
      limit 1
    `)
  ).rows;

  const [total] = (
    await db.execute<{ n: string }>(
      sql`select count(*) as n from insurance_orders where status = 'awaiting-certificate'`,
    )
  ).rows;

  return {
    awaiting: Number(total?.n ?? 0),
    oldest: oldest
      ? {
          orderCode: oldest.order_code,
          customerName: oldest.customer_name,
          waitingMinutes: Math.floor(
            (Date.now() - new Date(oldest.waiting_since).getTime()) / 60_000,
          ),
        }
      : null,
  };
}

/** Giá trị lạ trên URL thì bỏ lọc trục đó, không trả 400 (AGENTS.md §5.1 điều 2). */
export function opsOrderFilterFrom(url: URL): OpsOrderFilter {
  const product = InsuranceProduct.safeParse(url.searchParams.get("product"));
  const status = InsuranceOrderStatus.safeParse(url.searchParams.get("status"));
  return {
    product: product.success ? product.data : "",
    status: status.success ? status.data : "",
    search: url.searchParams.get("search") ?? "",
  };
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Mỗi từ khớp mã đơn, ID đơn hoặc tên khách. Tên khách đi `exists` trên
 * `search_name` như danh sách đơn P-13, để câu cắt trang không phải nối bảng
 * khách. ID so theo chuỗi con vì bảng chỉ hiện 4 ký tự đầu và 4 ký tự cuối.
 */
function opsSearchWhere(raw: string): SQL | undefined {
  const terms = searchTerms(raw.trim());
  if (terms.length === 0) return undefined;
  return and(
    ...terms.map((term) =>
      or(
        sql`exists (
          select 1 from ${customers} c
          where c.id = ${insuranceOrders.customerId}
            and c.search_name like '%' || mgst_normalize(${likeEscape(term)}) || '%' escape '\\'
        )`,
        sql`${insuranceOrders.orderCode} ilike '%' || ${likeEscape(term)} || '%' escape '\\'`,
        sql`${insuranceOrders.id}::text ilike '%' || ${likeEscape(term)} || '%' escape '\\'`,
      ),
    ),
  );
}

/**
 * Một trang đơn cho bảng P-99, mọi trạng thái.
 *
 * Cắt trang trên `insurance_orders` trước rồi mới nối tên khách
 * cho đúng 15 dòng (AGENTS.md §5.2, cách A).
 */
export async function listOpsOrders(
  actor: User,
  filter: OpsOrderFilter,
  args: PageArgs<OpsOrderSort>,
): Promise<Page<OpsOrderRow>> {
  const where = and(
    filter.product ? eq(insuranceOrders.product, filter.product) : undefined,
    filter.status ? eq(insuranceOrders.status, filter.status) : undefined,
    opsSearchWhere(filter.search),
  );

  const picked = db
    .select({
      id: insuranceOrders.id,
      orderCode: insuranceOrders.orderCode,
      customerId: insuranceOrders.customerId,
      product: insuranceOrders.product,
      status: insuranceOrders.status,
      startDate: insuranceOrders.startDate,
      intakePhotoUrl: insuranceOrders.intakePhotoUrl,
      createdAt: insuranceOrders.createdAt,
    })
    .from(insuranceOrders)
    .where(where)
    .orderBy(args.dir === "asc" ? asc(insuranceOrders.orderCode) : desc(insuranceOrders.orderCode))
    .limit(args.limit)
    .offset(args.offset)
    .as("picked");

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: picked.id,
        orderCode: picked.orderCode,
        product: picked.product,
        status: picked.status,
        startDate: picked.startDate,
        intakePhotoUrl: picked.intakePhotoUrl,
        createdDay: sql<string>`to_char(${picked.createdAt} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`,
        customerName: customers.fullName,
        // Cùng câu con với danh sách đơn P-13, để hai đồng hồ đợi GCN chỉ cùng một mốc.
        awaitingSince: sql<string | null>`(
          select to_char(max(h.changed_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          from ${insuranceOrderStatusHistory} h
          where h.order_id = ${picked.id} and h.to_status = 'awaiting-certificate'
        )`,
      })
      .from(picked)
      .innerJoin(customers, eq(customers.id, picked.customerId))
      .orderBy(args.dir === "asc" ? asc(picked.orderCode) : desc(picked.orderCode)),
    db.select({ n: sql<number>`count(*)::int` }).from(insuranceOrders).where(where),
  ]);

  const today = businessDay();
  const canOverride = can(actor, "insurance", "set-status");

  return {
    total: count?.n ?? 0,
    rows: rows.map((r) => {
      // Hai luật giữ nguyên (chốt 2026-09-22). Tính TRƯỚC ở đây để người bấm
      // thấy đơn nào làm được, thay vì huỷ xong mới biết không tạo lại được.
      const blockedReason =
        r.status !== "awaiting-certificate"
          ? "Chỉ cấp lại đơn đang đợi GCN"
          : !canOverride && r.createdDay !== today
            ? "Đơn lập ngày khác, cần quyền sửa trạng thái đơn bảo hiểm"
            : r.startDate < today
              ? "Ngày bắt đầu đã qua, PVI từ chối đơn mới"
              : !r.intakePhotoUrl
                ? "Đơn cũ không có ảnh hồ sơ, đơn mới bắt buộc phải có"
                : "";

      return {
        id: r.id,
        orderCode: r.orderCode,
        customerName: r.customerName,
        product: r.product,
        status: r.status,
        awaitingSince: r.awaitingSince,
        canRecreate: blockedReason === "",
        blockedReason,
      };
    }),
  };
}

/** Hạn mức bucket để tính phần trăm. Chưa đặt thì màn chỉ hiện dung lượng đang dùng. */
const s3Quota = (): number => Math.max(0, Number(process.env.S3_QUOTA_GB ?? 0)) * 1024 ** 3;

/**
 * Số đo máy chủ mới nhất, `null` khi `ops:watch` chưa chạy lần nào.
 *
 * Đọc HAI dòng: dòng mới nhất cho CPU / RAM / ổ đĩa, và dòng mới nhất CÓ số S3
 * cho khối S3. Lượt đo S3 chạy thưa hơn nhiều nên dòng mới nhất thường để trống
 * ba cột đó; lấy nguyên một dòng là khối S3 trống gần như mọi lúc.
 */
async function hostSnapshot(): Promise<OpsHost | null> {
  const [latest] = await db.select().from(hostMetrics).orderBy(desc(hostMetrics.at)).limit(1);
  if (!latest) return null;

  const [withS3] = await db
    .select({ bytes: hostMetrics.s3Bytes, objects: hostMetrics.s3Objects, at: hostMetrics.s3At })
    .from(hostMetrics)
    .where(isNotNull(hostMetrics.s3Bytes))
    .orderBy(desc(hostMetrics.at))
    .limit(1);

  return {
    at: latest.at.toISOString(),
    cpuPercent: Number(latest.cpuPercent),
    ramUsed: latest.ramUsed,
    ramTotal: latest.ramTotal,
    diskUsed: latest.diskUsed,
    diskTotal: latest.diskTotal,
    s3Bytes: withS3?.bytes ?? 0,
    s3Objects: withS3?.objects ?? 0,
    s3At: withS3?.at?.toISOString() ?? "",
    s3Quota: s3Quota(),
  };
}

export async function opsSummary(days: number): Promise<OpsSummary> {
  const [photoCheck, insurance, host] = await Promise.all([
    photoCheckStats(days),
    awaitingCertificate(),
    hostSnapshot(),
  ]);

  return { photoCheck, insurance, host, days };
}

/* ── Huỷ và cấp lại theo lô ─────────────────────────────────────────────── */

/**
 * Huỷ rồi cấp lại một LÔ đơn đang kẹt ở chờ giấy chứng nhận.
 *
 * Không viết đường ghi riêng: mỗi đơn đi qua đúng `cancelInsuranceOrder` rồi
 * `recreateInsuranceOrder` của màn P-14. Chép luật sang đây là dựng bộ luật thứ
 * hai, và bộ thứ hai sẽ lệch bộ thứ nhất ở lần sửa kế tiếp.
 *
 * Hai luật cũ giữ nguyên (chốt 2026-09-22), nên lô chạy tuần tự và mỗi đơn có
 * kết quả riêng. Đơn nào không cấp lại được thì KHÔNG huỷ: kiểm ngày bắt đầu
 * trước khi đụng vào đơn, nếu không đơn nằm lại ở trạng thái huỷ mà không có đơn
 * thay thế.
 */
export async function recreateStuckOrders(
  actor: User,
  body: OpsRecreateBody,
): Promise<OpsRecreateOutcome> {
  const results: OpsRecreateResult[] = [];
  const today = businessDay();

  for (const id of body.ids) {
    const [order] = await db
      .select()
      .from(insuranceOrders)
      .where(and(eq(insuranceOrders.id, id), eq(insuranceOrders.status, "awaiting-certificate")))
      .limit(1);

    if (!order) {
      results.push({ id, orderCode: "", ok: false, message: "Đơn không ở trạng thái đợi GCN, bỏ qua" });
      continue;
    }

    const code = order.orderCode;
    if (order.startDate < today) {
      results.push({
        id,
        orderCode: code,
        ok: false,
        message: "Ngày bắt đầu đã qua, cấp lại thì PVI từ chối",
      });
      continue;
    }

    // Kiểm TRƯỚC khi huỷ, cùng lý do với ngày bắt đầu: `recreateInsuranceOrder`
    // đòi ảnh hồ sơ, mà lúc nó từ chối thì đơn cũ đã huỷ mất rồi.
    if (!order.intakePhotoUrl) {
      results.push({
        id,
        orderCode: code,
        ok: false,
        message: "Đơn cũ không có ảnh hồ sơ, cấp lại tay ở màn đơn",
      });
      continue;
    }

    const cancelled = await cancelInsuranceOrder(actor, id, body.reason);
    if (!cancelled) {
      results.push({ id, orderCode: code, ok: false, message: "Không có quyền huỷ đơn này" });
      continue;
    }
    if (!cancelled.ok) {
      results.push({ id, orderCode: code, ok: false, message: cancelled.message });
      continue;
    }

    // Ghi nhật ký TỪNG đơn, y như lượt bấm lẻ ở P-14. Ghi một dòng cho cả lô là
    // người đọc nhật ký không tra được một đơn cụ thể đi đâu.
    await logAudit(actor, {
      module: "insurance",
      action: "set-status",
      targetLabel: `Đơn ${code} → Huỷ đơn · ${body.reason}`,
      targetTable: "insurance_orders",
      targetId: id,
    });

    const recreated = await recreateInsuranceOrder(actor, id, {
      status: body.status,
      orderDate: order.orderDate,
      fee: order.fee,
      startDate: order.startDate,
      endDate: order.endDate,
      beneficiaryName: order.beneficiaryName,
      beneficiaryDob: order.beneficiaryDob ?? "",
      beneficiaryAddress: order.beneficiaryAddress,
      householdSize: order.householdSize,
      sumInsured: order.sumInsured,
      licensePlate: order.licensePlate,
      vehicleType: order.vehicleType,
      chassisNumber: order.chassisNumber,
      engineNumber: order.engineNumber,
      intakePhotoUrl: order.intakePhotoUrl ? imageUrl(order.intakePhotoUrl) : "",
      intakePhotoBackUrl: order.intakePhotoBackUrl ? imageUrl(order.intakePhotoBackUrl) : "",
    });

    if (!recreated) {
      results.push({ id, orderCode: code, ok: false, message: "Đơn ngoài phạm vi xem của bạn" });
      continue;
    }
    if (recreated.ok)
      await logAudit(actor, {
        module: "insurance",
        action: "create",
        targetLabel: `Đơn ${recreated.value.orderCode} cấp lại cho đơn ${code} kẹt chờ giấy chứng nhận · ${recreated.value.customerName}`,
        targetTable: "insurance_orders",
        targetId: recreated.value.id,
      });

    results.push(
      recreated.ok
        ? { id, orderCode: code, ok: true, message: recreated.value.orderCode }
        : { id, orderCode: code, ok: false, message: recreated.message },
    );
  }

  return {
    done: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

/* ── Chạy lại policy theo lô ────────────────────────────────────────────── */

/**
 * Đưa một lô đơn về hàng đợi GCN để worker API hỏi lại PVI `GetPolicyNumber`
 * rồi ghi đè số hợp đồng, số GCN, số ấn chỉ và ảnh (chốt 2026-09-23).
 *
 * Có để chữa đơn mà worker đã đóng sổ với dữ liệu thiếu: worker chỉ tra đơn
 * đợi GCN hoặc huỷ chưa có ảnh, nên đơn Hoàn thành lưu GCN rỗng không bao giờ
 * được hỏi lại.
 *
 * Không tự gọi PVI ở đây: đổi PDF sang ảnh cần `pdftoppm`, và chỉ image của
 * worker có. Việc của hàm này là đặt đơn về đúng điều kiện worker nhận:
 *
 *   - `certificate_photo_url` về null — worker bỏ qua đơn đã có ảnh
 *   - `certificate_attempts` về 0, `certificate_checked_at` về null — hỏi ngay
 *   - Hoàn thành về Đợi GCN; Huỷ giữ nguyên Huỷ, vì worker giữ trạng thái huỷ
 *     khi ghi giấy, còn đưa sang Đợi GCN thì worker đẩy nó thành Hoàn thành
 *
 * Chỉ đơn đường API: `RequestId` bên PVI là `id` của đơn, đơn bot không có.
 */
export async function refreshPolicies(
  actor: User,
  body: OpsRefreshBody,
): Promise<OpsRecreateOutcome> {
  const orders = await db
    .select({
      id: insuranceOrders.id,
      orderCode: insuranceOrders.orderCode,
      status: insuranceOrders.status,
      pviRoute: insuranceOrders.pviRoute,
      pviPrKeyNumber: insuranceOrders.pviPrKeyNumber,
    })
    .from(insuranceOrders)
    .where(inArray(insuranceOrders.id, body.ids));

  const results: OpsRecreateResult[] = body.ids
    .filter((id) => !orders.some((o) => o.id === id))
    .map((id) => ({ id, orderCode: "", ok: false, message: "Không tìm thấy đơn" }));

  for (const order of orders) {
    const code = order.orderCode;
    const blocked =
      order.pviRoute !== "api"
        ? "Đơn không đi đường API, PVI không tra được"
        : order.status === "cancelled" && order.pviPrKeyNumber === null
          ? "PVI chưa nhận đơn trước lúc huỷ, không có giấy để tra"
          : !["done", "awaiting-certificate", "cancelled"].includes(order.status)
            ? "Đơn chưa qua PVI xong"
            : "";
    if (blocked) {
      results.push({ id: order.id, orderCode: code, ok: false, message: blocked });
      continue;
    }

    const reopen = order.status === "done";
    await db.transaction(async (tx) => {
      await tx
        .update(insuranceOrders)
        .set({
          certificatePhotoUrl: null,
          certificateAttempts: 0,
          certificateCheckedAt: null,
          updatedAt: new Date(),
          ...(reopen ? { status: "awaiting-certificate" as const } : {}),
        })
        .where(eq(insuranceOrders.id, order.id));
      if (reopen)
        await tx.insert(insuranceOrderStatusHistory).values({
          orderId: order.id,
          fromStatus: "done",
          toStatus: "awaiting-certificate",
          changedBy: actor.id,
          note: "Chạy lại policy: hỏi lại PVI số GCN và giấy chứng nhận.",
        });
    });

    await logAudit(actor, {
      module: "insurance",
      action: "update",
      targetLabel: `Đơn ${code} → chạy lại policy`,
      targetTable: "insurance_orders",
      targetId: order.id,
    });

    results.push({ id: order.id, orderCode: code, ok: true, message: "Đã đưa vào hàng đợi GCN" });
  }

  // Worker quét lại mỗi 10 giây nên thông báo mất cũng không sao, chỉ chậm hơn.
  if (results.some((r) => r.ok)) {
    try {
      await db.execute(sql`select pg_notify(${PVI_NEW_ORDER_CHANNEL}, '')`);
    } catch (cause) {
      console.warn("[ops] không gửi được pg_notify:", cause);
    }
  }

  return {
    done: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
