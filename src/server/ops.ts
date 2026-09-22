import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import {
  OPS_DAY_RANGES,
  OPS_DEFAULT_DAYS,
  type OpsBankCheck,
  type OpsCertificateRow,
  type OpsHost,
  type OpsRecreateBody,
  type OpsRecreateOutcome,
  type OpsRecreateResult,
  type OpsSummary,
} from "@/lib/api/ops";
import { businessDay } from "@/lib/format";
import { can } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { logAudit } from "./audit";
import { db } from "./db/client";
import { hostMetrics, insuranceOrders } from "./db/schema";
import { cancelInsuranceOrder, recreateInsuranceOrder } from "./insurance";
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
 * Đơn đang chờ giấy chứng nhận, lâu nhất đứng đầu.
 *
 * Mốc chờ là lượt đổi trạng thái SANG `awaiting-certificate`, đọc bằng câu con
 * theo `order_id` — không phải `updated_at`, vì cột đó còn đổi theo mọi lượt sửa
 * khác của đơn.
 *
 * Trần 200 dòng: đây là màn theo dõi, không phải bảng tra cứu. Quá 200 đơn kẹt
 * thì con số tổng đã nói đủ, không ai cần đọc từng dòng.
 */
async function awaitingCertificate(actor: User): Promise<{
  awaiting: number;
  rows: OpsCertificateRow[];
}> {
  const rows = await db.execute<{
    id: string;
    order_code: string;
    customer_name: string;
    package_name: string;
    created_by_name: string | null;
    waiting_since: Date;
    start_date: string;
    created_day: string;
    intake_photo_url: string | null;
  }>(sql`
    select
      o.id, o.order_code, cu.full_name as customer_name, o.package_name,
      u.full_name as created_by_name, o.intake_photo_url,
      coalesce(h.changed_at, o.created_at) as waiting_since,
      o.start_date,
      to_char(o.created_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') as created_day
    from insurance_orders o
    join customers cu on cu.id = o.customer_id
    left join users u on u.id = o.created_by
    left join lateral (
      select max(s.changed_at) as changed_at
      from insurance_order_status_history s
      where s.order_id = o.id and s.to_status = 'awaiting-certificate'
    ) h on true
    where o.status = 'awaiting-certificate'
    order by waiting_since asc
    limit 200
  `);

  const [total] = (
    await db.execute<{ n: string }>(
      sql`select count(*) as n from insurance_orders where status = 'awaiting-certificate'`,
    )
  ).rows;

  const today = businessDay();
  const canOverride = can(actor, "insurance", "set-status");
  const now = Date.now();

  return {
    awaiting: Number(total?.n ?? 0),
    rows: rows.rows.map((r) => {
      const waitingSince = new Date(r.waiting_since);
      // Hai luật giữ nguyên (chốt 2026-09-22). Tính TRƯỚC ở đây để người bấm
      // thấy đơn nào làm được, thay vì huỷ xong mới biết không tạo lại được.
      const blockedReason = !canOverride && r.created_day !== today
        ? "Đơn lập ngày khác, cần quyền sửa trạng thái đơn bảo hiểm"
        : r.start_date < today
          ? "Ngày bắt đầu đã qua, PVI từ chối đơn mới"
          : !r.intake_photo_url
            ? "Đơn cũ không có ảnh hồ sơ, đơn mới bắt buộc phải có"
            : "";

      return {
        id: r.id,
        orderCode: r.order_code,
        customerName: r.customer_name,
        packageName: r.package_name,
        createdByName: r.created_by_name ?? "",
        waitingSince: waitingSince.toISOString(),
        waitingMinutes: Math.floor((now - waitingSince.getTime()) / 60_000),
        startDate: r.start_date,
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

export async function opsSummary(actor: User, days: number): Promise<OpsSummary> {
  const [photoCheck, insurance, host] = await Promise.all([
    photoCheckStats(days),
    awaitingCertificate(actor),
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
      results.push({ id, orderCode: "", ok: false, message: "Đơn vừa đổi trạng thái, bỏ qua" });
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
