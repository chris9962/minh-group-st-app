import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type {
  Customer,
  CustomerAccountRow,
  CustomerDetail,
  CustomerDraftAccountRow,
  CustomerEditForm,
  CustomerForm,
  CustomerInsuranceRow,
  CustomerLookupResult,
  CustomerRow,
  CustomerServiceRow,
  CustomerSort,
} from "@/lib/api/customers";
import { GIFT_DECLINED, GIFT_DECLINED_LABEL } from "@/lib/api/customers";
import { MAX_BANK_ACCOUNTS_PER_CUSTOMER } from "@/lib/api/bankAccounts";
import type { Page } from "@/lib/api/pagination";
import type { PageArgs } from "./pagination";
import { BUSINESS_TIMEZONE, digitsOnly, searchKey } from "@/lib/format";
import { can, recordInScope, recordVisibility, type RecordVisibility } from "@/lib/permissions";
import type { GiftSimulateResult } from "@/lib/api/settings";
import { isRealIsoDate, type User } from "@/lib/types";
import { searchTerms } from "@/lib/search";
import { db, uniqueViolationOf } from "./db/client";
import { giftForCustomer, giftItemNames, grantedItemLabel, recomputeGiftCase } from "./gift";
import { bankingPointsByCustomer } from "./kpi";
import {
  bankAccounts,
  banks,
  channels,
  customerChangeField,
  customerChanges,
  customerPhones,
  customers,
  departments,
  giftGrantChanges,
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
 * Phạm vi ở module này do NƠI GỌI quyết. Bảng P-40 truyền
 * `departmentIds`/`createdBy` theo quyền người xem; ô tìm khách của ba hộp
 * thoại cũng nhận `actor` và kẹp theo đúng `customer:view-detail`. Nhờ vậy ô
 * chọn khách không trở thành đường vòng xem cả kho khách hàng.
 *
 * Bản ghi nghiệp vụ treo dưới khách — tài khoản ngân hàng, đơn bảo hiểm — lọc
 * theo phòng ở một đường riêng, việc của `customerDetailFor`.
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

export type CustomerFilters = {
  search: string;
  channelId: string;
  /**
   * Chi tiết kênh, so khớp ĐÚNG CHUỖI. Rỗng hoặc thiếu = không lọc.
   *
   * Cột lưu TÊN chứ không lưu id, cùng lối với `channelDetail` của tài khoản
   * ngân hàng. Giá trị gửi lên là tên bệnh viện, không phải uuid.
   */
  channelDetail?: string;
  from: string;
  to: string;
  /** Rỗng = không lọc. Route P-40 đặt = id người xem khi họ là Nhân viên. */
  createdBy?: string;
  /**
   * Rỗng hoặc thiếu = không lọc theo phòng.
   *
   * CHỈ màn danh sách P-40 đặt trường này (chốt 2026-08-23): cấp quản lý mở
   * trang Khách hàng thì thấy khách phòng mình, không phải cả công ty.
   *
   * Ô tìm khách của ba hộp thoại — Mở tài khoản, Tạo đơn bảo hiểm, Ghi dịch vụ
   * — CỐ Ý không đặt, vì spec §2.1b: nhân viên phải tìm ra khách đồng nghiệp đã
   * lập, nếu không họ lập hồ sơ trùng.
   */
  departmentIds?: string[];
  /**
   * Phòng do NGƯỜI DÙNG chọn ở ô lọc, rỗng hoặc thiếu = không lọc.
   *
   * Tách khỏi `departmentIds` vì hai thứ khác nghĩa: trường trên là phạm vi
   * người xem được phép đọc, trường này là câu hỏi họ đặt trong phạm vi đó. Hai
   * điều kiện nối bằng VÀ, nên chọn phòng ngoài phạm vi cho ra bảng rỗng chứ
   * không nới phạm vi.
   */
  departmentId?: string;
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
    ...searchTerms(text).map(
      (term) =>
        sql`${customers.searchName} like '%' || mgst_normalize(${likeEscape(term)}) || '%' escape '\\'`,
    ),
  );
}

function customerFilters(query: CustomerFilters): SQL | undefined {
  const parts = [
    searchWhere(query.search),
    query.createdBy ? eq(customers.createdBy, query.createdBy) : undefined,
    // Danh sách rỗng nghĩa là "không phòng nào" — người có quyền nhưng chưa
    // được giao phòng nào thì thấy bảng rỗng, không phải thấy cả kho.
    query.departmentIds ? inArray(customers.createdByDepartmentId, query.departmentIds) : undefined,
    query.departmentId ? eq(customers.createdByDepartmentId, query.departmentId) : undefined,
    query.channelId ? eq(customers.channelId, query.channelId) : undefined,
    query.channelDetail ? eq(customers.channelDetail, query.channelDetail) : undefined,
    // Ngày sai định dạng thì BỎ QUA, không trả 400: link cũ hay ô địa chỉ gõ
    // nhầm không đáng làm hỏng cả màn (cùng lối nghĩ với `uuidParam`).
    usableDate(query.from) ? sql`${createdDay} >= ${query.from}::date` : undefined,
    usableDate(query.to) ? sql`${createdDay} <= ${query.to}::date` : undefined,
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
      seq: customers.seq,
      rootId: customers.rootCustomerId,
      accountCount: customers.accountCount,
      insuranceCount: customers.insuranceCount,
      giftBasket: customers.giftBasket,
      channelId: customers.channelId,
      createdBy: customers.createdBy,
      createdByDepartmentId: customers.createdByDepartmentId,
      // Cột tính bằng `sql` nằm trong truy vấn con thì BẮT BUỘC có bí danh —
      // không có thì câu ngoài không gọi tên nó được, drizzle ném lỗi lúc dựng.
      createdAt: createdDayText.as("created_day"),
      /*
       * Ba cột dưới không hiện ở màn nào — có mặt CHỈ để câu ngoài sắp lại được
       * (xem `orderOuter`). `createdDayText` bên trên là NGÀY, không dùng để sắp
       * được: cắt mất giờ thì mọi khách tạo cùng ngày lại hoà.
       */
      searchName: customers.searchName,
      createdInstant: customers.createdAt,
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
      seq: page.seq,
      rootId: page.rootId,
      accountCount: page.accountCount,
      insuranceCount: page.insuranceCount,
      /**
       * Ba trạng thái đọc từ HAI nguồn lưu sẵn, không chạy luật ở đây: đợt đã
       * chốt nằm ở `gift_grants`, còn "đủ điều kiện" là cột
       * `customers.gift_basket` do `recomputeGiftCase` ghi. Rổ rỗng nghĩa là
       * không có gì để phát — kể cả khách chưa đạt bậc nào nhưng có món thêm. Chạy hàm luật cho từng dòng thì phải kéo tài
       * khoản của cả kho về tầng ứng dụng (AGENTS.md §5.2).
       */
      giftStatus: sql<CustomerRow["giftStatus"]>`case
        when ${giftGrants.id} is not null then 'given'
        when cardinality(${page.giftBasket}) > 0 then 'eligible'
        else 'none' end`,
      /**
       * `chosen_item` giữ MÃ món (#74). Chữ hiện lên lấy TÊN LÚC PHÁT trong
       * `snapshot.basket`, không tra danh mục hiện tại: đợt đã phát phải đóng
       * băng (spec §5.3). Mã lạ thì trả về chính mã, để ô không trống trơn.
       */
      givenItem: sql<string | null>`case
        when ${giftGrants.id} is null then null
        when ${giftGrants.chosenItem} = ${GIFT_DECLINED} then ${GIFT_DECLINED_LABEL}
        else coalesce(
          (select b->>'name' from jsonb_array_elements(${giftGrants.snapshot}->'basket') b
            where b->>'code' = ${giftGrants.chosenItem} limit 1),
          ${giftGrants.chosenItem}) end`,
      channel: sql<string>`coalesce(${channels.name}, '')`,
      createdAt: page.createdAt,
      createdByName: sql<string>`coalesce(${users.fullName}, '')`,
      /**
       * Phòng LÚC LẬP hồ sơ, không phải phòng người đó đang thuộc về — người
       * chuyển phòng thì hồ sơ cũ vẫn thuộc phòng đã lập nó.
       */
      createdByDepartmentName: sql<string>`coalesce(${departments.name}, '')`,
      /**
       * Hai cột dưới KHÔNG hiện ở màn nào — chúng để giao diện ẩn nút Sửa đúng
       * dòng, dùng chung `recordInScope` với máy chủ (AGENTS.md §6). Hai bản
       * chép tay là hai chỗ sớm muộn lệch nhau.
       */
      createdById: page.createdBy,
      createdByDepartmentId: page.createdByDepartmentId,
      primaryPhone: sql<string>`coalesce(${phone.number}, '')`,
      /**
       * ĐẾM SỐNG, không đọc `customers.account_count`: cột đó chỉ đếm dòng
       * `done` (migration 0005), còn trần tính cả bản nháp `creating`.
       *
       * Một lượt tra chỉ mục `bank_accounts_customer` cho mỗi dòng của TRANG,
       * không phải phép gộp trên cả bảng — trang đã cắt xong ở `pickPage`
       * (AGENTS.md §5.2 cách A).
       */
      // Không đếm dòng HKD: nó không phải ngân hàng nên không chiếm chỗ trong
      // trần 3 (chốt 2026-09-06). Cùng phép đếm với `startBankAccount`.
      bankSlotsLeft: sql<number>`greatest(0, ${MAX_BANK_ACCOUNTS_PER_CUSTOMER} - (
        select count(*) from ${bankAccounts}
        where ${bankAccounts.customerId} = ${page.id} and ${bankAccounts.accountType} <> 'HKD'
      ))::int`,
    })
    .from(page)
    .leftJoinLateral(phone, sql`true`)
    .leftJoin(giftGrants, eq(giftGrants.customerId, page.id))
    .leftJoin(channels, eq(channels.id, page.channelId))
    .leftJoin(users, eq(users.id, page.createdBy))
    .leftJoin(departments, eq(departments.id, page.createdByDepartmentId));
}

/**
 * Khoá sắp của MỘT kiểu sắp, dựng từ bất kỳ nguồn cột nào — bảng gốc hay câu con.
 *
 * Một định nghĩa dùng cho cả hai tầng. Chép ra hai chỗ là có ngày chúng lệch
 * nhau, và lệch thì bảng sắp một đằng còn trang cắt một nẻo.
 */
const orderKeys = (
  c: {
    searchName: SQLWrapper;
    accountCount: SQLWrapper;
    insuranceCount: SQLWrapper;
    createdAt: SQLWrapper;
    id: SQLWrapper;
  },
  sort: CustomerSort,
  dir: "asc" | "desc",
): SQL[] => {
  const direction = dir === "asc" ? asc : desc;
  return {
    // Sắp theo cột đã bỏ dấu, không theo `full_name`: Postgres xếp `Đặng` sau
    // `Zũng` với collate mặc định, người dùng đọc ra là bảng sắp sai.
    name: [direction(c.searchName), asc(c.id)],
    accounts: [direction(c.accountCount), asc(c.searchName), asc(c.id)],
    insurance: [direction(c.insuranceCount), asc(c.searchName), asc(c.id)],
    created: [direction(c.createdAt), asc(c.id)],
  }[sort] as SQL[];
};

/**
 * MỘT trang khách hàng, đã lọc/tìm/sắp sẵn (AGENTS.md §5.1).
 *
 * Tổng đếm bằng câu thứ hai trên ĐÚNG bộ lọc đó, không phải `rows.length`: nói
 * nhầm thì thanh phân trang hiện "1–15 trên 15" ở mọi trang.
 *
 */
export async function listCustomers(
  filters: CustomerFilters,
  page: PageArgs<CustomerSort>,
): Promise<Page<CustomerRow>> {
  const where = customerFilters(filters);

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
  const inner = pickPage(where, orderKeys(customers, page.sort, page.dir), page.limit, page.offset);

  /**
   * Sắp LẠI ở câu ngoài, CÙNG một `orderKeys`, chỉ khác nguồn cột.
   *
   * ⚠️ PHÉP NỐI KHÔNG GIỮ THỨ TỰ. Câu con sắp xong rồi cắt trang, nhưng câu
   * ngoài còn nối SĐT, đợt quà và kênh — Postgres chọn Hash Join thì thứ tự đầu
   * vào biến mất sạch. Nó "chạy đúng" khi ít dữ liệu chỉ vì kế hoạch tình cờ là
   * Nested Loop, nên thêm dữ liệu vào là bảng loạn mà không ai đổi dòng code nào.
   *
   * `createdAt` của câu con là NGÀY dạng chữ (để hiện), nên nguồn cột ở đây trỏ
   * `createdInstant` — mốc thô. Sắp theo ngày thì mọi khách tạo cùng ngày lại hoà.
   */
  const [rows, [totals]] = await Promise.all([
    decorate(inner).orderBy(
      ...orderKeys(
        {
          searchName: inner.searchName,
          accountCount: inner.accountCount,
          insuranceCount: inner.insuranceCount,
          createdAt: inner.createdInstant,
          id: inner.id,
        },
        page.sort,
        page.dir,
      ),
    ),
    db.select({ value: count() }).from(customers).where(where),
  ]);

  /* Cột Điểm chỉ có nghĩa khi người xem đã chọn khoảng ngày: luật điểm là luật
     của một tháng, và ô lọc buộc khoảng nằm trọn một tháng nên `from` đủ nói
     tháng nào. Chưa lọc thì trả `null`, màn để trống ô đó. */
  const points = filters.from
    ? await bankingPointsByCustomer(rows.map((r) => r.id), filters.from.slice(0, 7))
    : null;

  return {
    rows: rows.map((r) => ({ ...r, points: points ? (points.get(r.id) ?? 0) : null })),
    total: totals?.value ?? 0,
  };
}

/**
 * Trần cứng của một lượt TRA CỨU. Không có tham số nào nới được nó.
 *
 * Đây là thứ phân biệt tra cứu với liệt kê: gõ từ khoá ra 15 người gần đúng
 * nhất là tra cứu, lật trang tới người thứ 250.000 là đọc cả kho.
 */
/**
 * Số tài khoản ngân hàng của khách, ĐẾM SỐNG.
 *
 * Không đọc `customers.account_count`: cột đó chỉ đếm dòng `done` (migration
 * 0005), còn trần 3 tài khoản tính cả bản nháp `creating` vì bản nháp đã giữ
 * một chỗ mã giới thiệu.
 */
// Không đếm dòng HKD, cùng phép đếm trần với `startBankAccount` (chốt 2026-09-06).
const bankAccountsOfCustomer = sql`(select count(*) from ${bankAccounts} where ${bankAccounts.customerId} = ${customers.id} and ${bankAccounts.accountType} <> 'HKD')`;

const LOOKUP_LIMIT = 15;

/** Điều kiện phạm vi cho ô tìm khách, tính từ quyền đọc hồ sơ khách. */
function lookupScope(actor: User): SQL {
  const visible = recordVisibility(actor, "customer", "view-detail");
  switch (visible.kind) {
    case "all":
      return sql`true`;
    case "departments":
      return inArray(customers.createdByDepartmentId, visible.departmentIds);
    case "creator":
      return eq(customers.createdBy, visible.userId);
    case "none":
      return sql`false`;
  }
}

/**
 * TRA CỨU khách theo từ khoá — ô tìm khách của ba hộp thoại tạo bản ghi.
 *
 * Phạm vi giống danh sách khách P-40: quyền `customer:view-detail` là `own`
 * thì chỉ thấy khách mình lập; `managed` thì thấy khách do các phòng mình quản
 * lập; `company` thì thấy toàn công ty. Điều kiện này chạy ở máy chủ nên không
 * thể nới rộng bằng cách tự gọi API.
 *
 * Đổi lại, đường này hẹp hết mức có thể mà vẫn làm được việc đó: không nhận
 * `page`, không trả `total`, chỉ ba trường. Không có địa chỉ, không có ngày
 * sinh, không có bốn số cuối CCCD — chúng nằm ở `/api/customers/[id]`, và mở
 * một hồ sơ cụ thể có ghi nhật ký.
 *
 * Sắp theo tên chứ không theo ngày tạo: người dùng đang tìm một cái tên.
 */
export async function lookupCustomers(
  actor: User,
  search: string,
  opts: { forBankAccount?: boolean } = {},
): Promise<CustomerLookupResult> {
  const match = searchWhere(search);
  const scope = lookupScope(actor);
  const where = opts.forBankAccount
    ? and(scope, match, sql`${bankAccountsOfCustomer} < ${MAX_BANK_ACCOUNTS_PER_CUSTOMER}`)
    : and(scope, match);

  const inner = pickPage(
    where,
    [asc(customers.searchName), asc(customers.id)] as SQL[],
    LOOKUP_LIMIT,
    0,
  );
  const rows = await decorate(inner)
    .orderBy(asc(inner.searchName), asc(inner.id))
    .then((list) =>
      list.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        primaryPhone: r.primaryPhone,
        seq: r.seq,
        rootId: r.rootId,
      })),
    );

  /**
   * Chỉ đếm khi người dùng ĐÃ gõ gì đó. Ô tìm để trống thì `match` là
   * `undefined`, và câu đếm quét cả bảng khách để trả lời một câu không ai hỏi.
   */
  if (!opts.forBankAccount || !match) return { rows, hiddenBankFull: 0 };

  const [hidden] = await db
    .select({ n: count() })
    .from(customers)
    .where(and(scope, match, sql`${bankAccountsOfCustomer} >= ${MAX_BANK_ACCOUNTS_PER_CUSTOMER}`));

  return { rows, hiddenBankFull: hidden?.n ?? 0 };
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
  const inner = pickPage(
    where,
    [desc(customers.createdAt), asc(customers.id)] as SQL[],
    EXPORT_LIMIT,
    0,
  );
  const [rows, [totals]] = await Promise.all([
    // Sắp lại ở câu ngoài y như `listCustomers` — phép nối không giữ thứ tự, mà
    // file Excel xáo dòng thì người nhận không nhìn ra là sai.
    decorate(inner).orderBy(desc(inner.createdInstant), asc(inner.id)),
    db.select({ value: count() }).from(customers).where(where),
  ]);

  const points = filters.from
    ? await bankingPointsByCustomer(rows.map((r) => r.id), filters.from.slice(0, 7))
    : null;

  return {
    rows: rows.map((r) => ({ ...r, points: points ? (points.get(r.id) ?? 0) : null })),
    total: totals?.value ?? 0,
  };
}

/* ── P-41 · Tạo / sửa ─────────────────────────────────────────────────── */

async function customerById(id: string, actor: User): Promise<Customer | null> {
  const [row] = await db
    .select({
      id: customers.id,
      fullName: customers.fullName,
      seq: customers.seq,
      rootId: customers.rootCustomerId,
      dob: customers.dob,
      idNumber: customers.idNumber,
      address: customers.address,
      channelId: customers.channelId,
      channel: sql<string>`coalesce(${channels.name}, '')`,
      channelDetail: customers.channelDetail,
      createdAt: createdDayText,
      createdById: customers.createdBy,
      createdByDepartmentId: customers.createdByDepartmentId,
      // leftJoin cả hai: người tạo có thể đã bị xoá khỏi hệ thống, và hồ sơ cũ
      // nhập từ file có thể chưa gắn phòng nào.
      createdByName: sql<string>`coalesce(${users.fullName}, '')`,
      createdByDepartmentName: sql<string>`coalesce(${departments.name}, '')`,
    })
    .from(customers)
    .leftJoin(channels, eq(channels.id, customers.channelId))
    .leftJoin(users, eq(users.id, customers.createdBy))
    .leftJoin(departments, eq(departments.id, customers.createdByDepartmentId))
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

/**
 * Trùng khoá duy nhất thì CHỈ trả mã lỗi, không trả hồ sơ đang giữ khoá đó
 * (chốt 2026-08-18).
 *
 * Bản trước tra ngược hồ sơ trùng rồi gửi kèm tên, số điện thoại, số tài khoản
 * và số đơn để giao diện dựng nút "Dùng hồ sơ này" theo spec §2.1. Nay bỏ hẳn:
 * một lượt ghi hỏng không được kéo theo một lượt đọc hồ sơ người khác.
 *
 * `reason` đọc từ TÊN CHỈ MỤC bị đụng, không suy từ việc tra được hồ sơ hay
 * không. Suy kiểu đó thì trùng số điện thoại cũng ra câu "CCCD trùng".
 */
export type CustomerConflict = "duplicate-id-number" | "unknown";

export type CustomerOutcome<T> =
  | { ok: true; customer: T }
  | { ok: false; reason: CustomerConflict };

/**
 * Hồ sơ CHƯA CHỐT QUÀ của chính người đang thao tác, cho một CCCD.
 *
 * `null` = họ chưa giữ lần nào, tạo lần mới được. Có giá trị = họ đang giữ một
 * lần dở dang; tạo thêm là chính họ phải chọn giữa hai hồ sơ mà không có gì
 * phân biệt (chốt 2026-09-05).
 *
 * Trục là NGƯỜI TẠO, không phải cả công ty: nhân viên B mở lần của B cho cùng
 * khách là hợp lệ, vì hai người bán hai combo khác nhau.
 */
async function openDraftOf(rootId: string, actorId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.rootCustomerId, rootId),
        eq(customers.createdBy, actorId),
        sql`not exists (select 1 from ${giftGrants} g where g.customer_id = ${customers.id})`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Hồ sơ gốc mang CCCD này, cùng tình trạng lần dở dang của người đang thao tác.
 *
 * Chỉ trả `rootId` và một cờ, KHÔNG trả tên hay số điện thoại — giữ đúng chốt
 * 2026-08-18: một lượt ghi hỏng không kéo theo lượt đọc hồ sơ người khác. Hai
 * giá trị này chỉ đủ để giao diện chọn giữa "tạo thêm lần" và "bạn đang có một
 * lần chưa chốt quà".
 */
/** Ba trường máy chủ đem so với hồ sơ gốc khi CCCD trùng. Kênh không so. */
export type DuplicateField = "fullName" | "dob" | "address";

/**
 * Hồ sơ gốc đang giữ CCCD này, kèm ba trường để nhân viên đối chiếu với khách
 * đang ngồi trước mặt (chủ dự án chốt 2026-09-06, đảo lại chốt 2026-08-18).
 *
 * Trùng CCCD chưa chắc là cùng một người: gõ nhầm một số là đụng hồ sơ của
 * người khác. Tên, ngày sinh, địa chỉ lệch thì giao diện bày hai cột cho nhân
 * viên hỏi khách, và cho chọn ghi theo bên nào. Tên và địa chỉ so sau khi bỏ
 * dấu, gộp khoảng trắng, không phân biệt hoa thường; ngày sinh so đúng chuỗi.
 */
export async function duplicateIdNumberInfo(
  idNumber: string,
  actorId: string,
  form: Pick<CustomerForm, "fullName" | "dob" | "address">,
): Promise<{
  rootId: string;
  openDraftId: string | null;
  existing: { fullName: string; dob: string | null; address: string };
  mismatch: DuplicateField[];
} | null> {
  const [root] = await db
    .select({
      id: customers.id,
      fullName: customers.fullName,
      dob: customers.dob,
      address: customers.address,
    })
    .from(customers)
    .where(and(eq(customers.idNumber, idNumber), sql`root_customer_id = id`))
    .limit(1);
  if (!root) return null;

  const mismatch: DuplicateField[] = [];
  if (searchKey(root.fullName) !== searchKey(form.fullName)) mismatch.push("fullName");
  if ((root.dob ?? "") !== (form.dob ?? "")) mismatch.push("dob");
  if (searchKey(root.address) !== searchKey(form.address)) mismatch.push("address");

  return {
    rootId: root.id,
    openDraftId: await openDraftOf(root.id, actorId),
    existing: { fullName: root.fullName, dob: root.dob, address: root.address },
    mismatch,
  };
}

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

/**
 * CHỈ `customers_id_number` là xung đột do người nhập gây ra.
 *
 * Khoá duy nhất còn lại đụng được là `customer_phones_one_primary` — "mỗi khách
 * đúng một số chính". Đó là ràng buộc nội bộ, đụng nó nghĩa là `phoneRows` dựng
 * sai chứ không phải người dùng gõ trùng. Số điện thoại KHÔNG có khoá duy nhất
 * nào: hai khách dùng chung một số là chuyện hợp lệ.
 */
const conflictOf = (constraint: string): CustomerConflict =>
  constraint === "customers_id_number" ? "duplicate-id-number" : "unknown";

async function writeGuarded<T>(run: () => Promise<T>): Promise<CustomerOutcome<T>> {
  try {
    return { ok: true, customer: await run() };
  } catch (e) {
    const constraint = uniqueViolationOf(e);
    if (constraint === null) throw e;
    return { ok: false, reason: conflictOf(constraint) };
  }
}

/**
 * Tạo hồ sơ khách. `linkToRootId` = tạo THÊM MỘT LẦN cho người đã có hồ sơ.
 *
 * Không có `linkToRootId` thì đây là hồ sơ GỐC và `root_customer_id` trỏ về
 * chính nó, nên id phải sinh ở đây chứ không để `gen_random_uuid()` của cột lo:
 * cột đó trả giá trị sau khi chèn xong, mà `root_customer_id` cần nó ngay lúc
 * chèn.
 *
 * Có `linkToRootId` thì CCCD trùng là chuyện đúng — khoá duy nhất chỉ áp cho hồ
 * sơ gốc. Chốt duy nhất ở đây là một người không giữ hai lần dở dang cùng lúc.
 *
 * `keepExisting` (chốt 2026-09-06): hồ sơ mới CHÉP tên, ngày sinh, địa chỉ, số
 * điện thoại của hồ sơ gốc thay vì lấy từ biểu mẫu, và không đồng bộ gì ngược
 * lên. Dành cho ca nhân viên đối chiếu với khách và thấy hồ sơ đang có mới
 * đúng. Kênh vẫn lấy từ biểu mẫu vì kênh là của từng hồ sơ.
 */
export async function createCustomer(
  actor: User,
  form: CustomerForm,
  linkToRootId?: string,
  keepExisting = false,
): Promise<
  CustomerOutcome<Customer> | { ok: false; reason: "open-draft-exists" | "id-number-mismatch" }
> {
  if (linkToRootId) {
    const [root] = await db
      .select({ id: customers.id, idNumber: customers.idNumber })
      .from(customers)
      .where(and(eq(customers.id, linkToRootId), sql`root_customer_id = id`))
      .limit(1);
    if (!root) return { ok: false, reason: "unknown" };

    /**
     * CCCD phải khớp hồ sơ đang nối.
     *
     * `linkToRootId` chỉ đến từ phản hồi 422 do chính CCCD đó sinh ra, nên giao
     * diện gửi lên hai giá trị vốn đã khớp. Chốt này dành cho lời gọi nặn tay:
     * nối nhầm là ghi đè trọn thông tin của một khách khác, và không có đường
     * gỡ hai người ra khỏi một nhóm.
     */
    if ((root.idNumber ?? "") !== form.idNumber)
      return { ok: false, reason: "id-number-mismatch" };

    if (await openDraftOf(linkToRootId, actor.id)) return { ok: false, reason: "open-draft-exists" };
  }

  const result = await writeGuarded(async () => {
    const newId = crypto.randomUUID();
    const id = await db.transaction(async (tx) => {
      /**
       * Khoá dòng GỐC trước khi đọc số lần lớn nhất.
       *
       * Hai lượt tạo lần mới cùng lúc cho một người thì cả hai đọc ra cùng con
       * số và cùng ghi `seq` đó — hai hồ sơ mang "lần 2". Dòng gốc là thứ duy
       * nhất chung cho mọi lần, khoá nó là hai lượt xếp hàng.
       */
      let seq = 1;
      if (linkToRootId) {
        await tx
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.id, linkToRootId))
          .for("update");

        /**
         * Kiểm LẠI hồ sơ dở dang ở đây, sau khoá dòng gốc.
         *
         * Phép kiểm ở đầu hàm chạy ngoài giao dịch, nên hai request song song
         * cùng đọc ra "chưa có" rồi cùng tạo. Nó vẫn giữ lại vì trả câu báo
         * đúng cho ca thường; đây mới là chốt.
         */
        const [dangGiu] = await tx
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.rootCustomerId, linkToRootId),
              eq(customers.createdBy, actor.id),
              sql`not exists (select 1 from ${giftGrants} g where g.customer_id = ${customers.id})`,
            ),
          )
          .limit(1);
        if (dangGiu) return null;

        const [last] = await tx
          .select({ max: sql<number>`coalesce(max(${customers.seq}), 0)` })
          .from(customers)
          .where(eq(customers.rootCustomerId, linkToRootId));
        seq = (last?.max ?? 0) + 1;
      }

      /**
       * Nguồn của bốn trường đồng bộ: biểu mẫu, hay hồ sơ gốc khi `keepExisting`.
       * Đọc gốc SAU khoá dòng gốc để không chép một bản đang bị người khác sửa.
       */
      const goc =
        linkToRootId && keepExisting
          ? (
              await tx
                .select({
                  fullName: customers.fullName,
                  dob: customers.dob,
                  address: customers.address,
                })
                .from(customers)
                .where(eq(customers.id, linkToRootId))
                .limit(1)
            )[0]
          : null;
      const gocPhones = goc
        ? await tx
            .select({ number: customerPhones.number, isPrimary: customerPhones.isPrimary })
            .from(customerPhones)
            .where(eq(customerPhones.customerId, linkToRootId!))
        : [];

      const [row] = await tx
        .insert(customers)
        .values({
          id: newId,
          rootCustomerId: linkToRootId ?? newId,
          seq,
          fullName: goc ? goc.fullName : form.fullName,
          // Ô ngày để trống gửi lên chuỗi rỗng, mà cột là `date` — vào thẳng là
          // lỗi cast, không phải "chưa có ngày sinh".
          dob: goc ? goc.dob : form.dob || null,
          idNumber: form.idNumber || null,
          address: goc ? goc.address : form.address,
          channelId: form.channelId || null,
          channelDetail: form.channelDetail,
          createdBy: actor.id,
          // Snapshot phòng LÚC TẠO (#8) — rổ quà Phòng Y đọc cột này, nên tra
          // sống thì luân chuyển người là viết lại quà đã hứa của khách cũ.
          createdByDepartmentId: actor.departmentId,
        })
        .returning({ id: customers.id });
      await tx
        .insert(customerPhones)
        .values(
          goc
            ? gocPhones.map((p) => ({ customerId: row.id, number: p.number, isPrimary: p.isPrimary }))
            : phoneRows(row.id, form),
        );

      /**
       * Lần mới cũng ĐỒNG BỘ ngược lên các lần cũ, và ghi nhật ký nếu khác.
       *
       * Không có bước này thì ngay sau lượt tạo, lần 1 và lần 2 mang hai địa chỉ
       * khác nhau — đúng thứ luật đồng bộ sinh ra để chặn. Người tạo lần mới
       * đang ngồi với khách nên giá trị họ gõ là giá trị mới nhất; ai muốn tra
       * lại thì đọc nhật ký.
       *
       * `keepExisting` thì bỏ qua: hồ sơ mới đã chép từ gốc, không có gì để
       * đồng bộ và không có dòng nhật ký nào.
       */
      if (linkToRootId && !keepExisting)
        await dongBoNhom(tx, {
          rootCustomerId: linkToRootId,
          customerId: newId,
          // Hồ sơ GỐC làm bản cũ — hồ sơ vừa tạo đã mang giá trị mới rồi.
          mocId: linkToRootId,
          seq,
          actorId: actor.id,
          form,
          ghiCccd: true,
        });

      return row.id;
    });

    // `null` = giao dịch dừng vì người này đã giữ một hồ sơ dở dang; nơi gọi
    // đổi nó thành `open-draft-exists`.
    return id ? await customerById(id, actor) : null;
  });

  return result.ok && result.customer === null
    ? { ok: false, reason: "open-draft-exists" }
    : (result as CustomerOutcome<Customer>);
}

type CustomerChangeField = (typeof customerChangeField.enumValues)[number];

/**
 * Danh sách số điện thoại thành MỘT chuỗi, số chính đứng đầu và có dấu.
 *
 * Dấu "(chính)" phải nằm trong chuỗi: bỏ nó ra thì chuyển dấu số chính từ số
 * này sang số kia không đổi chuỗi nào, và nhật ký bỏ qua một lượt sửa thật.
 * Sắp lại theo cùng khoá ở cả hai đầu, không thì thứ tự người dùng gõ khác thứ
 * tự đọc từ database và mỗi lượt Lưu sinh một dòng "đổi SĐT" giả.
 */
const phoneLabel = (rows: readonly { number: string; isPrimary: boolean }[]): string =>
  [...rows]
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.number.localeCompare(b.number))
    .map((p) => (p.isPrimary ? `${p.number} (chính)` : p.number))
    .join(", ");

/** Bốn trường so được bằng chuỗi. CCCD tách riêng vì nhật ký không ghi giá trị. */
type SnapshotKhach = Record<"fullName" | "dob" | "address" | "phones", string>;

const FIELD_OF: Record<keyof SnapshotKhach, CustomerChangeField> = {
  fullName: "full_name",
  dob: "dob",
  address: "address",
  phones: "phones",
};

/**
 * Ghi nhật ký sửa — mỗi trường ĐỔI THẬT một dòng, trường không đổi thì không ghi.
 *
 * Ghi cả trường không đổi thì mỗi lượt Lưu sinh sáu dòng, và khối lịch sử đầy
 * những dòng "Địa chỉ: X → X".
 */
async function ghiNhatKy(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  arg: {
    rootCustomerId: string;
    customerId: string;
    seq: number;
    actorId: string;
    truoc: SnapshotKhach;
    sau: SnapshotKhach;
    idNumberDoi: boolean;
  },
): Promise<void> {
  const chung = {
    rootCustomerId: arg.rootCustomerId,
    customerId: arg.customerId,
    seq: arg.seq,
    changedBy: arg.actorId,
  };

  const rows = (Object.keys(FIELD_OF) as (keyof SnapshotKhach)[])
    .filter((k) => arg.truoc[k] !== arg.sau[k])
    .map((k) => ({ ...chung, field: FIELD_OF[k], fromValue: arg.truoc[k], toValue: arg.sau[k] }));

  // CCCD chỉ ghi "đã đổi", hai giá trị để rỗng (chốt 2026-09-05).
  if (arg.idNumberDoi)
    rows.push({ ...chung, field: "id_number", fromValue: "", toValue: "" });

  if (rows.length > 0) await tx.insert(customerChanges).values(rows);
}

/**
 * Ghi TOÀN BỘ thông tin cá nhân của `form` lên MỌI LẦN cùng root, kèm nhật ký.
 *
 * Dùng chung cho hai đường ghi — sửa hồ sơ, và tạo thêm một lần. Hai đường phải
 * đi qua đây chứ không tự viết lấy: lệch nhau nghĩa là một đường đồng bộ còn
 * đường kia không, và hai lần của một người mang hai địa chỉ.
 *
 * `mocId` là hồ sơ lấy làm bản CŨ để so. Lượt sửa thì chính hồ sơ đang sửa;
 * lượt tạo lần mới thì hồ sơ gốc, vì hồ sơ vừa tạo đã mang giá trị mới rồi.
 */
async function dongBoNhom(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  arg: {
    rootCustomerId: string;
    /** Hồ sơ người dùng đang đứng — ghi vào nhật ký. */
    customerId: string;
    mocId: string;
    /** Số hồ sơ NGƯỜI DÙNG ĐANG ĐỨNG, khác `mocId` ở lượt tạo hồ sơ mới. */
    seq: number;
    actorId: string;
    form: CustomerForm;
    /** Lượt này có được ghi đè CCCD không — xem ba nhóm ở `updateCustomer`. */
    ghiCccd: boolean;
  },
): Promise<void> {
  const { rootCustomerId, customerId, mocId, seq, actorId, form, ghiCccd } = arg;

  const [truoc] = await tx
    .select({
      fullName: customers.fullName,
      dob: customers.dob,
      idNumber: customers.idNumber,
      address: customers.address,
    })
    .from(customers)
    .where(eq(customers.id, mocId))
    .limit(1);
  if (!truoc) return;

  const phoneTruoc = await tx
    .select({ number: customerPhones.number, isPrimary: customerPhones.isPrimary })
    .from(customerPhones)
    .where(eq(customerPhones.customerId, mocId))
    .orderBy(desc(customerPhones.isPrimary), asc(customerPhones.number));

  /**
   * KÊNH KHÔNG ĐỒNG BỘ (chốt 2026-09-05).
   *
   * Một khách tới từ nhiều kênh khác nhau là chuyện thật: hồ sơ 1 qua kênh Ấp,
   * hồ sơ 2 qua kênh Bệnh viện. Mọi chỗ đọc kênh đều đọc theo TỪNG hồ sơ — luật
   * quà, bảng nhân sự, tài khoản ngân hàng chép kênh lúc mở, file xuất Excel —
   * nên giữ riêng là đúng, và rổ quà của hồ sơ anh em cũng không phải tính lại.
   */
  await tx
    .update(customers)
    .set({
      channelId: form.channelId || null,
      channelDetail: form.channelDetail,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId));

  await tx
    .update(customers)
    .set({
      fullName: form.fullName,
      // Ô ngày để trống gửi lên chuỗi rỗng, mà cột là `date` — vào thẳng là lỗi
      // cast, không phải "chưa có ngày sinh".
      dob: form.dob || null,
      // Rỗng là "không đụng tới", không phải "xoá" — xem ba nhóm ở `updateCustomer`.
      ...(ghiCccd ? { idNumber: form.idNumber } : {}),
      address: form.address,
      updatedAt: new Date(),
    })
    .where(eq(customers.rootCustomerId, rootCustomerId));

  /**
   * Kênh Ấp và Định danh lấy ĐỊA CHỈ làm chi tiết kênh (spec §U9), mà địa chỉ
   * thì đồng bộ. Không chạy câu này thì hồ sơ anh em mang kênh loại đó giữ
   * nguyên địa chỉ cũ trong cột chi tiết, lệch với cột địa chỉ ngay bên cạnh.
   */
  await tx
    .update(customers)
    .set({ channelDetail: form.address })
    .where(
      and(
        eq(customers.rootCustomerId, rootCustomerId),
        sql`exists (select 1 from ${channels} c where c.id = ${customers.channelId} and c.input_kind = 'ward-hamlet')`,
      ),
    );

  /**
   * Số điện thoại xoá theo NHÓM rồi chèn lại cho từng hồ sơ.
   *
   * Mỗi hồ sơ giữ dòng riêng chứ không trỏ chung: khoá duy nhất
   * `customer_phones_one_primary` tính theo `customer_id`, và mọi câu tra số
   * điện thoại hiện có đều nối qua cột đó.
   */
  const nhom = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.rootCustomerId, rootCustomerId));

  await tx.delete(customerPhones).where(
    inArray(customerPhones.customerId, nhom.map((r) => r.id)),
  );
  await tx.insert(customerPhones).values(nhom.flatMap((r) => phoneRows(r.id, form)));

  await ghiNhatKy(tx, {
    rootCustomerId,
    customerId,
    seq,
    actorId,
    truoc: {
      fullName: truoc.fullName,
      dob: truoc.dob ?? "",
      address: truoc.address,
      phones: phoneLabel(phoneTruoc),
    },
    sau: {
      fullName: form.fullName,
      dob: form.dob || "",
      address: form.address,
      // Qua `phoneRows` chứ không đọc thẳng `form.phones`: hàm đó mới là nơi
      // quyết số nào là số chính, và cũng là nơi ghi xuống database.
      phones: phoneLabel(phoneRows("", form)),
    },
    idNumberDoi: ghiCccd && (truoc.idNumber ?? "") !== form.idNumber,
  });
}

/**
 * Sửa hồ sơ. Ba nhóm, hai cách xử lý ô CCCD (chốt 2026-08-21, câu M2):
 *
 *   có `access-id-number`  →  ghi đè được, họ thấy số thật
 *   NGƯỜI TẠO hồ sơ        →  ghi đè được, dù chỉ thấy 4 số cuối
 *   còn lại                →  ô CCCD bị bỏ qua
 *
 * Người tạo được sửa vì chính họ là người gõ 12 số lúc lập hồ sơ, nên cũng
 * chính họ là người gõ sai. Bắt họ nhờ người có quyền xem CCCD thì một lỗi gõ
 * phải đi qua hai người.
 *
 * Nhóm thứ ba bị bỏ qua chứ không trả 403: giao diện chỉ đưa cho họ 4 số cuối,
 * nên thứ quay về máy chủ là `"4871"` — nhận vào là ghi đè số thật bằng 4 ký
 * tự. Khoá một chiều ở đây thì kể cả request nặn tay cũng không đụng được số.
 *
 * ⚠️ RỖNG NGHĨA LÀ "KHÔNG ĐỤNG TỚI", KHÔNG PHẢI "XOÁ". Ô CCCD của người không
 * thấy số nạp lên rỗng, và họ mở biểu mẫu để sửa địa chỉ hay số điện thoại là
 * chuyện thường. Nhận rỗng rồi ghi `null` là xoá CCCD của mọi hồ sơ đi qua
 * đường đó.
 *
 * `idNumberWritten` nói lượt ghi này CÓ đụng vào cột CCCD hay không — route
 * dùng nó cho nhật ký. Người tạo không thấy số cũ nên không tự đối chiếu được;
 * thiếu dấu vết thì không ai lần ra ai đã đổi.
 */
export async function updateCustomer(
  actor: User,
  id: string,
  form: CustomerEditForm,
): Promise<(CustomerOutcome<Customer> & { idNumberWritten?: boolean }) | null> {
  /**
   * Phạm vi mức DÒNG — khác `can()` ở route.
   *
   * `can()` chỉ trả lời "người này có sửa hồ sơ khách được không". Câu còn
   * thiếu là "có sửa được ĐÚNG hồ sơ này không": nhân viên sửa khách mình tạo,
   * quản lý sửa khách của phòng mình quản (spec §1.1.2).
   *
   * Chỉ áp cho GHI. Ô TÌM khách vẫn mở toàn công ty (spec §2.1b) — siết cả hai
   * đầu là hai người nhập trùng một khách mà không ai thấy. Bảng P-40 và file
   * xuất thì có siết, nhưng ở nơi gọi chứ không ở đây.
   *
   * Trả `null` để route ra 404, không ra 403: 403 xác nhận id đó có thật.
   */
  const [owner] = await db
    .select({
      createdById: customers.createdBy,
      createdByDepartmentId: customers.createdByDepartmentId,
      rootCustomerId: customers.rootCustomerId,
    })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  if (!owner) return null;
  if (!recordInScope(recordVisibility(actor, "customer", "update"), owner)) return null;

  const full = seesIdNumber(actor);
  const isCreator = owner.createdById === actor.id;
  const canWriteIdNumber = full || isCreator;
  const idNumberWritten = canWriteIdNumber && Boolean(form.idNumber);

  const result = await writeGuarded(async () => {
    const updated = await db.transaction(async (tx) => {
      /**
       * Khoá dòng GỐC trước khi đọc rồi ghi cả nhóm.
       *
       * Hai người sửa hai hồ sơ của cùng khách thì cả hai đọc ra giá trị cũ
       * giống nhau, cả hai ghi, người sau thắng, và nhật ký nói cả hai lượt đều
       * đã vào. Dòng gốc là thứ duy nhất chung cho mọi hồ sơ; khoá nó theo đúng
       * thứ tự mà `createCustomer` đang dùng, không có hai đường khoá chéo nhau.
       */
      await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, owner.rootCustomerId))
        .for("update");

      const [ton] = await tx
        .select({ seq: customers.seq })
        .from(customers)
        .where(eq(customers.id, id))
        .limit(1);
      if (!ton) return false;

      /**
       * Mọi thông tin cá nhân đi chung cho cả nhóm (chốt 2026-09-05).
       *
       * `mocId` là chính hồ sơ đang sửa: mọi lần đã mang cùng giá trị, và người
       * sửa đối chiếu với thứ họ đang nhìn.
       */
      await dongBoNhom(tx, {
        rootCustomerId: owner.rootCustomerId,
        customerId: id,
        mocId: id,
        seq: ton.seq,
        actorId: actor.id,
        form,
        ghiCccd: idNumberWritten,
      });

      return true;
    });

    return updated ? await customerById(id, actor) : null;
  });

  if (!result.ok) return result;

  /**
   * Đổi kênh của khách thì rổ quà đổi theo — kênh Bệnh viện góp thêm ba món
   * (thể lệ mục 4b). Cột `gift_basket` lưu sẵn danh sách mã quà nên nó phải
   * tính lại ở đây.
   *
   * Bản trước không gọi, và đúng: cột cũ lưu MÃ BẬC, mà bậc chỉ phụ thuộc tài
   * khoản. Cột nay lưu DANH SÁCH MÃ QUÀ, và kênh đổi đúng danh sách đó.
   */
  await recomputeGiftCase(id);
  return result.customer ? { ok: true, customer: result.customer, idNumberWritten } : null;
}

/* ── Xoá hồ sơ khách ──────────────────────────────────────────────────── */

/**
 * Bảng nghiệp vụ chặn xoá khách, và tên gọi của nó cho người dùng đọc.
 *
 * `customer_phones` cố ý VẮNG MẶT: số điện thoại thuộc về chính hồ sơ khách,
 * không phải bản ghi nghiệp vụ. Nó xoá cùng khách trong `deleteCustomer`. Đưa
 * nó vào đây là không khách nào xoá được, vì khách nào cũng có một số.
 *
 * Danh sách này phải khớp `references(() => customers.id)` trong `schema.ts`.
 * Thêm bảng mới trỏ tới `customers` thì thêm một dòng ở đây — thiếu thì lượt
 * xoá chạy tới câu `delete` rồi mới hỏng vì khoá ngoại, và người dùng nhận lỗi
 * 500 thay vì câu nói rõ vướng gì.
 */
const BLOCKING_TABLES = [
  { table: bankAccounts, label: "tài khoản ngân hàng" },
  { table: insuranceOrders, label: "đơn bảo hiểm" },
  { table: services, label: "lượt dịch vụ" },
  { table: giftGrants, label: "đợt phát quà" },
] as const;

/** Một loại bản ghi đang giữ khách lại, kèm số dòng. */
export type CustomerLink = { label: string; count: number };

export type DeleteCustomerResult =
  | { ok: true; fullName: string }
  /** Còn bản ghi nghiệp vụ — `links` luôn có ít nhất một phần tử. */
  | { ok: false; links: CustomerLink[] };

/**
 * Xoá hẳn hồ sơ khách, CHỈ KHI không bảng nghiệp vụ nào còn trỏ tới.
 *
 * Trả `null` khi không tìm thấy HOẶC nằm ngoài phạm vi của người bấm: route ra
 * 404 cho cả hai, để endpoint không thành chỗ dò id có thật.
 *
 * ⚠️ Phép đếm và câu xoá phải nằm trong CÙNG một transaction, và phải khoá dòng
 * khách trước khi đếm. Postgres lấy khoá `FOR KEY SHARE` trên dòng cha mỗi lần
 * có dòng con mang khoá ngoại được thêm vào, nên `FOR UPDATE` ở đây chặn được
 * lượt mở tài khoản đang chạy song song. Đếm ngoài khoá thì có cửa sổ giữa lúc
 * đếm ra 0 và lúc xoá, vừa đủ cho một tài khoản mới chen vào.
 */
export async function deleteCustomer(
  actor: User,
  id: string,
): Promise<DeleteCustomerResult | null> {
  const [owner] = await db
    .select({
      createdById: customers.createdBy,
      createdByDepartmentId: customers.createdByDepartmentId,
      rootCustomerId: customers.rootCustomerId,
    })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  if (!owner) return null;
  if (!recordInScope(recordVisibility(actor, "customer", "delete"), owner)) return null;

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ fullName: customers.fullName, seq: customers.seq })
      .from(customers)
      .where(eq(customers.id, id))
      .for("update")
      .limit(1);
    // Người khác vừa xoá xong trong lúc mình chờ khoá.
    if (!locked) return null;

    /**
     * Đếm trên MỌI LẦN của người này, không riêng hồ sơ đang xoá (chốt
     * 2026-09-05).
     *
     * Thông tin cá nhân đã đồng bộ và các lần nối với nhau qua
     * `root_customer_id`, nên xoá một hồ sơ là đụng tới cả nhóm. Đếm riêng hồ sơ
     * đang xoá thì câu báo nói "không vướng gì" trong khi lần khác của chính
     * khách đó còn tài khoản ngân hàng.
     */
    const nhomIds = (
      await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.rootCustomerId, owner.rootCustomerId))
    ).map((r) => r.id);

    const links: CustomerLink[] = [];
    for (const { table, label } of BLOCKING_TABLES) {
      const [row] = await tx
        .select({ n: count() })
        .from(table)
        .where(inArray(table.customerId, nhomIds));
      if (row.n > 0) links.push({ label, count: row.n });
    }

    /**
     * Lần sau của cùng người này trỏ về hồ sơ gốc, nên xoá gốc là đụng khoá
     * ngoại. Đếm ở đây để câu báo nói đúng thứ đang vướng — để khoá ngoại từ
     * chối thì người dùng nhận một lỗi 500 không đọc được.
     */
    const [laterRows] = await tx
      .select({ n: count() })
      .from(customers)
      .where(and(eq(customers.rootCustomerId, id), ne(customers.id, id)));
    if (laterRows.n > 0) links.push({ label: "hồ sơ sau của khách này", count: laterRows.n });

    if (links.length > 0) return { ok: false, links };

    /**
     * Nhật ký GIỮ NGUYÊN, chỉ cắt liên kết tới hồ sơ sắp mất (chốt 2026-09-05).
     *
     * Bản trước xoá luôn các dòng đó, và vì `nhomIds` là cả nhóm nên xoá một hồ
     * sơ là mất trọn lịch sử của những hồ sơ còn sống. Nay chuyển `customer_id`
     * sang `null`: nội dung ở lại, `seq` đã chép sẵn nên vẫn đọc được lượt sửa
     * đó thuộc hồ sơ mấy.
     */
    await tx
      .update(customerChanges)
      .set({ customerId: null })
      .where(eq(customerChanges.customerId, id));

    // Chính lượt xoá cũng là một dòng trong nhật ký — không có nó thì hồ sơ biến
    // mất khỏi dòng thời gian mà không ai biết ai xoá.
    await tx.insert(customerChanges).values({
      rootCustomerId: owner.rootCustomerId,
      customerId: null,
      seq: locked.seq,
      changedBy: actor.id,
      field: "profile_deleted",
      fromValue: locked.fullName,
      toValue: "",
    });

    await tx.delete(customerPhones).where(eq(customerPhones.customerId, id));
    await tx.delete(customers).where(eq(customers.id, id));
    return { ok: true, fullName: locked.fullName };
  });
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

  /**
   * Nhật ký đọc theo NHÓM, không theo hồ sơ đang mở: thông tin cá nhân đồng bộ
   * giữa các lần nên một lượt sửa thuộc về cả nhóm.
   *
   * Cắt 50 dòng gần nhất. Khối này để tra "ai đổi cái gì", không phải để lật
   * trang; hồ sơ sửa quá 50 lượt thì phần cũ tra ở nhật ký hệ thống.
   */
  /**
   * Nhật ký áp PHẠM VI ĐỌC HỒ SƠ KHÁCH (chốt 2026-09-05).
   *
   * Khối này mang tên nhân viên đã sửa và giá trị cũ của từng trường, tức hoạt
   * động của người khác chứ không riêng dữ liệu khách. Lọc theo phạm vi của
   * người xem, giống bốn khối bản ghi nghiệp vụ bên dưới.
   *
   * Lọc theo NGƯỜI LẬP hồ sơ mà lượt sửa nhắm tới, không theo người sửa: câu hỏi
   * là "bạn có được đọc hồ sơ đó không", không phải "bạn có được đọc người đó
   * không". Dòng của hồ sơ đã xoá luôn hiện — hồ sơ mất rồi thì không còn chủ để
   * so, mà giấu đi là mất dấu vết lượt xoá.
   */
  const changeVisible = recordVisibility(actor, "customer", "view-detail");
  const chuHoSo = alias(customers, "chu_ho_so");

  const changeScope =
    changeVisible.kind === "all"
      ? undefined
      : changeVisible.kind === "departments"
        ? or(
            isNull(customerChanges.customerId),
            inArray(chuHoSo.createdByDepartmentId, changeVisible.departmentIds),
          )
        : changeVisible.kind === "creator"
          ? or(isNull(customerChanges.customerId), eq(chuHoSo.createdBy, changeVisible.userId))
          : isNull(customerChanges.customerId);

  const changeRows = await db
    .select({
      id: customerChanges.id,
      field: customerChanges.field,
      fromValue: customerChanges.fromValue,
      toValue: customerChanges.toValue,
      changedAt: customerChanges.changedAt,
      changedByName: sql<string>`coalesce(${users.fullName}, '')`,
      // Đọc `seq` từ chính dòng nhật ký, KHÔNG nối sang `customers`: hồ sơ bị
      // xoá thì dòng của nó mang `customer_id` rỗng, nối vào là mất luôn dòng.
      seq: customerChanges.seq,
    })
    .from(customerChanges)
    .leftJoin(users, eq(users.id, customerChanges.changedBy))
    // `leftJoin` chứ không `innerJoin`: dòng của hồ sơ đã xoá mang `null`.
    .leftJoin(chuHoSo, eq(chuHoSo.id, customerChanges.customerId))
    .where(and(eq(customerChanges.rootCustomerId, customer.rootId), changeScope))
    .orderBy(desc(customerChanges.changedAt), desc(customerChanges.id))
    .limit(50);

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
        referralCode: referralCodes.displayName,
        appInstalled: bankAccounts.appInstalled,
        accountType: bankAccounts.accountType,
        departmentId: bankAccounts.createdByDepartmentId,
        createdById: bankAccounts.createdBy,
      })
      .from(bankAccounts)
      .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
      .innerJoin(referralCodes, eq(referralCodes.id, bankAccounts.referralCodeId))
      .where(eq(bankAccounts.customerId, id))
      // Cùng khoá ba tầng như P-21: `opened_date` là kiểu `date` nên mọi tài
      // khoản mở cùng ngày đều hoà, và `id` là uuid ngẫu nhiên.
      .orderBy(desc(bankAccounts.openedDate), desc(bankAccounts.createdAt), asc(bankAccounts.id)),
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
      .orderBy(desc(insuranceOrders.orderDate), desc(insuranceOrders.createdAt), asc(insuranceOrders.id)),
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
      .orderBy(desc(services.serviceDate), desc(services.createdAt), asc(services.id)),
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

  // MỌI trạng thái trừ bản nháp (chốt 2026-09-04). Tài khoản bị đánh lỗi phải
  // hiện ở đây, nếu không người dùng không có màn nào tìm ra nó.
  const doneAccounts = accountRows.filter((a) => a.status !== "creating");
  const draftAccounts = accountRows.filter((a) => a.status === "creating");
  const visibleDone = visible(doneAccounts, bankingVisible);
  const visibleDrafts = visible(draftAccounts, bankingVisible);
  const visibleInsurance = visible(insuranceRows, insuranceVisible);
  const visibleServices = visible(serviceRows, servicesVisible);

  const accounts: CustomerAccountRow[] = visibleDone.map((a) => ({
    id: a.id,
    date: a.date ?? "",
    bankName: a.bankName,
    accountType: a.accountType,
    referralCode: a.referralCode,
    appInstalled: a.appInstalled,
    status: a.status,
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

  // Lịch sử này không đi qua phạm vi phòng của đơn/tài khoản: đó là lịch sử
  // của chính lượt quà trên hồ sơ khách, và chỉ ai có quyền đổi quà mới có thể
  // tạo thêm dòng mới.
  const giftChangeRows = grant
    ? await db
        .select({
          id: giftGrantChanges.id,
          fromItem: giftGrantChanges.fromChosenItem,
          toItem: giftGrantChanges.toChosenItem,
          reason: giftGrantChanges.reason,
          changedByName: users.fullName,
          changedAt: giftGrantChanges.changedAt,
        })
        .from(giftGrantChanges)
        .innerJoin(users, eq(users.id, giftGrantChanges.changedBy))
        .where(eq(giftGrantChanges.giftGrantId, grant.id))
        .orderBy(desc(giftGrantChanges.changedAt), desc(giftGrantChanges.id))
    : [];

  /**
   * Tên món của lịch sử: lấy trong rổ đóng băng trước, thiếu thì tra danh mục.
   *
   * `snapshot` ghi đè mỗi lượt đổi quà (chốt 2026-09-06), nên món của lượt
   * trước không còn nằm trong rổ. Thiếu bước tra danh mục thì dòng lịch sử hiện
   * mã thô. Tên đóng băng vẫn thắng khi còn — spec §5.3.
   */
  const frozenLabel = (code: string) => grantedItemLabel(code, grant?.snapshot ?? null);
  const missingCodes = giftChangeRows
    .flatMap((change) => [change.fromItem, change.toItem])
    .filter((code) => frozenLabel(code) === code);
  const catalogNames = missingCodes.length
    ? await giftItemNames(missingCodes)
    : new Map<string, string>();
  const itemLabel = (code: string) => {
    const frozen = frozenLabel(code);
    return frozen === code ? (catalogNames.get(code) ?? code) : frozen;
  };
  const giftChanges = giftChangeRows.map((change) => ({
    ...change,
    fromItem: itemLabel(change.fromItem),
    toItem: itemLabel(change.toItem),
  }));

  /**
   * Rổ tính theo tài khoản HIỆN TẠI. Khách đã chốt quà vẫn tính, vì hộp thoại
   * đổi quà chọn món trong rổ này chứ không trong rổ lúc phát (chốt
   * 2026-09-06) — đó là cách khách mở thêm tài khoản trong ngày nâng được bậc.
   */
  const liveGift = await giftForCustomer(id);

  return {
    customer,
    changes: changeRows,
    /**
     * `accountRows` là TOÀN BỘ tài khoản của khách — phạm vi phòng áp sau, lúc
     * dựng `visibleDone`/`visibleDrafts`. Đếm ở đây nên đúng cả bản nháp lẫn
     * dòng của phòng khác, đúng thứ trần cần.
     */
    bankSlotsLeft: Math.max(
      0,
      // Dòng HKD không chiếm chỗ trong trần (chốt 2026-09-06).
      MAX_BANK_ACCOUNTS_PER_CUSTOMER - accountRows.filter((a) => a.accountType !== "HKD").length,
    ),
    accounts,
    accountsHiddenCount: doneAccounts.length - visibleDone.length,
    draftAccounts: drafts,
    draftAccountsHiddenCount: draftAccounts.length - visibleDrafts.length,
    insurance,
    insuranceHiddenCount: insuranceRows.length - visibleInsurance.length,
    services: servicesDone,
    servicesHiddenCount: serviceRows.length - visibleServices.length,
    /**
     * Quà tính trên TOÀN BỘ tài khoản của khách, không chỉ phần người xem thấy
     * (spec §4.4 P-42 lỗi thường gặp #2) — nên `giftForCustomer` đọc lại từ
     * database chứ không dùng `visibleDone` ở trên.
     *
     * Đợt ĐÃ CHỐT thì lấy nguyên snapshot đóng băng trong `gift_grants`, không
     * tính lại: thể lệ đổi hay danh mục đổi tên món cũng không được viết lại
     * thứ đã phát cho khách.
     */
    gift: grant
      ? {
          ...(grant.snapshot as GiftSimulateResult),
          liveBasket: liveGift.basket,
          given: true,
          givenItem: grantedItemLabel(grant.chosenItem, grant.snapshot),
          givenCode: grant.chosenItem,
          givenAt: grant.grantedAt,
          changes: giftChanges,
        }
      : {
          ...liveGift,
          liveBasket: liveGift.basket,
          given: false,
          givenItem: null,
          givenCode: null,
          givenAt: null,
          changes: [],
        },
  };
}
