import { asc, count, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Feedback, FeedbackBody, FeedbackSort, FeedbackStatus } from "@/lib/api/feedback";
import type { Page } from "@/lib/api/pagination";
import type { User } from "@/lib/types";
import { db } from "./db/client";
import { departments, feedbacks, users } from "./db/schema";
import type { PageArgs } from "./pagination";

/**
 * P-96 · Hộp góp ý.
 *
 * Gửi thì ai đăng nhập cũng gửi được; đọc và đánh dấu đã xử lý cần
 * `system:handle-feedback`. Hai chiều gác ở route, không ở đây.
 */

const sender = alias(users, "sender");
const senderDepartment = alias(departments, "sender_department");
const handler = alias(users, "handler");

/**
 * Nối THẲNG, không tách `pickPage`/`decorate` như `server/audit.ts`.
 *
 * `ORDER BY created_at desc` đi đúng chỉ mục `feedbacks_created`, nên Postgres
 * quét chỉ mục lấy 15 dòng rồi nối sang `users`/`departments` bằng khoá chính —
 * 15 dòng đọc, không phải cả bảng. Bảng này cũng chỉ dài thêm khi có người gõ
 * tay một góp ý, khác `audit_log` phình theo từng thao tác ghi.
 *
 * Là HÀM chứ không phải một hằng dùng lại: `.where()` của drizzle sửa thẳng vào
 * đối tượng builder, nên chia chung một builder giữa các lượt gọi là bộ lọc của
 * người này dính sang câu truy vấn của người kia.
 */
const listQuery = () =>
  db
    .select({
      id: feedbacks.id,
      content: feedbacks.content,
      path: feedbacks.path,
      status: feedbacks.status,
      createdAt: feedbacks.createdAt,
      senderName: sender.fullName,
      senderDepartmentName: senderDepartment.name,
      handledByName: handler.fullName,
      handledAt: feedbacks.handledAt,
    })
    .from(feedbacks)
    .innerJoin(sender, eq(sender.id, feedbacks.userId))
    // Ban giám đốc không thuộc phòng nào (`users.department_id` null) nên phải
    // `left`: `inner` ở đây là góp ý của họ mất khỏi danh sách.
    .leftJoin(senderDepartment, eq(senderDepartment.id, sender.departmentId))
    .leftJoin(handler, eq(handler.id, feedbacks.handledBy));

type Row = {
  id: string;
  content: string;
  path: string;
  status: FeedbackStatus;
  createdAt: Date;
  senderName: string;
  senderDepartmentName: string | null;
  handledByName: string | null;
  handledAt: Date | null;
};

const toRow = (r: Row): Feedback => ({
  id: r.id,
  content: r.content,
  path: r.path,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  senderName: r.senderName,
  senderDepartmentName: r.senderDepartmentName ?? "",
  handledByName: r.handledByName ?? "",
  handledAt: r.handledAt?.toISOString() ?? "",
});

/**
 * Khoá sắp. `id` làm khoá phụ vì trang 1 và trang 2 là hai câu hỏi riêng: không
 * có khoá duy nhất ở cuối thì thứ tự giữa những dòng cùng `created_at` là không
 * xác định, và một dòng hiện lại ở trang sau còn dòng khác mất khỏi cả hai.
 *
 * ⚠️ Viết `nulls` rõ ra, khớp đúng chiều khai ở migration 0052. Hai chiều lệch
 * nhau thì planner bỏ chỉ mục — xem chú thích dài ở `server/audit.ts`.
 */
const orderKeys = (dir: "asc" | "desc"): SQL[] =>
  dir === "asc"
    ? [sql`${feedbacks.createdAt} asc nulls first`, asc(feedbacks.id)]
    : [sql`${feedbacks.createdAt} desc nulls last`, asc(feedbacks.id)];

/** Trạng thái lạ thành "mọi trạng thái", không trả 400 — cùng lối với `uuidParam`. */
const statusFilter = (raw: string): SQL | undefined =>
  raw === "pending" || raw === "done" ? eq(feedbacks.status, raw) : undefined;

const oneById = async (id: string): Promise<Feedback | null> => {
  const [row] = await listQuery().where(eq(feedbacks.id, id)).limit(1);
  return row ? toRow(row) : null;
};

/**
 * Ghi một góp ý rồi đọc lại nó qua đúng câu truy vấn của danh sách.
 *
 * Đọc lại chứ không tự ráp dòng trả về từ `actor`: `User` không mang tên phòng,
 * và ráp tay là hai chỗ dựng cùng một hình dạng dòng rồi sớm muộn lệch nhau.
 */
export async function createFeedback(actor: User, form: FeedbackBody): Promise<Feedback | null> {
  const [inserted] = await db
    .insert(feedbacks)
    .values({ userId: actor.id, content: form.content, path: form.path })
    .returning({ id: feedbacks.id });

  return oneById(inserted.id);
}

/** MỘT trang góp ý. Lọc, sắp và cắt trang đều ở máy chủ (AGENTS.md §5.1). */
export async function listFeedbacks(
  filters: { status: string },
  page: PageArgs<FeedbackSort>,
): Promise<Page<Feedback>> {
  const where = statusFilter(filters.status);

  const [rows, [totals]] = await Promise.all([
    listQuery()
      .where(where)
      .orderBy(...orderKeys(page.dir))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ value: count() }).from(feedbacks).where(where),
  ]);

  return { rows: rows.map(toRow), total: totals?.value ?? 0 };
}

/**
 * Đánh dấu đã xử lý, hoặc trả về chưa xử lý. Không tìm thấy dòng thì trả `null`.
 *
 * Trả về `pending` thì XOÁ luôn `handled_by`/`handled_at`: giữ tên người xử lý
 * cũ trên một dòng đang ghi "Chưa xử lý" là hai thông tin ngược nhau cùng dòng.
 */
export async function setFeedbackStatus(
  actor: User,
  id: string,
  status: FeedbackStatus,
): Promise<Feedback | null> {
  const [updated] = await db
    .update(feedbacks)
    .set(
      status === "done"
        ? { status, handledBy: actor.id, handledAt: new Date() }
        : { status, handledBy: null, handledAt: null },
    )
    .where(eq(feedbacks.id, id))
    .returning({ id: feedbacks.id });

  return updated ? oneById(id) : null;
}
