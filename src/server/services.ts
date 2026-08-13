import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import type { Page } from "@/lib/api/pagination";
import type { ServiceEditForm, ServiceForm, ServiceRow, ServiceSort } from "@/lib/api/services";
import { businessDay, businessMonth } from "@/lib/format";
import { recordVisibility, type RecordVisibility } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { db } from "./db/client";
import { customers, serviceTypes, services, users, wards } from "./db/schema";
import { recomputeKpi } from "./kpi";
import type { PageArgs } from "./pagination";

/**
 * P-30 · P-31 — bản DB của module dịch vụ.
 *
 * Bản ghi dịch vụ CÓ áp trục phạm vi (spec §2.1b), khác hồ sơ khách hàng. Phạm
 * vi KHÔNG đi qua đường truyền: máy chủ tự lấy mức rộng nhất người gọi được
 * cấp. Thanh chọn phạm vi đã bỏ khỏi giao diện, nên nhận thêm một tham số
 * `scope` chỉ tạo một ô để nặn tay chứ không thêm tính năng nào.
 */

/** Vô hiệu ký tự đại diện của `LIKE` — gõ `%` phải ra "không có kết quả". */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const YEAR_MONTH_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type ServiceFilters = {
  search: string;
  serviceTypeId: string;
  from: string;
  to: string;
  wardId: string;
  staffId: string;
};

/**
 * Tìm theo TÊN KHÁCH bằng `exists`, không phải bằng phép nối.
 *
 * Nối `customers` vào câu chọn trang thì bảng khách đi cùng suốt quá trình sắp
 * xếp; `exists` là phép nửa-nối, Postgres dừng ngay khi thấy một dòng khớp và
 * cột sinh `customers.search_name` có chỉ mục trigram đỡ. Cùng cách
 * `server/customers.ts` tìm theo số điện thoại.
 *
 * Mỗi từ một điều kiện VÀ, không phụ thuộc thứ tự — `tram nguyen` vẫn ra
 * `Nguyễn Thị Bích Trâm`, cùng luật với `matchesSearch` ở giao diện.
 */
function searchWhere(raw: string): SQL | undefined {
  const text = raw.trim();
  if (!text) return undefined;

  return and(
    ...text.split(/\s+/).map(
      (term) =>
        sql`exists (
          select 1 from ${customers} c
          where c.id = ${services.customerId}
            and c.search_name like '%' || mgst_normalize(${likeEscape(term)}) || '%' escape '\\'
        )`,
    ),
  );
}

/**
 * Ngày ở đây là cột `date` trần, so thẳng chuỗi `YYYY-MM-DD` là đủ.
 *
 * KHÔNG có bẫy múi giờ như `audit_log.at`: `service_date` đã là NGÀY LÀM VIỆC
 * do máy chủ ghi, không phải một thời điểm cần quy đổi.
 */
const serviceFilters = (
  visible: RecordVisibility,
  query: ServiceFilters,
): SQL | undefined => {
  const parts = [
    scopeWhere(visible),
    searchWhere(query.search),
    query.serviceTypeId ? eq(services.serviceTypeId, query.serviceTypeId) : undefined,
    // Ngày sai định dạng thì bỏ qua, không trả 400 — link cũ hay ô địa chỉ gõ
    // nhầm không đáng làm hỏng cả màn (cùng lối nghĩ với `uuidParam`).
    YEAR_MONTH_DAY.test(query.from) ? gte(services.serviceDate, query.from) : undefined,
    YEAR_MONTH_DAY.test(query.to) ? lte(services.serviceDate, query.to) : undefined,
    query.wardId ? eq(services.wardId, query.wardId) : undefined,
    query.staffId ? eq(services.createdBy, query.staffId) : undefined,
  ].filter(Boolean) as SQL[];

  return parts.length > 0 ? and(...parts) : undefined;
};

/**
 * Chọn ra ĐÚNG những dòng của trang này, chỉ đụng bảng `services`.
 *
 * Lọc, sắp và cắt trang xong hết ở đây rồi mới đi lấy tên khách, tên loại dịch
 * vụ và tên người làm. Nối ba bảng đó trước khi cắt trang là kéo chúng theo
 * suốt phép sắp xếp, để lấy về 15 dòng (AGENTS.md §5.2).
 */
const pickPage = (where: SQL | undefined, orderBy: SQL[], limit: number, offset: number) =>
  db
    .select({
      id: services.id,
      customerId: services.customerId,
      serviceTypeId: services.serviceTypeId,
      note: services.note,
      date: services.serviceDate,
      // Không hiện ở màn nào — có mặt CHỈ để câu ngoài sắp lại được, xem `orderOuter`.
      createdAt: services.createdAt,
      createdById: services.createdBy,
      createdByDepartmentId: services.createdByDepartmentId,
      wardName: services.wardName,
    })
    .from(services)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset)
    .as("page");

/** Dán tên vào 15 dòng đã chọn — ba lượt tra khoá chính, không phải phép gộp. */
const decorate = (page: ReturnType<typeof pickPage>) =>
  db
    .select({
      id: page.id,
      customerName: customers.fullName,
      serviceTypeId: page.serviceTypeId,
      serviceTypeName: serviceTypes.name,
      note: page.note,
      date: page.date,
      createdById: page.createdById,
      createdByName: users.fullName,
      createdByDepartmentId: page.createdByDepartmentId,
      wardName: page.wardName,
    })
    .from(page)
    .innerJoin(customers, eq(customers.id, page.customerId))
    .innerJoin(serviceTypes, eq(serviceTypes.id, page.serviceTypeId))
    .innerJoin(users, eq(users.id, page.createdById));

/**
 * `null` = không giới hạn phòng; `[]` = không thấy dòng nào.
 *
 * Không có quyền xem module cũng ra `[]` — `clampScope` một mình rơi về `own`,
 * mà `own` là cả phòng của người đó, nên thiếu chốt `can()` là lọt dữ liệu
 * (cùng cái bẫy đã ghi ở `server/customers.ts`).
 *
 * ⚠️ Phải kẹp theo ĐÚNG hành động đang làm, không phải luôn `view-detail`.
 *
 * Bản đầu cố định `"view-detail"` cho cả sửa, xoá và xuất. Ai được cấp
 * `view-detail` phạm vi `managed` nhưng `update` chỉ `own` vẫn sửa và XOÁ được
 * bản ghi của phòng mà họ chỉ có quyền xem — đã dựng lại được bằng tài khoản
 * thật. Và ô quyền `services:export` khi đó chỉ còn tác dụng bật/tắt nút, phạm
 * vi của nó bị bỏ qua hoàn toàn.
 */
const scopeOf = (actor: User, action: "view-detail" | "update" | "delete" | "export") =>
  recordVisibility(actor, "services", action);

/**
 * Điều kiện SQL tương ứng với phạm vi. `undefined` = không lọc (toàn công ty).
 *
 * Nhánh `none` trả `false` chứ không phải `undefined`: nơi gọi đã chặn từ trước,
 * nhưng nếu lỡ lọt tới đây thì "không thấy gì" phải ra bảng trống, không phải
 * ra cả kho.
 */
const scopeWhere = (v: RecordVisibility): SQL | undefined => {
  switch (v.kind) {
    case "all":
      return undefined;
    case "departments":
      return inArray(services.createdByDepartmentId, v.departmentIds);
    case "creator":
      // `chỉ mình` = do chính mình ghi (spec §1.1.2), không phải cả phòng.
      return eq(services.createdBy, v.userId);
    default:
      return sql`false`;
  }
};

/** Bản ghi này có nằm trong tầm của người gọi không. */
const inScope = (
  v: RecordVisibility,
  row: { createdById: string; createdByDepartmentId: string | null },
): boolean => {
  switch (v.kind) {
    case "all":
      return true;
    case "departments":
      return (
        row.createdByDepartmentId !== null &&
        v.departmentIds.includes(row.createdByDepartmentId)
      );
    case "creator":
      return row.createdById === v.userId;
    default:
      return false;
  }
};

/**
 * Ba khoá, và cả ba đều cần thiết.
 *
 * `service_date` là thứ người dùng chọn sắp. Nhưng nó là kiểu `date` — không có
 * giờ — nên MỌI dịch vụ ghi trong cùng một ngày đều hoà, mà một ngày bình thường
 * có hàng chục dòng như vậy.
 *
 * `created_at` phá hoà theo đúng thứ tự người dùng mong đợi: dòng vừa ghi nằm
 * trên. Thiếu nó thì khoá phá hoà còn lại là `id` — uuid NGẪU NHIÊN — và thứ tự
 * trong ngày đọc ra như xáo bài (migration 0018).
 *
 * `id` vẫn phải đứng cuối: không có khoá duy nhất ở cuối thì một dòng hiện lại ở
 * trang sau còn dòng khác biến mất khỏi cả hai trang.
 */
const orderByDate = (
  t: { date: SQLWrapper; at: SQLWrapper; id: SQLWrapper },
  dir: "asc" | "desc",
): SQL[] =>
  dir === "asc" ? [asc(t.date), asc(t.at), asc(t.id)] : [desc(t.date), desc(t.at), asc(t.id)];

/**
 * Một trang ĐÃ sắp đúng ở CẢ HAI TẦNG.
 *
 * ⚠️ PHÉP NỐI KHÔNG GIỮ THỨ TỰ — câu con sắp xong rồi cắt trang, nhưng câu ngoài
 * nối ba bảng và Postgres chọn Hash Join thì thứ tự đầu vào biến mất sạch. Nó
 * "chạy đúng" khi ít dữ liệu chỉ vì kế hoạch tình cờ là Nested Loop.
 *
 * Hai tầng gọi CHUNG một `orderByDate`, chỉ khác nguồn cột — chép quy tắc ra hai
 * chỗ là có ngày chúng lệch nhau.
 */
const orderedPage = (
  where: SQL | undefined,
  dir: "asc" | "desc",
  limit: number,
  offset: number,
) => {
  const page = pickPage(
    where,
    orderByDate({ date: services.serviceDate, at: services.createdAt, id: services.id }, dir),
    limit,
    offset,
  );
  return decorate(page).orderBy(
    ...orderByDate({ date: page.date, at: page.createdAt, id: page.id }, dir),
  );
};

/** MỘT trang dịch vụ, đã lọc/tìm/sắp sẵn ở máy chủ (AGENTS.md §5.1). */
export async function listServices(
  actor: User,
  filters: ServiceFilters,
  page: PageArgs<ServiceSort>,
): Promise<Page<ServiceRow>> {
  const visible = scopeOf(actor, "view-detail");
  if (visible.kind === "none") return { rows: [], total: 0 };

  const where = serviceFilters(visible, filters);
  const [rows, [totals]] = await Promise.all([
    orderedPage(where, page.dir, page.limit, page.offset),
    db.select({ value: count() }).from(services).where(where),
  ]);

  return { rows, total: totals?.value ?? 0 };
}

/**
 * TRỌN danh sách khớp bộ lọc, cho việc xuất Excel — đường riêng chứ KHÔNG mở
 * tham số "lấy hết" trên route đã phân trang (AGENTS.md §5.1, điều 4).
 *
 * Có trần, khác bản xuất nhân sự: `services` là bảng nghiệp vụ lớn thêm mỗi
 * ngày làm việc, không bị chặn tự nhiên bởi sĩ số công ty. Chạm trần thì `total`
 * nói ra sự thật và nơi gọi BẮT BUỘC so hai số — đưa ra file thiếu 5.000 dòng
 * mà không nói gì thì người nhận đọc nó như báo cáo đầy đủ.
 */
const EXPORT_LIMIT = 20_000;

export async function listServicesForExport(
  actor: User,
  filters: ServiceFilters,
): Promise<Page<ServiceRow>> {
  const visible = scopeOf(actor, "export");
  if (visible.kind === "none") return { rows: [], total: 0 };

  const where = serviceFilters(visible, filters);
  const [rows, [totals]] = await Promise.all([
    orderedPage(where, "desc", EXPORT_LIMIT, 0),
    db.select({ value: count() }).from(services).where(where),
  ]);

  return { rows, total: totals?.value ?? 0 };
}

export type ServiceOutcome =
  | { ok: true; service: ServiceRow }
  | { ok: false; message: string };

const serviceById = async (id: string): Promise<ServiceRow | null> =>
  (await decorate(pickPage(eq(services.id, id), [], 1, 0)))[0] ?? null;

/**
 * Ghi một lượt dịch vụ đã làm.
 *
 * Biểu mẫu chỉ gửi khách + loại + ghi chú. NGƯỜI THỰC HIỆN, NGÀY, ĐƠN VỊ và XÃ
 * đều do máy chủ tự ghi — nhận chúng từ client là mở đường ghi tên người khác
 * vào công của mình.
 */
export async function createService(actor: User, form: ServiceForm): Promise<ServiceOutcome> {
  const [type] = await db
    .select({ id: serviceTypes.id, active: serviceTypes.active })
    .from(serviceTypes)
    .where(eq(serviceTypes.id, form.serviceTypeId))
    .limit(1);
  if (!type) return { ok: false, message: "Loại dịch vụ này không còn trong danh mục" };
  // Danh mục đã ngừng thì không ghi mới được, nhưng dòng CŨ vẫn giữ nguyên —
  // ngừng một loại dịch vụ không được xoá lịch sử đã làm.
  if (!type.active) return { ok: false, message: "Loại dịch vụ này đã ngừng dùng" };

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, form.customerId))
    .limit(1);
  if (!customer) return { ok: false, message: "Không tìm thấy khách hàng này" };

  /**
   * Xã chỉ chụp khi người làm thuộc Phòng Dự Án — `users.ward_id` chỉ họ mới có.
   * Chụp cả id lẫn TÊN: lọc thì cần id (xã đổi tên vẫn tìm ra), còn hiển thị lại
   * cần tên của thời điểm đó (spec §6 — đổi xã phụ trách không được làm đổi dữ
   * liệu tháng trước).
   */
  const ward = actor.wardId
    ? ((await db.select({ name: wards.name }).from(wards).where(eq(wards.id, actor.wardId)).limit(1))[0] ?? null)
    : null;

  // Ngày người nhập chọn (chốt 07/08). Máy chủ chỉ chặn ngày TƯƠNG LAI: đây là
  // sổ ghi việc ĐÃ LÀM. Ngày lùi để tự do — nhân viên nhập trễ là chuyện thường,
  // và mọi lượt ghi đều nằm trong nhật ký truy vết.
  const serviceDate = form.date;
  if (serviceDate > businessDay())
    return { ok: false, message: "Ngày thực hiện không được ở tương lai" };

  const [row] = await db
    .insert(services)
    .values({
      customerId: form.customerId,
      serviceTypeId: form.serviceTypeId,
      note: form.note,
      serviceDate,
      createdBy: actor.id,
      // Đơn vị của người tạo lúc tạo. Người này chuyển phòng thì `writeStaff`
      // viết lại cột này cho mọi dòng của họ (chốt 13/08).
      createdByDepartmentId: actor.departmentId,
      wardId: actor.wardId,
      wardName: ward?.name ?? null,
    })
    .returning({ id: services.id });

  // Điểm dịch vụ = Σ hệ số loại dịch vụ trong kỳ, nên ghi xong phải tính lại
  // ngay; để lệ thuộc một lượt chạy sau là điểm đứng im mà không ai báo.
  await recomputeKpi(actor.id, businessMonth(new Date(`${serviceDate}T00:00:00+07:00`)));

  return { ok: true, service: (await serviceById(row.id))! };
}

/**
 * Sửa một lượt dịch vụ đã ghi — chỉ LOẠI DỊCH VỤ và GHI CHÚ.
 *
 * Khách, người thực hiện, ngày, đơn vị và xã đều KHÔNG sửa được. Chúng là ảnh
 * chụp của một việc đã xảy ra: đổi khách là biến bản ghi này thành một việc
 * khác hẳn, còn đổi người thực hiện là chuyển công sang người khác.
 *
 * Đổi loại dịch vụ là ĐỔI ĐIỂM KPI — hệ số nằm ở loại (spec §7.2) — nên phải
 * tính lại ngay, cho NGƯỜI ĐÃ LÀM và THÁNG CỦA BẢN GHI.
 */
export async function updateService(
  actor: User,
  id: string,
  form: ServiceEditForm,
): Promise<ServiceOutcome | null> {
  const visible = scopeOf(actor, "update");
  if (visible.kind === "none") return null;

  const current = await serviceById(id);
  if (!current || !inScope(visible, current)) return null;

  const [type] = await db
    .select({ id: serviceTypes.id, active: serviceTypes.active })
    .from(serviceTypes)
    .where(eq(serviceTypes.id, form.serviceTypeId))
    .limit(1);
  if (!type) return { ok: false, message: "Loại dịch vụ này không còn trong danh mục" };
  // Cho giữ NGUYÊN loại đã ngừng nếu người dùng không đổi nó — chặn ở đây thì
  // sửa mỗi ghi chú của một bản ghi cũ cũng không lưu nổi.
  if (!type.active && form.serviceTypeId !== current.serviceTypeId)
    return { ok: false, message: "Loại dịch vụ này đã ngừng dùng" };

  if (form.date > businessDay())
    return { ok: false, message: "Ngày thực hiện không được ở tương lai" };

  await db
    .update(services)
    .set({ serviceTypeId: form.serviceTypeId, serviceDate: form.date, note: form.note })
    .where(eq(services.id, id));

  /**
   * Tính lại CẢ HAI THÁNG khi ngày bị dời sang tháng khác.
   *
   * Chỉ tính tháng cũ thì tháng mới không biết mình vừa nhận thêm một lượt; chỉ
   * tính tháng mới thì tháng cũ giữ nguyên điểm của một lượt đã dời đi — điểm
   * được đếm hai lần, và đó là thứ dính tới lương.
   */
  const months = new Set([current.date.slice(0, 7), form.date.slice(0, 7)]);
  for (const month of months) await recomputeKpi(current.createdById, month);

  return { ok: true, service: (await serviceById(id))! };
}

/**
 * Xoá hẳn, không có trạng thái "đã huỷ" — cùng lối với tài khoản ngân hàng bỏ
 * dở (spec §4.5).
 *
 * Trả `null` khi không tìm thấy HOẶC nằm ngoài tầm nhìn: 404 giống hệt nhau để
 * endpoint không thành chỗ dò id có thật.
 */
export async function deleteService(actor: User, id: string): Promise<ServiceRow | null> {
  const visible = scopeOf(actor, "delete");
  if (visible.kind === "none") return null;

  const current = await serviceById(id);
  if (!current || !inScope(visible, current)) return null;

  await db.delete(services).where(eq(services.id, id));

  // Tính lại điểm của NGƯỜI ĐÃ LÀM và THÁNG CỦA BẢN GHI, không phải của người
  // bấm xoá và tháng hiện tại — quản lý xoá hộ một dòng của tháng trước là ca
  // có thật.
  await recomputeKpi(current.createdById, current.date.slice(0, 7));

  return current;
}
