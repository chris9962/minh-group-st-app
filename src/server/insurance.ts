import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type {
  InsuranceDetail,
  InsuranceListRow,
  InsuranceOrder,
  InsuranceSort,
} from "@/lib/api/insurance";
import {
  CERTIFICATE_MAX_ATTEMPTS,
  InsuranceOrderStatus,
  insuranceOrderEditSchema,
  type InsuranceManualStep,
  type InsuranceOrderForm,
} from "@/lib/api/insuranceOrders";
import type { Page } from "@/lib/api/pagination";
import { businessDay, businessMonth } from "@/lib/format";
import {
  can,
  recordInScope,
  recordVisibility,
  type RecordVisibility,
} from "@/lib/permissions";
import { InsuranceProduct, isRealIsoDate, type User } from "@/lib/types";
import { db } from "./db/client";
import { departmentForNewRecord } from "./writeDepartment";
import {
  customers,
  departments,
  insuranceOrderStatusHistory,
  insuranceOrders,
  insurancePackages,
  orderCodeCounters,
  users,
} from "./db/schema";
import type { PageArgs } from "./pagination";
import { imageUrl } from "./storage";

/**
 * P-13 · P-14 — bản DB của module bảo hiểm.
 *
 * Hệ thống KHÔNG phát hành hợp đồng, chỉ ghi nhận và theo dõi vòng đời đơn
 * (spec §3.4). Đơn bảo hiểm CÓ áp trục phạm vi, khác hồ sơ khách hàng.
 */

/** Vô hiệu ký tự đại diện của `LIKE` — gõ `%` phải ra "không có kết quả". */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Ngày lọc phải ĐÚNG HÌNH DẠNG và CÓ THẬT.
 *
 * Bản cũ chỉ so regex `^\d{4}-\d{2}-\d{2}$`. `2026-02-30` khớp hình dạng đó
 * nhưng tháng 2 không có ngày 30, nên Postgres từ chối bằng `22008` và cả màn
 * trả 500. Khoảng ngày nằm trong địa chỉ trang, nên một link cũ bị sửa là đủ.
 *
 * Ngày sai thì BỎ QUA điều kiện lọc đó, không trả 400 — cùng lối nghĩ với
 * `uuidParam`.
 */
const usableDate = isRealIsoDate;

export type InsuranceFilters = {
  search: string;
  status: string;
  product: string;
  from: string;
  to: string;
  staffId: string;
  staffRole: string;
  /** Phòng của NGƯỜI TẠO đơn. Chuỗi rỗng = mọi phòng. */
  departmentId: string;
};

/**
 * Phạm vi bản ghi theo ĐÚNG hành động đang làm.
 *
 * `chỉ mình` ở đây là "đơn do chính mình tạo" (spec §1.1.2), không phải cả
 * phòng — xem ghi chú ở `recordVisibility`.
 *
 * Kẹp nhầm vế là lỗi thật đã gặp ở `server/services.ts`: ai có `view-detail`
 * toàn công ty nhưng `update` một phòng vẫn sửa được đơn của phòng khác.
 */
const scopeOf = (
  actor: User,
  action: "view-detail" | "update" | "delete" | "export" | "handle-fallback",
) => recordVisibility(actor, "insurance", action);

/** Điều kiện SQL tương ứng. `undefined` = không lọc; `false` = không thấy gì. */
const scopeWhere = (v: RecordVisibility): SQL | undefined => {
  switch (v.kind) {
    case "all":
      return undefined;
    case "departments":
      return inArray(insuranceOrders.createdByDepartmentId, v.departmentIds);
    case "creator":
      return eq(insuranceOrders.createdBy, v.userId);
    default:
      return sql`false`;
  }
};

const inScope = recordInScope;

/**
 * Ai nhìn thấy một đơn bảo hiểm — HỢP của bốn đường, không phải một trục.
 *
 * Đơn có HAI người liên quan (người tạo, người xử lý tay) nên một trục phạm vi
 * đơn lẻ không diễn tả nổi. Bốn đường:
 *
 * 1. trục phạm vi thường, tính trên NGƯỜI TẠO — gồm luôn cấp quản lý phòng đó
 * 2. chính người đang xử lý đơn
 * 3. cấp quản lý phòng của người xử lý (phòng chụp lúc nhận đơn)
 * 4. KHO CHUNG: đơn còn ở hàng chờ thì ai có `handle-fallback` cũng thấy, bất
 *    kể phòng — không thế thì người phạm vi `own` chỉ nhận được đơn của chính
 *    mình và vai "người xử lý tay" vô dụng
 *
 * Đường 4 áp cho hai trạng thái, cả hai đều là "bot dừng, chưa ai cầm". Đơn vừa
 * có người nhận là rơi khỏi kho chung, còn lại đúng những người có phần trong nó.
 *
 * `pending-approval` vào đây từ 2026-08-28. Bot tạo đơn xong nhưng không khớp
 * được dòng bên PVI nên không dám bấm Duyệt; người phải vào PVI duyệt tay. Trước
 * đó trạng thái này không có lối ra nào: worker chỉ đọc `queued` và
 * `awaiting-certificate`, còn `STEP_FROM` không nhận nó làm nguồn.
 */
const CLAIMABLE_STATUSES = ["manual-queued", "pending-approval"] as const;
const isClaimable = (status: string) =>
  (CLAIMABLE_STATUSES as readonly string[]).includes(status);

/**
 * Đơn bot đã THÔI hỏi PVI về giấy chứng nhận — cũng là kho chung.
 *
 * Đơn đã tạo và đã duyệt xong bên PVI, chỉ thiếu tấm ảnh. Không mở cho người có
 * `handle-fallback` thì nó nằm ở `awaiting-certificate` vĩnh viễn: bot thôi hỏi,
 * còn người duy nhất thấy đơn là người tạo, mà họ không có quyền xử lý.
 */
const stuckCertificateWhere = (): SQL =>
  and(
    eq(insuranceOrders.status, "awaiting-certificate"),
    gte(insuranceOrders.certificateAttempts, CERTIFICATE_MAX_ATTEMPTS),
  )!;

const certificateStuck = (row: { status: string; certificateAttempts: number }): boolean =>
  row.status === "awaiting-certificate" && row.certificateAttempts >= CERTIFICATE_MAX_ATTEMPTS;

const visibleOrderWhere = (actor: User): SQL | undefined => {
  const view = scopeOf(actor, "view-detail");
  if (view.kind === "all") return undefined;

  const managed = view.kind === "departments" ? view.departmentIds : [];
  const parts: (SQL | undefined)[] = [
    scopeWhere(view),
    eq(insuranceOrders.handledBy, actor.id),
    managed.length > 0
      ? inArray(insuranceOrders.handledByDepartmentId, managed)
      : undefined,
    can(actor, "insurance", "handle-fallback")
      ? inArray(insuranceOrders.status, CLAIMABLE_STATUSES)
      : undefined,
    can(actor, "insurance", "handle-fallback") ? stuckCertificateWhere() : undefined,
  ];

  const usable = parts.filter((p): p is SQL => p !== undefined && p !== (sql`false` as never));
  return usable.length > 0 ? or(...usable) : sql`false`;
};

const canSeeOrder = (
  actor: User,
  row: {
    createdById: string | null;
    createdByDepartmentId: string | null;
    handledById: string | null;
    handledByDepartmentId: string | null;
    status: string;
    certificateAttempts: number;
  },
): boolean => {
  const view = scopeOf(actor, "view-detail");
  if (inScope(view, row)) return true;
  if (row.handledById !== null && row.handledById === actor.id) return true;
  if (
    view.kind === "departments" &&
    row.handledByDepartmentId !== null &&
    view.departmentIds.includes(row.handledByDepartmentId)
  )
    return true;
  if (!can(actor, "insurance", "handle-fallback")) return false;
  return isClaimable(row.status) || certificateStuck(row);
};

/**
 * Tìm theo TÊN KHÁCH hoặc MÃ ĐƠN. Tên khách đi bằng `exists`, không phải phép
 * nối.
 *
 * `exists` là phép nửa-nối: Postgres dừng ngay khi thấy một dòng khớp, và cột
 * sinh `customers.search_name` có chỉ mục trigram đỡ. Nối `customers` vào câu
 * chọn trang thì bảng khách đi cùng suốt phép sắp xếp (AGENTS.md §5.2).
 *
 * Mỗi từ một điều kiện VÀ, không phụ thuộc thứ tự — `tram nguyen` vẫn ra
 * `Nguyễn Thị Bích Trâm`. Từng từ khớp MỘT trong hai: tên khách, hoặc mã đơn
 * ngay trên dòng đơn (`ilike` để gõ `dh-2608` thường vẫn ra).
 */
function searchWhere(raw: string): SQL | undefined {
  const text = raw.trim();
  if (!text) return undefined;

  return and(
    ...text.split(/\s+/).map(
      (term) =>
        or(
          sql`exists (
            select 1 from ${customers} c
            where c.id = ${insuranceOrders.customerId}
              and c.search_name like '%' || mgst_normalize(${likeEscape(term)}) || '%' escape '\\'
          )`,
          sql`${insuranceOrders.orderCode} ilike '%' || ${likeEscape(term)} || '%' escape '\\'`,
        ),
    ),
  );
}

/**
 * Lọc theo nhân viên, nói rõ soi VAI NÀO của đơn.
 *
 * Một đơn có hai người: người tạo và người xử lý tay. Trước đây ô lọc chỉ soi
 * người tạo, nên quản lý muốn hỏi "đội mình đang cầm bao nhiêu đơn của phòng
 * khác" thì không có đường hỏi.
 *
 * Giá trị lạ rơi về `any` chứ không trả 400 — cùng lối với khoá sắp xếp.
 */
const staffFilter = (q: { staffId: string; staffRole: string }): SQL | undefined => {
  if (!q.staffId) return undefined;
  if (q.staffRole === "creator") return eq(insuranceOrders.createdBy, q.staffId);
  if (q.staffRole === "handler") return eq(insuranceOrders.handledBy, q.staffId);
  return or(eq(insuranceOrders.createdBy, q.staffId), eq(insuranceOrders.handledBy, q.staffId));
};

/** Chuỗi rỗng hoặc giá trị lạ đều thành "mọi trạng thái" / "mọi loại". */
const statusFilter = (raw: string): SQL | undefined => {
  const parsed = InsuranceOrderStatus.safeParse(raw);
  return parsed.success ? eq(insuranceOrders.status, parsed.data) : undefined;
};

const productFilter = (raw: string): SQL | undefined => {
  const parsed = InsuranceProduct.safeParse(raw);
  return parsed.success ? eq(insuranceOrders.product, parsed.data) : undefined;
};

/**
 * Khoảng ngày lọc theo NGÀY TẠO ĐƠN, không theo ngày hiệu lực.
 *
 * Quản lý hỏi "tháng này đội làm được bao nhiêu đơn", không hỏi "bao nhiêu hợp
 * đồng có hiệu lực trong tháng" — hai câu khác nhau, và một đơn lập hôm nay cho
 * hợp đồng hiệu lực tháng sau sẽ biến mất khỏi câu thứ nhất nếu lọc nhầm cột.
 *
 * `order_date` là cột `date` trần nên so thẳng chuỗi `YYYY-MM-DD` là đủ — không
 * còn phép quy múi giờ nào, và phép so dùng lại được chỉ mục.
 */
const orderFilters = (actor: User, query: InsuranceFilters): SQL | undefined => {
  const parts = [
    visibleOrderWhere(actor),
    searchWhere(query.search),
    statusFilter(query.status),
    productFilter(query.product),
    // Ngày sai định dạng thì bỏ qua, không trả 400 — link cũ hay ô địa chỉ gõ
    // nhầm không đáng làm hỏng cả màn (cùng lối nghĩ với `uuidParam`).
    usableDate(query.from) ? gte(insuranceOrders.orderDate, query.from) : undefined,
    usableDate(query.to) ? lte(insuranceOrders.orderDate, query.to) : undefined,
    staffFilter(query),
    // Lọc theo phòng của NGƯỜI TẠO, không phải người xử lý: câu hỏi thường gặp
    // là "phòng nào lập bao nhiêu đơn", còn người xử lý tay là kho chung nên
    // phòng của họ không nói lên đơn thuộc về ai.
    query.departmentId
      ? eq(insuranceOrders.createdByDepartmentId, query.departmentId)
      : undefined,
  ].filter(Boolean) as SQL[];

  return parts.length > 0 ? and(...parts) : undefined;
};

const creator = alias(users, "creator");
const handler = alias(users, "handler");
const creatorDepartment = alias(departments, "creator_department");

/**
 * Chọn ra ĐÚNG những dòng của trang này, chỉ đụng bảng `insurance_orders`.
 *
 * Lọc, sắp và cắt trang xong hết ở đây rồi mới đi lấy tên khách, tên người tạo
 * và tên người xử lý. Ba phép nối đó chạy trên 15 dòng, không phải trên cả kho
 * (AGENTS.md §5.2).
 */
const pickPage = (where: SQL | undefined, orderBy: SQL[], limit: number, offset: number) =>
  db
    .select({
      id: insuranceOrders.id,
      orderCode: insuranceOrders.orderCode,
      customerId: insuranceOrders.customerId,
      product: insuranceOrders.product,
      packageName: insuranceOrders.packageName,
      fee: insuranceOrders.fee,
      status: insuranceOrders.status,
      source: insuranceOrders.source,
      orderDate: insuranceOrders.orderDate,
      startDate: insuranceOrders.startDate,
      endDate: insuranceOrders.endDate,
      beneficiaryName: insuranceOrders.beneficiaryName,
      beneficiaryDob: insuranceOrders.beneficiaryDob,
      beneficiaryIdNumber: insuranceOrders.beneficiaryIdNumber,
      beneficiaryPhone: insuranceOrders.beneficiaryPhone,
      beneficiaryAddress: insuranceOrders.beneficiaryAddress,
      householdSize: insuranceOrders.householdSize,
      sumInsured: insuranceOrders.sumInsured,
      licensePlate: insuranceOrders.licensePlate,
      vehicleType: insuranceOrders.vehicleType,
      chassisNumber: insuranceOrders.chassisNumber,
      engineNumber: insuranceOrders.engineNumber,
      certificatePhotoUrl: insuranceOrders.certificatePhotoUrl,
      certificateAttempts: insuranceOrders.certificateAttempts,
      pviCertificateUrl: insuranceOrders.pviCertificateUrl,
      pviSerialNumber: insuranceOrders.pviSerialNumber,
      handledBy: insuranceOrders.handledBy,
      handledByDepartmentId: insuranceOrders.handledByDepartmentId,
      createdBy: insuranceOrders.createdBy,
      createdByDepartmentId: insuranceOrders.createdByDepartmentId,
      // Không hiện ở màn nào — có mặt CHỈ để câu ngoài sắp lại được, xem `orderOuter`.
      createdAt: insuranceOrders.createdAt,
    })
    .from(insuranceOrders)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset)
    .as("page");

const decorate = (page: ReturnType<typeof pickPage>) =>
  db
    .select({
      id: page.id,
      orderCode: page.orderCode,
      customerId: page.customerId,
      customerName: customers.fullName,
      product: page.product,
      packageName: page.packageName,
      fee: page.fee,
      status: page.status,
      source: page.source,
      orderDate: page.orderDate,
      startDate: page.startDate,
      endDate: page.endDate,
      beneficiaryName: page.beneficiaryName,
      // Cột nullable ở DB nhưng hợp đồng là chuỗi: đơn xe máy không hỏi ngày sinh.
      beneficiaryDob: sql<string>`coalesce(${page.beneficiaryDob}::text, '')`,
      beneficiaryIdNumber: page.beneficiaryIdNumber,
      beneficiaryPhone: page.beneficiaryPhone,
      beneficiaryAddress: page.beneficiaryAddress,
      householdSize: page.householdSize,
      sumInsured: page.sumInsured,
      licensePlate: page.licensePlate,
      vehicleType: page.vehicleType,
      chassisNumber: page.chassisNumber,
      engineNumber: page.engineNumber,
      certificatePhotoUrl: page.certificatePhotoUrl,
      certificateAttempts: page.certificateAttempts,
      pviCertificateUrl: page.pviCertificateUrl,
      pviSerialNumber: page.pviSerialNumber,
      createdById: page.createdBy,
      createdByName: creator.fullName,
      createdByDepartmentId: page.createdByDepartmentId,
      createdByDepartmentName: creatorDepartment.name,
      handledById: page.handledBy,
      handledByDepartmentId: page.handledByDepartmentId,
      handledByName: handler.fullName,
    })
    .from(page)
    .innerJoin(customers, eq(customers.id, page.customerId))
    // leftJoin cả hai: người tạo có thể đã bị xoá khỏi hệ thống, và đơn bot chạy
    // trơn thì không có người xử lý. innerJoin thì những dòng đó biến mất khỏi
    // danh sách mà không báo gì.
    .leftJoin(creator, eq(creator.id, page.createdBy))
    .leftJoin(handler, eq(handler.id, page.handledBy))
    // Nối trên `insurance_orders.created_by_department_id` chứ KHÔNG trên
    // `creator.department_id`: người tạo chuyển phòng về sau thì đơn cũ vẫn
    // phải hiện đúng phòng lúc lập.
    .leftJoin(creatorDepartment, eq(creatorDepartment.id, page.createdByDepartmentId));

type DecoratedRow = Awaited<ReturnType<typeof decorate>>[number];

/**
 * Dòng danh sách CỐ Ý bỏ bốn trường người thụ hưởng — một trong số đó là CCCD.
 * Bảng P-13 không có lý do gì để chở CCCD của mười lăm người qua đường truyền
 * mỗi lần lật trang.
 */
const toRow = (r: DecoratedRow): InsuranceListRow => ({
  id: r.id,
  orderCode: r.orderCode,
  customerId: r.customerId,
  customerName: r.customerName,
  product: r.product,
  packageName: r.packageName,
  fee: r.fee,
  status: r.status,
  source: r.source,
  orderDate: r.orderDate,
  startDate: r.startDate,
  endDate: r.endDate,
  createdById: r.createdById,
  createdByName: r.createdByName,
  createdByDepartmentId: r.createdByDepartmentId,
  createdByDepartmentName: r.createdByDepartmentName,
  handledById: r.handledById,
  handledByName: r.handledByName,
  // Database lưu khoá; FE cần URL đọc được. Đổi ở đúng một chỗ vì `toOrder`
  // trải `toRow` ra, nên cả danh sách lẫn chi tiết đi qua đây.
  certificatePhotoUrl: r.certificatePhotoUrl ? imageUrl(r.certificatePhotoUrl) : r.certificatePhotoUrl,
  certificateAttempts: r.certificateAttempts,
});

/**
 * CCCD người thụ hưởng chỉ hiện với người CÓ PHẦN TRONG ĐƠN.
 *
 * Khác CCCD của KHÁCH (quyết định 02/08, gác bằng `customer:access-id-number`):
 * số này nằm trên hợp đồng, và người nhập đơn sang PVI buộc phải đọc được nó.
 *
 * Nhưng hàng chờ làm tay là kho chung, ai có `handle-fallback` cũng mở được mọi
 * đơn đang chờ — nếu hiện luôn CCCD thì kho chung thành đường đọc CCCD của cả
 * công ty. Nên: thấy đơn ≠ thấy CCCD. Nhận đơn về rồi mới thấy.
 */
const seesBeneficiaryId = (actor: User, r: DecoratedRow): boolean =>
  r.createdById === actor.id ||
  r.handledById === actor.id ||
  can(actor, "customer", "access-id-number");

const toOrder = (actor: User, r: DecoratedRow): InsuranceOrder => ({
  ...toRow(r),
  pviCertificateUrl: r.pviCertificateUrl,
  pviSerialNumber: r.pviSerialNumber,
  beneficiaryName: r.beneficiaryName,
  beneficiaryDob: r.beneficiaryDob,
  beneficiaryIdNumber: seesBeneficiaryId(actor, r) ? r.beneficiaryIdNumber : "",
  beneficiaryIdNumberHidden: !seesBeneficiaryId(actor, r) && r.beneficiaryIdNumber !== "",
  beneficiaryPhone: r.beneficiaryPhone,
  beneficiaryAddress: r.beneficiaryAddress,
  householdSize: r.householdSize,
  sumInsured: r.sumInsured,
  licensePlate: r.licensePlate,
  vehicleType: r.vehicleType,
  chassisNumber: r.chassisNumber,
  engineNumber: r.engineNumber,
  createdByDepartmentId: r.createdByDepartmentId,
});

/**
 * Ba khoá, và cả ba đều cần thiết.
 *
 * `order_date` là thứ người dùng chọn sắp. Nhưng nó là kiểu `date` — không có
 * giờ — nên MỌI đơn lập trong cùng một ngày đều hoà, và một ngày làm việc bình
 * thường có hàng chục đơn như vậy.
 *
 * `created_at` phá hoà theo đúng thứ tự người dùng mong đợi: đơn vừa lập nằm
 * trên. Nó vẫn bất biến nên không ai xê dịch được thứ tự này. Thiếu nó thì khoá
 * phá hoà còn lại là `id` — uuid NGẪU NHIÊN — và người dùng bấm Tạo đơn xong
 * không thấy đơn của mình đâu vì nó rơi vào giữa bảng. Bộ e2e bắt được đúng ca
 * đó: 6 ca đỏ vì không tìm ra dòng vừa tạo.
 *
 * `id` vẫn phải đứng cuối: hai đơn của cùng một gói sinh trong cùng giao dịch
 * mang `created_at` y hệt nhau (`now()` không đổi trong một giao dịch).
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
    orderByDate(
      { date: insuranceOrders.orderDate, at: insuranceOrders.createdAt, id: insuranceOrders.id },
      dir,
    ),
    limit,
    offset,
  );
  return decorate(page).orderBy(
    ...orderByDate({ date: page.orderDate, at: page.createdAt, id: page.id }, dir),
  );
};

/** MỘT trang đơn bảo hiểm, đã lọc/tìm/sắp sẵn ở máy chủ (AGENTS.md §5.1). */
export async function listInsuranceOrders(
  actor: User,
  filters: InsuranceFilters,
  page: PageArgs<InsuranceSort>,
): Promise<Page<InsuranceListRow>> {
  const visible = scopeOf(actor, "view-detail");
  if (visible.kind === "none") return { rows: [], total: 0 };

  const where = orderFilters(actor, filters);

  const [rows, [totals]] = await Promise.all([
    orderedPage(where, page.dir, page.limit, page.offset),
    db.select({ value: count() }).from(insuranceOrders).where(where),
  ]);

  return { rows: rows.map(toRow), total: totals?.value ?? 0 };
}

/**
 * Trần một lượt xuất Excel. Chạm trần thì `total` nói ra sự thật và nơi gọi
 * BẮT BUỘC so hai số — file thiếu 5.000 dòng trông y hệt file đủ.
 */
const EXPORT_LIMIT = 20_000;

export async function listInsuranceOrdersForExport(
  actor: User,
  filters: InsuranceFilters,
): Promise<Page<InsuranceListRow>> {
  // `export`, không phải `view-detail`: ai được cấp `view-detail` toàn công ty
  // nhưng `export` một phòng vẫn xuất được cả kho nếu kẹp nhầm vế.
  const visible = scopeOf(actor, "export");
  if (visible.kind === "none") return { rows: [], total: 0 };

  const where = orderFilters(actor, filters);

  const [rows, [totals]] = await Promise.all([
    orderedPage(where, "desc", EXPORT_LIMIT, 0),
    db.select({ value: count() }).from(insuranceOrders).where(where),
  ]);

  return { rows: rows.map(toRow), total: totals?.value ?? 0 };
}

const rawById = async (id: string): Promise<DecoratedRow | null> =>
  (await decorate(pickPage(eq(insuranceOrders.id, id), [], 1, 0)))[0] ?? null;

/** Dòng thời gian trạng thái kèm mốc giờ (P-14) — vài dòng mỗi đơn. */
async function historyOf(orderId: string): Promise<InsuranceDetail["history"]> {
  const rows = await db
    .select({
      id: insuranceOrderStatusHistory.id,
      fromStatus: insuranceOrderStatusHistory.fromStatus,
      toStatus: insuranceOrderStatusHistory.toStatus,
      changedByName: users.fullName,
      changedAt: insuranceOrderStatusHistory.changedAt,
      note: insuranceOrderStatusHistory.note,
    })
    .from(insuranceOrderStatusHistory)
    .leftJoin(users, eq(users.id, insuranceOrderStatusHistory.changedBy))
    .where(eq(insuranceOrderStatusHistory.orderId, orderId))
    .orderBy(asc(insuranceOrderStatusHistory.changedAt), asc(insuranceOrderStatusHistory.id));

  return rows.map((r) => ({ ...r, changedAt: r.changedAt.toISOString() }));
}

/**
 * P-14 · Chi tiết một đơn.
 *
 * Ngoài tầm nhìn trả `null` (route đổi thành 404) chứ không phải 403 — 403 là
 * xác nhận id có thật, biến endpoint thành chỗ dò.
 */
export async function insuranceOrderDetail(
  actor: User,
  id: string,
): Promise<InsuranceDetail | null> {
  const r = await rawById(id);
  if (!r || !canSeeOrder(actor, r)) return null;

  return { ...toOrder(actor, r), history: await historyOf(id) };
}

export type InsuranceOutcome<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Trạng thái của đơn vừa tạo, quyết định theo việc worker PVI có đang chạy không.
 *
 * `PVI_WORKER_BAT=1` → `queued`, đơn xếp hàng chờ bot pick lên.
 * Thiếu biến đó → `manual-queued`, đội KD làm tay như trước.
 *
 * Phải theo trạng thái THẬT của worker chứ không phải mong muốn: bot tắt mà đơn
 * vẫn vào `queued` thì chúng nằm im vĩnh viễn ở một trạng thái nói dối — người
 * xem tưởng hệ thống đang chạy, còn hàng chờ làm tay thì rỗng trong khi đó là
 * nơi việc thật sự nằm.
 *
 * Đọc mỗi lần gọi, không chụp một lần lúc nạp module: hai container dùng chung
 * biến này, và bật tắt worker không nên đòi khởi động lại cả app.
 */
const newOrderStatus = (): "queued" | "manual-queued" =>
  process.env.PVI_WORKER_BAT === "1" ? "queued" : "manual-queued";

export async function createInsuranceOrders(
  actor: User,
  form: InsuranceOrderForm,
): Promise<InsuranceOutcome<InsuranceListRow[]>> {
  const department = departmentForNewRecord(actor, "insurance", form.departmentId);
  if (!department.ok) return { ok: false, message: department.message };

  /**
   * Lấy luôn CCCD THẬT của khách, không chỉ `id`.
   *
   * Người nhập không có `customer:access-id-number` chỉ nhìn thấy 4 số cuối
   * (`**** 7872`), nên không có gì để gõ vào ô CCCD người thụ hưởng. Trước đây
   * nút "Điền theo khách hàng" chép thẳng chuỗi 4 số đó vào hợp đồng, mà ô
   * không ràng buộc độ dài nên đơn lưu im lặng rồi PVI từ chối — bảo hiểm tai
   * nạn điện định danh theo CCCD (spec §3.2).
   *
   * Nay máy chủ tự móc số đầy đủ từ DB khi `beneficiaryIsCustomer` bật. Số
   * KHÔNG đi ngược ra trình duyệt của người nhập, nên quyền xem CCCD khách
   * (quyết định 02/08) vẫn nguyên.
   */
  const [customer] = await db
    .select({ id: customers.id, idNumber: customers.idNumber })
    .from(customers)
    .where(eq(customers.id, form.customerId))
    .limit(1);
  if (!customer) return { ok: false, message: "Không tìm thấy khách hàng này" };

  const today = businessDay();
  for (const leg of form.legs) {
    if (leg.endDate < leg.startDate)
      return { ok: false, message: "Ngày kết thúc phải sau ngày bắt đầu" };
    // Sổ ghi việc ĐÃ LÀM: một đơn của tuần sau thì chưa bán cho ai.
    if (leg.orderDate > today) return { ok: false, message: "Ngày tạo đơn không được ở tương lai" };
  }

  /**
   * Nối tên gói về `package_id` để đơn còn dẫn ngược được về danh mục. Tên thì
   * vẫn CHỤP vào `package_name`: CEO đổi tên gói ở P-82 không được viết lại đơn
   * cũ (spec §5.4).
   */
  const packageIds = new Map(
    (
      await db
        .select({ id: insurancePackages.id, name: insurancePackages.name })
        .from(insurancePackages)
        .where(inArray(insurancePackages.name, form.legs.map((leg) => leg.packageName)))
    ).map((p) => [p.name, p.id] as const),
  );

  const yearMonth = businessMonth();
  const need = form.legs.length;

  const created = await db.transaction(async (tx) => {
    /**
     * Xin trọn một DÃY mã liền nhau bằng MỘT câu nguyên tử.
     *
     * `insert … on conflict do update … returning` không có khoảng trống giữa
     * lúc đọc và lúc ghi: hai request chạm cùng tháng thì câu thứ hai đợi câu
     * thứ nhất commit rồi mới cộng tiếp. Đọc `last_number` ở một câu rồi
     * `update` ở câu sau là hai đơn cùng mang mã `DH-2608-007`, mà `order_code`
     * có khoá duy nhất nên một trong hai đổ lỗi ngay giữa lúc tạo.
     */
    const [counter] = await tx
      .insert(orderCodeCounters)
      .values({ yearMonth, lastNumber: need })
      .onConflictDoUpdate({
        target: orderCodeCounters.yearMonth,
        set: { lastNumber: sql`${orderCodeCounters.lastNumber} + ${need}` },
      })
      .returning({ last: orderCodeCounters.lastNumber });

    // `DH-YYMM-NNN` (spec P-12): tháng 2026-08 → `DH-2608-`.
    const prefix = `DH-${yearMonth.slice(2, 4)}${yearMonth.slice(5, 7)}-`;
    const first = counter.last - need + 1;
    const codes = Array.from(
      { length: need },
      (_, i) => `${prefix}${String(first + i).padStart(3, "0")}`,
    );

    // Đọc MỘT lần cho cả lô: mọi đơn của một lần tạo phải cùng một trạng thái,
    // kể cả khi ai đó bật tắt worker đúng lúc câu insert đang chạy.
    const newStatus = newOrderStatus();

    const rows = await tx
      .insert(insuranceOrders)
      .values(
        form.legs.map((leg, i) => ({
          orderCode: codes[i],
          customerId: form.customerId,
          product: leg.product,
          packageId: packageIds.get(leg.packageName) ?? null,
          packageName: leg.packageName,
          fee: leg.fee,
          orderDate: leg.orderDate,
          startDate: leg.startDate,
          endDate: leg.endDate,
          status: newStatus,
          source: form.source,
          beneficiaryName: leg.beneficiaryName,
          // Ô ngày sinh ẩn với đơn xe máy nên chuỗi rỗng là chuyện thường —
          // `''::date` là lỗi cú pháp, phải về null.
          beneficiaryDob: leg.beneficiaryDob || null,
          // Người thụ hưởng là chính khách thì lấy CCCD từ DB, KHÔNG tin chuỗi
          // client gửi — nó có thể là 4 số cuối đã bị che.
          beneficiaryIdNumber: leg.beneficiaryIsCustomer
            ? (customer.idNumber ?? "")
            : leg.beneficiaryIdNumber,
          beneficiaryPhone: leg.beneficiaryPhone,
          beneficiaryAddress: leg.beneficiaryAddress,
          householdSize: leg.householdSize,
          sumInsured: leg.sumInsured,
          licensePlate: leg.licensePlate,
          vehicleType: leg.vehicleType,
          chassisNumber: leg.chassisNumber,
          engineNumber: leg.engineNumber,
          createdBy: actor.id,
          // Đơn vị của người tạo lúc tạo. Người này chuyển phòng thì
          // `writeStaff` viết lại cột này cho mọi dòng của họ (chốt 13/08).
          // Người không thuộc phòng nào thì đây là phòng họ chọn ở biểu mẫu.
          createdByDepartmentId: department.departmentId,
        })),
      )
      .returning({ id: insuranceOrders.id });

    await tx.insert(insuranceOrderStatusHistory).values(
      rows.map((r) => ({
        orderId: r.id,
        fromStatus: null,
        toStatus: newStatus,
        changedBy: actor.id,
      })),
    );

    return rows.map((r) => r.id);
  });

  // Trả về theo THỨ TỰ MÃ, tức đúng thứ tự các leg của gói — người dùng vừa
  // điền form số 1 rồi form số 2, toast báo ngược lại thì đọc rất khó hiểu.
  // Phải sắp ở CẢ HAI tầng: phép nối không giữ thứ tự của câu con.
  const inner = pickPage(
    inArray(insuranceOrders.id, created),
    [asc(insuranceOrders.orderCode)],
    created.length,
    0,
  );
  const rows = await decorate(inner).orderBy(asc(inner.orderCode));
  return { ok: true, value: rows.map(toRow) };
}

/**
 * Sửa một đơn CHƯA hoàn thành.
 *
 * Đơn `Hoàn thành` là hợp đồng đã phát hành bên PVI: sửa bản ghi của mình chỉ
 * làm nó lệch với tờ chứng nhận thật, và không có cách nào phát hiện ra sau đó.
 * Ảnh chứng nhận thì vẫn thay được ở mọi trạng thái (spec §3.4).
 */
export async function updateInsuranceOrder(
  actor: User,
  id: string,
  body: unknown,
): Promise<InsuranceOutcome<InsuranceListRow> | null> {
  const visible = scopeOf(actor, "update");
  if (visible.kind === "none") return null;

  const current = await rawById(id);
  if (!current || !inScope(visible, current)) return null;

  if (current.status === "done")
    return {
      ok: false,
      message: "Đơn đã hoàn thành thì không sửa được nữa — chỉ thay được ảnh chứng nhận.",
    };

  // Trạng thái cuối thứ hai. Sửa nội dung một đơn đã huỷ không đổi được điều
  // gì, nhưng nó viết lại bản ghi mà lý do huỷ đang trỏ tới.
  if (current.status === "cancelled")
    return { ok: false, message: "Đơn đã huỷ thì không sửa được nữa." };

  /**
   * Kiểm dữ liệu vào ở ĐÂY chứ không ở route, vì luật biển số/loại xe phụ thuộc
   * sản phẩm mà sản phẩm phải ĐỌC TỪ DATABASE. Route parse trước thì chỉ có
   * `product` client gửi lên để mà dựa, và gửi kèm `electric-accident` là gỡ
   * được ràng buộc biển số của một đơn xe máy.
   */
  const parsed = insuranceOrderEditSchema(
    current.product,
    !seesBeneficiaryId(actor, current),
  ).safeParse(body);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const form = parsed.data;

  if (form.endDate < form.startDate)
    return { ok: false, message: "Ngày kết thúc phải sau ngày bắt đầu" };
  if (form.orderDate > businessDay())
    return { ok: false, message: "Ngày tạo đơn không được ở tương lai" };

  await db
    .update(insuranceOrders)
    .set({
      // Đổi ngày tạo đơn là đổi tháng mà đơn này được tính vào.
      orderDate: form.orderDate,
      fee: form.fee,
      startDate: form.startDate,
      endDate: form.endDate,
      beneficiaryName: form.beneficiaryName,
      beneficiaryDob: form.beneficiaryDob || null,
      /**
       * CCCD chỉ ghi đè khi người sửa ĐANG XEM ĐƯỢC nó.
       *
       * `toOrder` trả chuỗi rỗng cho người không có phần trong đơn, nên form của
       * họ nạp ô CCCD rỗng rồi gửi rỗng ngược lên. Ghi thẳng là xoá số trên hợp
       * đồng đã ký, và không có bản sao nào để lấy lại.
       */
      ...(seesBeneficiaryId(actor, current)
        ? { beneficiaryIdNumber: form.beneficiaryIdNumber }
        : {}),
      beneficiaryPhone: form.beneficiaryPhone,
      beneficiaryAddress: form.beneficiaryAddress,
      householdSize: form.householdSize,
      sumInsured: form.sumInsured,
      licensePlate: form.licensePlate,
      vehicleType: form.vehicleType,
      chassisNumber: form.chassisNumber,
      engineNumber: form.engineNumber,
      updatedAt: new Date(),
    })
    .where(eq(insuranceOrders.id, id));

  return { ok: true, value: toRow((await rawById(id))!) };
}

/**
 * XOÁ HẲN một đơn chưa hoàn thành — khác `cancelInsuranceOrder` là đơn ở lại
 * kho kèm lý do. Cùng lối với
 * tài khoản ngân hàng bỏ dở (spec §4.5).
 *
 * Trả `null` khi không tìm thấy HOẶC ngoài tầm nhìn: 404 giống hệt nhau để
 * endpoint không thành chỗ dò id có thật.
 */
export async function deleteInsuranceOrder(
  actor: User,
  id: string,
): Promise<InsuranceOutcome<InsuranceListRow> | null> {
  const visible = scopeOf(actor, "delete");
  if (visible.kind === "none") return null;

  const current = await rawById(id);
  if (!current || !inScope(visible, current)) return null;

  if (current.status === "done")
    return { ok: false, message: "Đơn đã hoàn thành thì không xoá được — hợp đồng đã phát hành." };
  if (current.source === "gift")
    return {
      ok: false,
      message: "Đơn quà tặng không xoá riêng được — nó là vết của một đợt tặng quà.",
    };

  const row = toRow(current);

  await db.transaction(async (tx) => {
    // Dòng thời gian trỏ vào đơn bằng khoá ngoại KHÔNG cascade — xoá đơn trước
    // là vi phạm ràng buộc, cả giao dịch đổ.
    await tx
      .delete(insuranceOrderStatusHistory)
      .where(eq(insuranceOrderStatusHistory.orderId, id));
    // Điều kiện trạng thái nằm ngay trong câu xoá, không chỉ ở phép kiểm bên
    // trên: giữa lúc đọc và lúc xoá, người khác có thể vừa bấm Hoàn thành.
    await tx
      .delete(insuranceOrders)
      .where(and(eq(insuranceOrders.id, id), sql`${insuranceOrders.status} <> 'done'`));
  });

  return { ok: true, value: row };
}

/**
 * Bước chuyển hợp lệ của nhánh làm tay (spec §3.4) — máy chủ tự kiểm, không
 * nhận trạng thái tuỳ ý từ client.
 */
const STEP_FROM: Record<InsuranceManualStep, InsuranceOrderStatus[]> = {
  /**
   * `pending-approval` là nguồn thứ hai (chốt 2026-08-28).
   *
   * Bot tạo đơn xong nhưng không khớp được dòng bên PVI nên không dám bấm
   * Duyệt. Người vào PVI duyệt tay rồi bấm "Đã duyệt" ở đây; đơn đi tiếp nhánh
   * làm tay và người bấm đứng tên xử lý.
   *
   * Không có nguồn này thì đơn nằm ở `pending-approval` vĩnh viễn: worker chỉ
   * đọc `queued` và `awaiting-certificate`, còn giao diện không có nút nào.
   */
  "manual-progress": ["manual-queued", "pending-approval"],
  /**
   * `done` có HAI nguồn.
   *
   * `manual-progress` là nhánh làm tay bình thường. `awaiting-certificate` là
   * đơn bot tạo và duyệt xong nhưng đã thôi hỏi PVI về giấy chứng nhận — người
   * có `handle-fallback` tải ảnh lên rồi bấm hoàn thành thay bot. Nguồn thứ hai
   * chỉ mở khi đơn ĐÃ chạm ngưỡng, xem `certificateStuck`.
   */
  done: ["manual-progress", "awaiting-certificate"],
};

/**
 * "Nhận đơn xử lý" và "Đánh dấu hoàn thành" (P-16 gộp vào P-14).
 *
 * Điều kiện trạng thái nằm TRONG câu ghi, không chỉ ở phép kiểm trước đó: hai
 * người cùng mở một đơn ở hàng chờ và cùng bấm "Nhận đơn xử lý" thì người thứ
 * hai không ghi trúng dòng nào và biết ngay là mình chậm chân — thay vì lặng lẽ
 * ghi đè `handled_by`, để hai người cùng tưởng mình đang cầm đơn.
 */
export async function setInsuranceOrderStatus(
  actor: User,
  id: string,
  next: InsuranceManualStep,
): Promise<InsuranceOutcome<InsuranceDetail> | null> {
  if (!can(actor, "insurance", "handle-fallback")) return null;

  const current = await rawById(id);
  if (!current) return null;

  /**
   * Hàng chờ là KHO CHUNG: ai có `handle-fallback` cũng nhận được đơn ở
   * `manual-queued`, bất kể phòng. Kẹp theo phạm vi thì người phạm vi `own` chỉ
   * nhận nổi đơn của chính mình, và vai "người xử lý tay" không dùng được.
   *
   * Đơn đã rời hàng chờ thì quay về luật thường: chỉ người có phần trong nó —
   * người tạo, người đang cầm, cấp quản lý hai phòng đó — mới bấm tiếp được.
   */
  const claimable = isClaimable(current.status) || certificateStuck(current);
  if (!claimable && !canSeeOrder(actor, current)) return null;

  /**
   * Đơn còn ở `awaiting-certificate` mà bot CHƯA thôi hỏi thì không ai bấm tay
   * được: bot sắp tải ảnh về, và bấm hoàn thành lúc này là chen ngang.
   */
  if (current.status === "awaiting-certificate" && !certificateStuck(current))
    return {
      ok: false,
      message: `Bot còn đang hỏi PVI về giấy chứng nhận (lần ${current.certificateAttempts}/${CERTIFICATE_MAX_ATTEMPTS}). Đợi bot thôi hỏi rồi mới xử lý tay được.`,
    };

  /**
   * Hoàn thành thì PHẢI có ảnh chứng nhận (chốt 2026-08-16).
   *
   * Hệ thống không nối PVI để tải file gốc, nên tấm ảnh là bằng chứng DUY NHẤT
   * cho việc hợp đồng đã phát hành. Mà `done` là trạng thái cuối: đơn ở đó thì
   * không sửa cũng không huỷ được nữa. Đánh dấu xong mới phát hiện thiếu ảnh là
   * không còn đường lùi.
   */
  if (next === "done" && !current.certificatePhotoUrl)
    return {
      ok: false,
      message: "Phải đính ảnh chứng nhận bảo hiểm trước khi đánh dấu hoàn thành.",
    };

  const from = STEP_FROM[next];

  /**
   * Ghi người xử lý ở hai ca: bấm "Nhận đơn xử lý" (chốt 03/08), và bấm hoàn
   * thành cho đơn bot bỏ dở. Ca thứ hai đơn chưa qua `manual-progress` nên
   * chưa ai đứng tên — không ghi thì đơn `done` mà không biết ai làm.
   *
   * Bước "Hoàn thành" của nhánh làm tay bình thường thì GIỮ NGUYÊN người đã
   * nhận, không ghi đè bằng người bấm.
   *
   * Chụp luôn phòng của họ: cấp quản lý phòng đó được xem đơn, và họ chuyển
   * phòng về sau không được làm đổi danh sách người xem (#8).
   */
  const takesOwnership =
    next === "manual-progress" || current.status === "awaiting-certificate";

  const updated = await db
    .update(insuranceOrders)
    .set({
      status: next,
      ...(takesOwnership
        ? { handledBy: actor.id, handledByDepartmentId: actor.departmentId }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(insuranceOrders.id, id), inArray(insuranceOrders.status, from)))
    .returning({ id: insuranceOrders.id });

  if (updated.length === 0)
    return {
      ok: false,
      message:
        next === "manual-progress"
          ? "Đơn này vừa có người khác nhận xử lý rồi."
          : "Đơn này vừa đổi trạng thái. Tải lại trang rồi thử lại.",
    };

  await db.insert(insuranceOrderStatusHistory).values({
    orderId: id,
    // `from` là DANH SÁCH nguồn hợp lệ; dòng lịch sử phải mang trạng thái thật
    // của đơn lúc bấm, không phải phần tử đầu danh sách.
    fromStatus: current.status,
    toStatus: next,
    changedBy: actor.id,
  });

  return { ok: true, value: (await insuranceOrderDetail(actor, id))! };
}

/**
 * Đặt trạng thái đơn sang BẤT KỲ giá trị nào — công cụ gỡ đơn mắc.
 *
 * Khác `setInsuranceOrderStatus` ở ba điểm, và cả ba là cố ý:
 *
 * 1. KHÔNG kiểm bảng bước chuyển. Vòng đời có chỗ đơn đi vào rồi không ra được
 *    — `pending-approval` từng như vậy — và không phải chỗ nào cũng lường trước.
 * 2. KHÔNG đòi ảnh chứng nhận khi đặt `done`. Người cấp quyền này tự chịu.
 * 3. KHÔNG kiểm phạm vi bản ghi. Quyền `set-status` không chia theo phạm vi
 *    (`SCOPELESS_ACTIONS`): đơn mắc nằm ở phòng nào cũng phải gỡ được.
 *
 * Vẫn ghi dòng lịch sử như mọi lượt đổi khác, nên nhìn dòng thời gian là biết
 * ai đặt tay và đặt từ đâu sang đâu.
 *
 * ⚠️ Đặt về `queued` là worker tạo lại đơn đó trên PVI lần hai. Không chặn ở
 * đây: chính đó là cách gỡ một đơn bot bỏ dở giữa chừng.
 */
export async function overrideInsuranceOrderStatus(
  actor: User,
  id: string,
  next: InsuranceOrderStatus,
): Promise<InsuranceOutcome<InsuranceDetail> | null> {
  if (!can(actor, "insurance", "set-status")) return null;

  const current = await rawById(id);
  if (!current) return null;

  if (current.status === next)
    return { ok: false, message: `Đơn đang ở trạng thái này rồi.` };

  /**
   * Huỷ đơn đi đường RIÊNG (`cancelInsuranceOrder`) vì lượt đó phải kèm lý do.
   * Cho phép ở đây là mở một đường vào `cancelled` không có lý do, và dòng thời
   * gian mất đúng thông tin duy nhất khiến trạng thái này đáng có.
   *
   * Chiều NGƯỢC lại vẫn mở: đặt tay đơn đã huỷ sang trạng thái khác là cách gỡ
   * một lượt huỷ nhầm.
   */
  if (next === "cancelled")
    return { ok: false, message: "Huỷ đơn phải bấm nút Huỷ đơn để ghi lý do." };

  const updated = await db
    .update(insuranceOrders)
    .set({ status: next, updatedAt: new Date() })
    // Kẹp theo trạng thái ĐANG đọc được: hai người cùng mở trang, người sau
    // bấm thì phải thấy đơn đã đổi chứ không ghi đè lặng lẽ.
    .where(and(eq(insuranceOrders.id, id), eq(insuranceOrders.status, current.status)))
    .returning({ id: insuranceOrders.id });

  if (updated.length === 0)
    return { ok: false, message: "Đơn này vừa đổi trạng thái. Tải lại trang rồi thử lại." };

  await db.insert(insuranceOrderStatusHistory).values({
    orderId: id,
    fromStatus: current.status,
    toStatus: next,
    changedBy: actor.id,
  });

  return { ok: true, value: (await insuranceOrderDetail(actor, id))! };
}

/**
 * Huỷ đơn — đơn sang `cancelled` và Ở LẠI trong kho, kèm lý do trên dòng lịch sử.
 *
 * Khác `deleteInsuranceOrder`: đường kia xoá hẳn dòng đơn lẫn dòng thời gian
 * của nó, nên sau đó không ai tra được đơn nào đã huỷ, ai huỷ và vì sao. Hai
 * đường cùng tồn tại: xoá dành cho đơn nhập nhầm, huỷ dành cho đơn có thật mà
 * khách hoặc PVI không làm nữa.
 *
 * Lý do BẮT BUỘC. Đó là toàn bộ giá trị của trạng thái này so với việc đặt tay
 * qua `overrideInsuranceOrderStatus`, nên nó được kiểm ở đây chứ không chỉ ở
 * route — route là một đường gọi, hàm này là chỗ luật sống.
 *
 * KHÔNG chặn theo trạng thái hiện tại, kể cả `done`. Quyền `set-status` vốn đã
 * đặt được đơn `done` sang bất kỳ đâu; chặn ở đây chỉ đẩy người ta sang đường
 * đặt tay, và đường đó không ghi lý do.
 */
export async function cancelInsuranceOrder(
  actor: User,
  id: string,
  note: string,
): Promise<InsuranceOutcome<InsuranceDetail> | null> {
  if (!can(actor, "insurance", "set-status")) return null;

  const reason = note.trim();
  if (reason.length < 2) return { ok: false, message: "Chưa nhập lý do huỷ." };

  const current = await rawById(id);
  if (!current) return null;

  if (current.status === "cancelled") return { ok: false, message: "Đơn này đã huỷ rồi." };

  const updated = await db
    .update(insuranceOrders)
    .set({ status: "cancelled", updatedAt: new Date() })
    // Kẹp theo trạng thái ĐANG đọc được, cùng lối `overrideInsuranceOrderStatus`.
    .where(and(eq(insuranceOrders.id, id), eq(insuranceOrders.status, current.status)))
    .returning({ id: insuranceOrders.id });

  if (updated.length === 0)
    return { ok: false, message: "Đơn này vừa đổi trạng thái. Tải lại trang rồi thử lại." };

  await db.insert(insuranceOrderStatusHistory).values({
    orderId: id,
    fromStatus: current.status,
    toStatus: "cancelled",
    changedBy: actor.id,
    note: reason,
  });

  return { ok: true, value: (await insuranceOrderDetail(actor, id))! };
}

/**
 * Đính/thay ảnh chứng nhận — dùng được ở MỌI trạng thái đơn (spec §3.4).
 *
 * Nhận URL chứ không nhận file: đẩy ảnh lên kho là việc của `/api/uploads`.
 *
 * Gác bằng `update` HOẶC `handle-fallback`, lấy tầm nhìn rộng hơn trong hai
 * cái. Chỉ gác `update` thì đội xử lý tay — những người đúng ra phải đính tờ
 * chứng nhận vừa lấy về từ PVI (spec §9.2) — không đính nổi ảnh nào, và cái
 * nút đó nằm chình ình trên P-14 của họ.
 */
export async function setCertificatePhoto(
  actor: User,
  id: string,
  /** KHOÁ trong kho, không phải URL — route đã cắt phần `/api/images/` ra. */
  photoKey: string,
): Promise<InsuranceDetail | null> {
  const byUpdate = scopeOf(actor, "update");
  const byFallback = scopeOf(actor, "handle-fallback");

  const current = await rawById(id);
  if (!current) return null;

  /**
   * Người ĐANG CẦM đơn cũng đính được ảnh, dù đơn do người khác lập.
   *
   * Hàng chờ làm tay là kho chung nên người nhận đơn hầu như không bao giờ là
   * người lập nó. Xét mỗi `created_by` thì đúng nhóm phải đính tờ chứng nhận
   * lấy về từ PVI (spec §9.2) lại là nhóm không đính được — và từ khi bước
   * "Đánh dấu hoàn thành" đòi ảnh, họ không hoàn thành nổi đơn nào.
   *
   * Cùng lối với `canSeeOrder`, chỉ khác là ĐÃ NHẬN mới tính: đơn còn nằm trong
   * kho chung thì ai cũng thấy, nhưng phải nhận về rồi mới ghi được vào nó.
   */
  const handling =
    current.handledById === actor.id && can(actor, "insurance", "handle-fallback");
  if (!handling && !inScope(byUpdate, current) && !inScope(byFallback, current)) return null;

  await db
    .update(insuranceOrders)
    .set({ certificatePhotoUrl: photoKey, updatedAt: new Date() })
    .where(eq(insuranceOrders.id, id));

  return { ...toOrder(actor, (await rawById(id))!), history: await historyOf(id) };
}

/**
 * Ghi số ấn chỉ và link file PDF giấy chứng nhận PVI gửi về ở callback mục 13.
 *
 * KHÔNG kiểm quyền: bên gọi là máy chủ PVI, không có phiên đăng nhập nào. Thứ
 * gác đường này là chữ ký MD5 mà `verifyPviCallback` đã kiểm trước khi tới đây.
 *
 * Tra đơn bằng `order_code` vì `RequestId` PVI trả lại chính là `ma_giaodich`
 * mình gửi lúc tạo đơn, mà mã đó lấy thẳng từ cột này.
 *
 * Chạy lại nhiều lần với cùng dữ liệu ra cùng kết quả — PVI gọi callback tối đa
 * 3 lần, và tác vụ tra `GetPolicyNumber` cũng ghi vào đúng cột này.
 *
 * `false` = không có đơn nào mang mã đó. Route trả mã lỗi cho PVI thay vì nuốt
 * lặng: gọi lại cũng không ra kết quả khác, nhưng ít nhất log hai bên cùng thấy.
 */
export async function savePviCertificate(
  requestId: string,
  certificate: { url: string; serialNumber: string },
): Promise<boolean> {
  const rows = await db
    .update(insuranceOrders)
    .set({
      pviCertificateUrl: certificate.url,
      pviSerialNumber: certificate.serialNumber,
      updatedAt: new Date(),
    })
    .where(eq(insuranceOrders.orderCode, requestId))
    .returning({ id: insuranceOrders.id });

  return rows.length > 0;
}
