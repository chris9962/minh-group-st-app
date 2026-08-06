import { and, asc, count, desc, eq, sql, type SQL } from "drizzle-orm";
import type { AuditLogEntry, AuditLogSort } from "@/lib/api/auditLog";
import type { Page } from "@/lib/api/pagination";
import { BUSINESS_TIMEZONE } from "@/lib/format";
import { db } from "./db/client";
import { auditLog, users } from "./db/schema";
import type { PageArgs } from "./pagination";
import { Action, type ModuleKey, type User } from "@/lib/types";

/**
 * Ghi nhật ký truy vết (P-93) — append-only, không có đường sửa/xoá.
 * Ghi cho mọi thao tác GHI và các lượt xem nhạy cảm (chi tiết nhân viên…).
 */
export async function logAudit(
  actor: User,
  entry: {
    module: ModuleKey;
    action: Action;
    targetLabel: string;
    targetTable?: string;
    targetId?: string;
  },
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorId: actor.id,
      module: entry.module,
      action: entry.action,
      targetLabel: entry.targetLabel,
      targetTable: entry.targetTable ?? null,
      targetId: entry.targetId ?? null,
    });
  } catch (e) {
    /**
     * Hàm này chạy SAU khi bản ghi nghiệp vụ đã commit. Để lỗi ném ra thì
     * route trả 500 cho một thao tác THỰC RA ĐÃ THÀNH CÔNG, người dùng bấm lại
     * và tạo trùng. Mất một dòng nhật ký đỡ tệ hơn tạo trùng dữ liệu thật.
     *
     * ⚠️ Đây mới là nửa vá. Muốn nhật ký thật sự nguyên tử thì phải truyền
     * transaction của lệnh ghi vào đây, tức là dời `logAudit` từ route xuống
     * trong `writeStaff` / `createDepartment` — đổi rộng hơn, chưa làm.
     */
    console.error("[audit] không ghi được nhật ký truy vết:", entry, e);
  }
}

/* ── Chiều ĐỌC — màn P-93 ─────────────────────────────────────────────── */

export type AuditLogFilters = {
  /** Người thực hiện. Rỗng = mọi người. */
  staffId: string;
  /** Chuỗi rỗng hoặc khoá lạ đều thành "mọi hành động" — xem `actionFilter`. */
  action: string;
  from: string;
  to: string;
};

const YEAR_MONTH_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Khoảng ngày so THẲNG trên cột `at`, không bọc `at time zone` quanh nó.
 *
 * Bọc hàm quanh cột là mất chỉ mục `audit_log_at` — Postgres phải đọc từng dòng
 * để tính lại ngày. Nên đổi chiều: quy hai đầu mốc NGÀY (giờ Việt Nam) thành hai
 * mốc `timestamptz` rồi so nguyên cột. Khác `server/customers.ts` ở chỗ đó, và
 * khác có chủ ý — `customers` nhỏ hơn `audit_log` vài bậc.
 *
 * Đầu `to` lấy 0h ngày HÔM SAU và so `<`, không phải `<= to`: so `<=` với một
 * cột thời điểm thì mất trọn ngày cuối trừ đúng giây đầu tiên.
 *
 * ⚠️ Phải ép `::timestamp` TRƯỚC `at time zone`, và đây là chỗ đã sai một lần.
 * `AT TIME ZONE` chạy hai chiều ngược nhau tuỳ kiểu vế trái: với `timestamptz`
 * nó ĐỔI SANG giờ địa phương và trả `timestamp` trần, còn với `timestamp` trần
 * nó HIỂU con số đó là giờ địa phương và trả `timestamptz`. Ở đây cần chiều
 * thứ hai. Viết `date at time zone` thì `date` ngầm thành `timestamptz` theo
 * múi giờ phiên (UTC) nên rơi vào chiều thứ nhất: mốc "0h ngày 06/08 giờ VN"
 * ra `2026-08-06 07:00 UTC` thay vì `2026-08-05 17:00 UTC`, lệch 14 tiếng SAI
 * HƯỚNG — lọc đúng ngày hôm nay trả về 0 dòng trong khi bảng có dữ liệu.
 */
const dateRange = (from: string, to: string): (SQL | undefined)[] => [
  // Ngày sai định dạng thì bỏ qua, không trả 400 — link cũ hay ô địa chỉ gõ
  // nhầm không đáng làm hỏng cả màn (cùng lối nghĩ với `uuidParam`).
  YEAR_MONTH_DAY.test(from)
    ? sql`${auditLog.at} >= ((${from}::date)::timestamp at time zone ${BUSINESS_TIMEZONE})`
    : undefined,
  YEAR_MONTH_DAY.test(to)
    ? sql`${auditLog.at} < ((${to}::date + 1)::timestamp at time zone ${BUSINESS_TIMEZONE})`
    : undefined,
];

/**
 * ⚠️ Lọc theo hành động KHÔNG có chỉ mục đỡ (`audit_log` chỉ có `(at desc)` và
 * `(actor_id, at desc)`). Postgres quét ngược chỉ mục thời gian rồi bỏ dòng
 * không khớp: rẻ với hành động thường gặp, đắt dần với hành động hiếm vì phải
 * đi ngược rất xa mới gom đủ 15 dòng. Ghép thêm khoảng ngày là chặn được đường
 * đi ấy — đó là lý do màn P-93 chọn sẵn một khoảng ngày.
 */
const actionFilter = (raw: string): SQL | undefined => {
  const parsed = Action.safeParse(raw);
  return parsed.success ? eq(auditLog.action, parsed.data) : undefined;
};

const auditFilters = (query: AuditLogFilters): SQL | undefined => {
  const parts = [
    query.staffId ? eq(auditLog.actorId, query.staffId) : undefined,
    actionFilter(query.action),
    ...dateRange(query.from, query.to),
  ].filter(Boolean) as SQL[];

  return parts.length > 0 ? and(...parts) : undefined;
};

/**
 * Chọn ĐÚNG 15 dòng của trang, chỉ đụng `audit_log`.
 *
 * Tên người dán vào sau (`decorate`) chứ không nối `users` ngay từ đây: nối
 * trước là bắt Postgres ghép tên cho mọi dòng khớp bộ lọc rồi mới cắt trang —
 * cách A ở AGENTS.md §5.2, giống `pickPage`/`decorate` của `server/customers.ts`.
 */
const pickPage = (where: SQL | undefined, orderBy: SQL[], limit: number, offset: number) =>
  db
    .select({
      id: auditLog.id,
      // Cột tính bằng `sql` trong truy vấn con BẮT BUỘC có bí danh, không thì
      // câu ngoài không gọi tên nó được.
      at: sql<string>`to_char(${auditLog.at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.as(
        "at_iso",
      ),
      actorId: auditLog.actorId,
      module: auditLog.module,
      action: auditLog.action,
      targetLabel: auditLog.targetLabel,
    })
    .from(auditLog)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset)
    .as("page");

/** Dán tên người thực hiện cho đúng 15 dòng — 15 lượt tra khoá chính `users`. */
const decorate = (page: ReturnType<typeof pickPage>) =>
  db
    .select({
      id: page.id,
      at: page.at,
      actorId: page.actorId,
      actorName: users.fullName,
      actorUsername: users.username,
      module: page.module,
      action: page.action,
      targetLabel: page.targetLabel,
    })
    .from(page)
    .innerJoin(users, eq(users.id, page.actorId));

/**
 * MỘT trang nhật ký truy vết (P-93).
 *
 * KHÔNG có bản "lấy hết" và sẽ không bao giờ có: `audit_log` là bảng phình
 * nhanh nhất hệ thống, phân trang ở đây là bắt buộc tuyệt đối
 * (mgst-db-design.md §11 điều 6).
 *
 * ⚠️ Câu đếm `total` chạy trên đúng bộ lọc, nên KHÔNG lọc ngày nghĩa là đếm cả
 * bảng — một lượt quét chỉ mục toàn phần, dài dần theo tuổi hệ thống. Chấp nhận
 * được vì thanh phân trang cần con số thật (§5.1 điều 1) và màn này chỉ vài
 * người mở; ngày nó thành chậm thì cách chữa là ép một khoảng ngày bắt buộc,
 * không phải thêm chỉ mục.
 */
export async function listAuditLog(
  filters: AuditLogFilters,
  page: PageArgs<AuditLogSort>,
): Promise<Page<AuditLogEntry>> {
  const where = auditFilters(filters);
  const direction = page.dir === "asc" ? asc : desc;

  /**
   * `id` làm khoá phụ: trang 1 và trang 2 là hai câu hỏi riêng biệt, không có
   * khoá duy nhất ở cuối thì thứ tự giữa những dòng cùng `at` là không xác định
   * — một dòng hiện lại ở trang sau còn dòng khác biến mất khỏi cả hai.
   */
  const orderBy = [direction(auditLog.at), asc(auditLog.id)] as SQL[];

  const [rows, [totals]] = await Promise.all([
    decorate(pickPage(where, orderBy, page.limit, page.offset)),
    db.select({ value: count() }).from(auditLog).where(where),
  ]);

  return { rows, total: totals?.value ?? 0 };
}
