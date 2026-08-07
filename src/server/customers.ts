import { and, asc, count, desc, eq, or, sql, type SQL } from "drizzle-orm";
import type {
  Customer,
  CustomerAccountRow,
  CustomerDetail,
  CustomerDraftAccountRow,
  CustomerForm,
  CustomerInsuranceRow,
  CustomerRow,
  CustomerServiceRow,
  CustomerSort,
  ExistingCustomer,
} from "@/lib/api/customers";
import type { Page } from "@/lib/api/pagination";
import type { PageArgs } from "./pagination";
import { BUSINESS_TIMEZONE, digitsOnly } from "@/lib/format";
import { can, recordVisibility, type RecordVisibility } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { db, uniqueViolationOf } from "./db/client";
import {
  bankAccounts,
  banks,
  channels,
  customerPhones,
  customers,
  giftGrants,
  insuranceOrders,
  referralCodes,
  serviceTypes,
  services,
  users,
} from "./db/schema";

/**
 * P-40 · P-41 · P-42 — bản DB của module khách hàng.
 *
 * Hồ sơ khách KHÔNG áp trục phạm vi (spec §2.1b): ai đăng nhập cũng đọc được cả
 * kho, vì không thì chặn trùng CCCD và ô tìm kiếm đều vô dụng. Chỉ BẢN GHI
 * NGHIỆP VỤ treo dưới khách — tài khoản ngân hàng, đơn bảo hiểm — mới lọc theo
 * phòng, và đó là việc của `customerDetailFor`.
 */

/** Số CCCD nhìn thấy được khi KHÔNG có `customer:access-id-number` — 4 số cuối. */
const last4 = (idNumber: string | null): string | null =>
  idNumber ? idNumber.slice(-4) : null;

const seesIdNumber = (actor: User): boolean => can(actor, "customer", "access-id-number");

/**
 * Vô hiệu ký tự đại diện của `LIKE` trong chữ người dùng gõ — gõ `%` phải ra
 * "không có kết quả", không phải ra nguyên cả kho.
 */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Ngày tạo theo múi giờ làm việc — cột là `timestamptz`, so ngày phải quy về VN. */
const createdDay = sql`(${customers.createdAt} at time zone ${BUSINESS_TIMEZONE})::date`;

const createdDayText = sql<string>`to_char(${customers.createdAt} at time zone ${BUSINESS_TIMEZONE}, 'YYYY-MM-DD')`;

const YEAR_MONTH_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type CustomerFilters = {
  search: string;
  channelId: string;
  from: string;
  to: string;
};

/**
 * Chia theo HÌNH DẠNG chữ người dùng gõ: có chữ cái thì tìm tên, toàn số thì
 * tìm số điện thoại và 4 số cuối CCCD.
 *
 * ⚠️ Đừng gộp cả ba nhánh bằng `or` cho gọn. Phép HOẶC bắc qua hai bảng khác
 * nhau (`customers` và `customer_phones`) chặn hết chỉ mục: Postgres buộc phải
 * duyệt từng khách một để thử cả ba vế. Đo ở 250.000 khách: gộp `or` mất 280ms,
 * tách nhánh còn ~2ms — và thêm chỉ mục cũng KHÔNG cứu được bản gộp, vì vấn đề
 * nằm ở hình dạng câu hỏi chứ không ở chỉ mục.
 *
 * Tách ra cũng đúng nghĩa hơn: tìm `"0912345"` trong tên khách thì không đời
 * nào khớp, còn tìm `"Trâm"` trong số điện thoại cũng vậy.
 *
 * Tìm theo 4 số cuối CCCD KHÔNG cần quyền `access-id-number`: đó là thứ nhân
 * viên đọc từ giấy tờ khách đang cầm để tra hồ sơ, và khớp một hậu tố không làm
 * lộ số đầy đủ.
 */
function searchWhere(raw: string): SQL | undefined {
  const text = raw.trim();
  if (!text) return undefined;

  const digits = digitsOnly(text);
  const allDigits = digits.length === text.replace(/\s/g, "").length;

  if (allDigits && digits.length >= 3) {
    const byPhone = sql`exists (select 1 from ${customerPhones} where ${customerPhones.customerId} = ${customers.id} and ${customerPhones.number} like ${`%${digits}%`})`;
    // Đúng 4 số thì chưa biết người dùng đang đọc đuôi SĐT hay đuôi CCCD — phải
    // thử cả hai. Chỉ ca này mới chịu giá của `or`, và nó hiếm.
    return digits.length === 4
      ? or(byPhone, sql`right(${customers.idNumber}, 4) = ${digits}`)
      : byPhone;
  }

  // Tìm tên: không dấu, không phân biệt thứ tự từ — cùng luật với `matchesSearch`
  // ở giao diện, `bich tram nguyen` vẫn ra `Nguyễn Thị Bích Trâm`. Mỗi từ một
  // điều kiện VÀ trên cột sinh `search_name`, có chỉ mục trigram đỡ.
  return and(
    ...text
      .split(/\s+/)
      .map(
        (term) =>
          sql`${customers.searchName} like '%' || mgst_normalize(${likeEscape(term)}) || '%' escape '\\'`,
      ),
  );
}

function customerFilters(query: CustomerFilters): SQL | undefined {
  const parts = [
    searchWhere(query.search),
    query.channelId ? eq(customers.channelId, query.channelId) : undefined,
    // Ngày sai định dạng thì BỎ QUA, không trả 400: link cũ hay ô địa chỉ gõ
    // nhầm không đáng làm hỏng cả màn (cùng lối nghĩ với `uuidParam`).
    YEAR_MONTH_DAY.test(query.from) ? sql`${createdDay} >= ${query.from}::date` : undefined,
    YEAR_MONTH_DAY.test(query.to) ? sql`${createdDay} <= ${query.to}::date` : undefined,
  ].filter(Boolean) as SQL[];

  return parts.length > 0 ? and(...parts) : undefined;
}

/**
 * Chọn ra ĐÚNG những khách của trang này, chỉ đụng bảng `customers`.
 *
 * Lọc, sắp và cắt trang xong hết ở đây rồi mới đi lấy phần phụ. Ngược lại — gộp
 * SĐT và số đếm cho cả kho rồi mới cắt — là cách viết đầu tiên, và nó tốn
 * 0,8 giây mỗi lần mở màn ở 250.000 khách vì phép gộp không cắt trang trước
 * được. Hai cột đếm nay lưu sẵn (trigger giữ) nên sắp theo chúng cũng nằm gọn
 * trong bảng này.
 */
const pickPage = (where: SQL | undefined, orderBy: SQL[], limit: number, offset: number) =>
  db
    .select({
      id: customers.id,
      fullName: customers.fullName,
      accountCount: customers.accountCount,
      insuranceCount: customers.insuranceCount,
      channelId: customers.channelId,
      // Cột tính bằng `sql` nằm trong truy vấn con thì BẮT BUỘC có bí danh —
      // không có thì câu ngoài không gọi tên nó được, drizzle ném lỗi lúc dựng.
      createdAt: createdDayText.as("created_day"),
    })
    .from(customers)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset)
    .as("page");

/**
 * Dán phần phụ vào 15 dòng đã chọn: SĐT chính, tên kênh, đợt tặng quà.
 *
 * `leftJoinLateral` = chạy lại cho TỪNG dòng của trang, tức 15 lần tra chỉ mục
 * chứ không phải một phép gộp trên cả bảng SĐT.
 *
 * SĐT rơi về số bất kỳ khi không dòng nào được đánh dấu chính: dữ liệu nhập
 * trước khi có ràng buộc vẫn còn, mà để trống ô SĐT thì nhìn ra như khách không
 * có số — người dùng đi sửa lại một hồ sơ vốn không sai.
 */
function decorate(page: ReturnType<typeof pickPage>) {
  const phone = db
    .select({
      number:
        sql<string>`coalesce(min(${customerPhones.number}) filter (where ${customerPhones.isPrimary}), min(${customerPhones.number}))`.as(
          "number",
        ),
    })
    .from(customerPhones)
    .where(eq(customerPhones.customerId, page.id))
    .as("phone");

  return db
    .select({
      id: page.id,
      fullName: page.fullName,
      primaryPhone: sql<string>`coalesce(${phone.number}, '')`,
      accountCount: page.accountCount,
      insuranceCount: page.insuranceCount,
      giftStatus: sql<
        CustomerRow["giftStatus"]
      >`case when ${giftGrants.id} is null then 'none' else 'given' end`,
      givenItem: giftGrants.chosenItem,
      channel: sql<string>`coalesce(${channels.name}, '')`,
      createdAt: page.createdAt,
    })
    .from(page)
    .leftJoinLateral(phone, sql`true`)
    .leftJoin(giftGrants, eq(giftGrants.customerId, page.id))
    .leftJoin(channels, eq(channels.id, page.channelId));
}

/**
 * MỘT trang khách hàng, đã lọc/tìm/sắp sẵn (AGENTS.md §5.1).
 *
 * Tổng đếm bằng câu thứ hai trên ĐÚNG bộ lọc đó, không phải `rows.length`: nói
 * nhầm thì thanh phân trang hiện "1–15 trên 15" ở mọi trang.
 *
 * TODO(P-40, chờ nối `giftFor` vào câu truy vấn): cột trạng thái quà chỉ phân
 * biệt được "đã tặng" (có dòng `gift_grants`) với "chưa" — chưa tính `eligible`.
 *
 * Luật quà đã có (`src/rules/2026-08.ts`), nhưng nó là hàm JavaScript nên chạy
 * được nó cho từng khách nghĩa là kéo tài khoản của CẢ KHO về rồi lọc ở tầng
 * ứng dụng — đúng thứ AGENTS.md §5.2 cấm, vì P-40 có ô LỌC theo trạng thái quà.
 * Cách đi được: một cột lưu sẵn do `giftFor` ghi lại mỗi lần tài khoản của khách
 * đổi, cùng lối `customers.account_count`. Gỡ mốc ở cả hai đầu; đầu kia ở
 * `lib/api/customers.ts`.
 */
export async function listCustomers(
  filters: CustomerFilters,
  page: PageArgs<CustomerSort>,
): Promise<Page<CustomerRow>> {
  const where = customerFilters(filters);
  const direction = page.dir === "asc" ? asc : desc;

  /**
   * MỌI kiểu sắp đều kết thúc bằng `id`, và đây là điều kiện bắt buộc chứ không
   * phải cho đẹp.
   *
   * Trang 1 và trang 2 là hai câu hỏi RIÊNG BIỆT gửi tới database. Không có
   * khoá phụ duy nhất thì thứ tự giữa những dòng BẰNG NHAU ở cột chính là không
   * xác định — Postgres không hứa gì, và nó bám theo VỊ TRÍ VẬT LÝ của dòng.
   *
   * Chỗ hoà thật là TRÙNG TÊN, không phải trùng thời gian. Đã dựng lại được:
   * 6 khách cùng tên "Nguyễn Văn An", sắp theo tên, đọc ra thứ tự A→F; sửa một
   * hồ sơ bất kỳ (đổi địa chỉ thôi) rồi đọc lại thì hồ sơ đó NHẢY XUỐNG CUỐI —
   * sửa một dòng là Postgres ghi bản mới ở cuối bảng. Hồ sơ đang là dòng thứ 15
   * mà bị sửa thì sang trang 2 nó hiện lại, còn một khách khác rơi khỏi cả hai
   * trang. Trùng tên ở Việt Nam là chuyện thường ngày.
   *
   * Trùng `created_at` thì KHÔNG xảy ra với luồng hiện tại — đã đo: mỗi khách
   * tạo trong một transaction riêng nên mốc thời gian cách nhau vài mili giây.
   * Chỉ trùng khi nhiều dòng đi chung MỘT transaction (`now()` là giờ mở
   * transaction, không phải giờ từng dòng), tức lúc có màn nhập hàng loạt.
   */
  const orderBy = {
    // Sắp theo cột đã bỏ dấu, không theo `full_name`: Postgres xếp `Đặng` sau
    // `Zũng` với collate mặc định, người dùng đọc ra là bảng sắp sai.
    name: [direction(customers.searchName), asc(customers.id)],
    accounts: [direction(customers.accountCount), asc(customers.searchName), asc(customers.id)],
    insurance: [direction(customers.insuranceCount), asc(customers.searchName), asc(customers.id)],
    created: [direction(customers.createdAt), asc(customers.id)],
  }[page.sort] as SQL[];

  const [rows, [totals]] = await Promise.all([
    decorate(pickPage(where, orderBy, page.limit, page.offset)),
    db.select({ value: count() }).from(customers).where(where),
  ]);

  return { rows, total: totals?.value ?? 0 };
}

/**
 * Trần cứng của một lượt xuất Excel. Vượt trần thì cắt — file 50.000 dòng không
 * ai mở ra để đọc, và dựng nó là giữ một kết nối DB cùng cả chỗ nhớ ấy rất lâu.
 */
const EXPORT_LIMIT = 20_000;

/**
 * TRỌN danh sách khớp bộ lọc, cho việc xuất Excel — đi route riêng chứ KHÔNG mở
 * tham số "lấy hết" trên route đã phân trang (AGENTS.md §5.1, điều 4).
 *
 * Route đó là chỗ mọi màn sau lách: thêm `?all=1` một lần thì lần sau có người
 * dùng nó để đổ cả kho vào một ô chọn. Ở đây là đường riêng, gác bằng quyền
 * `customer:export`, và có trần rõ ràng.
 *
 * Trả kèm `total` — tổng số dòng KHỚP BỘ LỌC, có thể lớn hơn `rows.length` khi
 * chạm trần. Nơi gọi BẮT BUỘC so hai số này: đưa ra một file thiếu 5.000 dòng
 * mà không nói gì thì người nhận đọc nó như báo cáo đầy đủ, và không có cách
 * nào phát hiện.
 */
export async function listCustomersForExport(
  filters: CustomerFilters,
): Promise<{ rows: CustomerRow[]; total: number }> {
  const where = customerFilters(filters);
  const [rows, [totals]] = await Promise.all([
    decorate(pickPage(where, [desc(customers.createdAt), asc(customers.id)] as SQL[], EXPORT_LIMIT, 0)),
    db.select({ value: count() }).from(customers).where(where),
  ]);
  return { rows, total: totals?.value ?? 0 };
}

/* ── P-41 · Tạo / sửa ─────────────────────────────────────────────────── */

async function customerById(id: string, actor: User): Promise<Customer | null> {
  const [row] = await db
    .select({
      id: customers.id,
      fullName: customers.fullName,
      dob: customers.dob,
      idNumber: customers.idNumber,
      address: customers.address,
      channelId: customers.channelId,
      channel: sql<string>`coalesce(${channels.name}, '')`,
      channelDetail: customers.channelDetail,
      createdAt: createdDayText,
    })
    .from(customers)
    .leftJoin(channels, eq(channels.id, customers.channelId))
    .where(eq(customers.id, id))
    .limit(1);
  if (!row) return null;

  const phones = await db
    .select({ id: customerPhones.id, number: customerPhones.number, primary: customerPhones.isPrimary })
    .from(customerPhones)
    .where(eq(customerPhones.customerId, id))
    .orderBy(desc(customerPhones.isPrimary), asc(customerPhones.number));

  const full = seesIdNumber(actor);
  return {
    ...row,
    channelId: row.channelId ?? "",
    idNumber: full ? row.idNumber : last4(row.idNumber),
    idNumberMasked: !full,
    phones,
  };
}

/** Hồ sơ đang giữ CCCD trùng — kèm đủ số liệu để người nhập dùng lại ngay. */
async function existingByIdNumber(idNumber: string): Promise<ExistingCustomer | null> {
  const [row] = await decorate(pickPage(eq(customers.idNumber, idNumber), [], 1, 0));
  return row
    ? {
        id: row.id,
        fullName: row.fullName,
        primaryPhone: row.primaryPhone,
        accountCount: row.accountCount,
        insuranceCount: row.insuranceCount,
      }
    : null;
}

/**
 * Trùng CCCD KHÔNG phải lỗi ngõ cụt (spec §2.1) — trả kèm hồ sơ đã có để người
 * nhập bấm "Dùng hồ sơ này", thay vì bắt họ tự đi tìm.
 */
export type CustomerOutcome<T> =
  | { ok: true; customer: T }
  | { ok: false; existing: ExistingCustomer | null };

/** Đúng MỘT số chính. Form nào cũng gửi cờ, nhưng không tin — index sẽ chặn. */
const phoneRows = (customerId: string, form: CustomerForm) => {
  const primaryAt = Math.max(
    0,
    form.phones.findIndex((p) => p.primary),
  );
  return form.phones.map((p, i) => ({
    customerId,
    number: p.number,
    isPrimary: i === primaryAt,
  }));
};

async function writeGuarded<T>(
  run: () => Promise<T>,
  idNumber: string,
): Promise<CustomerOutcome<T>> {
  try {
    return { ok: true, customer: await run() };
  } catch (e) {
    if (uniqueViolationOf(e) === null) throw e;
    return { ok: false, existing: idNumber ? await existingByIdNumber(idNumber) : null };
  }
}

export async function createCustomer(
  actor: User,
  form: CustomerForm,
): Promise<CustomerOutcome<Customer>> {
  return writeGuarded(async () => {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(customers)
        .values({
          fullName: form.fullName,
          // Ô ngày để trống gửi lên chuỗi rỗng, mà cột là `date` — vào thẳng là
          // lỗi cast, không phải "chưa có ngày sinh".
          dob: form.dob || null,
          idNumber: form.idNumber || null,
          address: form.address,
          channelId: form.channelId || null,
          channelDetail: form.channelDetail,
          createdBy: actor.id,
        })
        .returning({ id: customers.id });
      await tx.insert(customerPhones).values(phoneRows(row.id, form));
      return row.id;
    });

    return (await customerById(id, actor))!;
  }, form.idNumber);
}

/**
 * Sửa hồ sơ. Người KHÔNG có `access-id-number` sửa được mọi thứ trừ CCCD.
 *
 * Bỏ qua ô CCCD họ gửi lên thay vì trả 403: giao diện chỉ đưa cho họ 4 số cuối,
 * nên thứ quay về máy chủ là `"4871"` — nhận vào là ghi đè số thật bằng 4 ký
 * tự. Khoá một chiều ở đây thì kể cả request nặn tay cũng không xoá được số.
 */
export async function updateCustomer(
  actor: User,
  id: string,
  form: CustomerForm,
): Promise<CustomerOutcome<Customer> | null> {
  const full = seesIdNumber(actor);

  const result = await writeGuarded(async () => {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(customers)
        .set({
          fullName: form.fullName,
          dob: form.dob || null,
          ...(full ? { idNumber: form.idNumber || null } : {}),
          address: form.address,
          channelId: form.channelId || null,
          channelDetail: form.channelDetail,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, id))
        .returning({ id: customers.id });
      if (!row) return false;

      await tx.delete(customerPhones).where(eq(customerPhones.customerId, id));
      await tx.insert(customerPhones).values(phoneRows(id, form));
      return true;
    });

    return updated ? await customerById(id, actor) : null;
  }, full ? form.idNumber : "");

  if (!result.ok) return result;
  return result.customer ? { ok: true, customer: result.customer } : null;
}

/* ── P-42 · Hồ sơ 360° ────────────────────────────────────────────────── */

/**
 * Bản ghi nghiệp vụ của khách CÓ áp phạm vi, khác hẳn hồ sơ ở trên.
 *
 * `chỉ mình` nghĩa là bản ghi do CHÍNH MÌNH tạo (spec §1.1.2) — xem ghi chú ở
 * `recordVisibility`. Phần bị giấu vẫn được đếm và nói ra, không giấu im.
 */
const scopeOf = (actor: User, module: "banking" | "insurance" | "services"): RecordVisibility =>
  recordVisibility(actor, module, "view-detail");

/**
 * Hồ sơ 360° — thông tin khách (không phạm vi) + bản ghi nghiệp vụ (có phạm vi).
 *
 * Số dòng bị giấu trả về dạng ĐẾM chứ không giấu im: khách có 5 tài khoản mà
 * người xem chỉ thấy 2, không nói ra thì họ mở thêm một tài khoản trùng.
 */
export async function customerDetailFor(
  actor: User,
  id: string,
): Promise<CustomerDetail | null> {
  const customer = await customerById(id, actor);
  if (!customer) return null;

  const bankingVisible = scopeOf(actor, "banking");
  const insuranceVisible = scopeOf(actor, "insurance");
  const servicesVisible = scopeOf(actor, "services");

  const [accountRows, insuranceRows, serviceRows, [grant]] = await Promise.all([
    db
      .select({
        id: bankAccounts.id,
        status: bankAccounts.status,
        date: bankAccounts.openedDate,
        bankName: banks.code,
        referralCode: referralCodes.code,
        appInstalled: bankAccounts.appInstalled,
        departmentId: bankAccounts.createdByDepartmentId,
        createdById: bankAccounts.createdBy,
      })
      .from(bankAccounts)
      .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
      .innerJoin(referralCodes, eq(referralCodes.id, bankAccounts.referralCodeId))
      .where(eq(bankAccounts.customerId, id))
      .orderBy(desc(bankAccounts.openedDate)),
    db
      .select({
        id: insuranceOrders.id,
        // Ngày ĐƠN, không phải ngày hiệu lực (chốt 07/08).
        date: insuranceOrders.orderDate,
        product: insuranceOrders.product,
        packageName: insuranceOrders.packageName,
        status: insuranceOrders.status,
        source: insuranceOrders.source,
        departmentId: insuranceOrders.createdByDepartmentId,
        createdById: insuranceOrders.createdBy,
      })
      .from(insuranceOrders)
      .where(eq(insuranceOrders.customerId, id))
      .orderBy(desc(insuranceOrders.orderDate)),
    db
      .select({
        id: services.id,
        date: services.serviceDate,
        serviceTypeName: serviceTypes.name,
        createdByName: users.fullName,
        note: services.note,
        departmentId: services.createdByDepartmentId,
        createdById: services.createdBy,
      })
      .from(services)
      .innerJoin(serviceTypes, eq(serviceTypes.id, services.serviceTypeId))
      // leftJoin: người thực hiện có thể đã bị xoá khỏi hệ thống, mà lượt dịch
      // vụ thì vẫn đã xảy ra — innerJoin làm dòng đó biến mất không báo gì.
      .leftJoin(users, eq(users.id, services.createdBy))
      .where(eq(services.customerId, id))
      .orderBy(desc(services.serviceDate)),
    db.select().from(giftGrants).where(eq(giftGrants.customerId, id)).limit(1),
  ]);

  // Lọc phạm vi ở app chứ không thêm `where` vào hai câu trên: phải biết TỔNG
  // mới đếm được phần bị giấu, mà một khách chỉ có vài chục bản ghi.
  const visible = <T extends { departmentId: string | null; createdById: string | null }>(
    rows: T[],
    allowed: RecordVisibility,
  ): T[] => {
    switch (allowed.kind) {
      case "all":
        return rows;
      case "departments":
        return rows.filter(
          (r) => r.departmentId !== null && allowed.departmentIds.includes(r.departmentId),
        );
      case "creator":
        return rows.filter((r) => r.createdById === allowed.userId);
      default:
        return [];
    }
  };

  const doneAccounts = accountRows.filter((a) => a.status === "done");
  const draftAccounts = accountRows.filter((a) => a.status === "creating");
  const visibleDone = visible(doneAccounts, bankingVisible);
  const visibleDrafts = visible(draftAccounts, bankingVisible);
  const visibleInsurance = visible(insuranceRows, insuranceVisible);
  const visibleServices = visible(serviceRows, servicesVisible);

  const accounts: CustomerAccountRow[] = visibleDone.map((a) => ({
    id: a.id,
    date: a.date ?? "",
    bankName: a.bankName,
    referralCode: a.referralCode,
    appInstalled: a.appInstalled,
  }));

  const drafts: CustomerDraftAccountRow[] = visibleDrafts.map((a) => ({
    id: a.id,
    bankName: a.bankName,
    referralCode: a.referralCode,
  }));

  const insurance: CustomerInsuranceRow[] = visibleInsurance.map((i) => ({
    id: i.id,
    date: i.date,
    product: i.product,
    packageName: i.packageName,
    status: i.status,
    source: i.source,
  }));

  const servicesDone: CustomerServiceRow[] = visibleServices.map((s) => ({
    id: s.id,
    date: s.date,
    serviceTypeName: s.serviceTypeName,
    // Người thực hiện đã bị xoá khỏi hệ thống thì vẫn phải hiện lượt dịch vụ,
    // chỉ là không biết ai làm.
    createdByName: s.createdByName ?? "—",
    note: s.note,
  }));

  return {
    customer,
    accounts,
    accountsHiddenCount: doneAccounts.length - visibleDone.length,
    draftAccounts: drafts,
    draftAccountsHiddenCount: draftAccounts.length - visibleDrafts.length,
    insurance,
    insuranceHiddenCount: insuranceRows.length - visibleInsurance.length,
    services: servicesDone,
    servicesHiddenCount: serviceRows.length - visibleServices.length,
    /**
     * TODO(P-42, chờ nối `giftFor`): rổ quà và tiền mặt luôn RỖNG.
     *
     * Luật đã có (`src/rules/2026-08.ts` — `gift`), chỉ còn việc gọi: gom tài
     * khoản `done` của khách + mã kênh + mã phòng người phụ trách, gọi `giftFor`,
     * rồi đổi mã món trong kết quả sang tên trong danh mục `gift_items` /
     * `insurance_packages`.
     *
     * Trả 0 và mảng rỗng chứ không bịa số: một con số khác 0 trông như đã tính
     * xong, nhân viên sẽ đọc nó rồi đi phát quà. Đợt đã chốt thì lấy đúng
     * snapshot đóng băng trong `gift_grants` — đó là số THẬT đã phát.
     */
    gift: {
      cashTotal: grant?.cashTotal ?? 0,
      cashBreakdown: [],
      basket: [],
      kpiPoints: 0,
      kpiBreakdown: [],
      given: Boolean(grant),
      givenItem: grant?.chosenItem ?? null,
    },
  };
}
