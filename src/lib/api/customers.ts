import { z } from 'zod';
import { InsuranceProduct } from '@/lib/types';
import { InsuranceOrderStatus } from './insuranceOrders';
import { GiftSimulateResult } from './settings';
import { pageOf, pageParams, type Page, type PageQuery } from './pagination';

/**
 * P-40 · Danh sách khách hàng · P-41 · Tạo/sửa · P-42 · Hồ sơ 360°
 * (mgst-platform-spec.md §2.1, §2.1b · mgst-feature-list.md §4.4).
 *
 * Hai đường đọc, hai mức mở khác nhau (chốt 2026-08-23). BẢNG P-40 áp phạm vi
 * như mọi bản ghi nghiệp vụ: nhân viên thấy khách mình lập, quản lý thấy khách
 * phòng mình quản. TRA CỨU theo từ khoá thì mở toàn công ty (§2.1b) — xem
 * `fetchCustomerLookup`.
 */

export const CustomerPhone = z.object({
  id: z.string(),
  number: z.string(),
  primary: z.boolean(),
});
export type CustomerPhone = z.infer<typeof CustomerPhone>;

export const Customer = z.object({
  id: z.string(),
  fullName: z.string(),
  /** null hoặc ngày sinh dạng YYYY-MM-DD. */
  dob: z.string().nullable(),
  /**
   * null = chưa có CCCD — module B không bắt buộc (spec §2.1 câu hỏi mở).
   *
   * Chỉ là 4 SỐ CUỐI khi `idNumberMasked` bật: CCCD là trường bảo mật, máy chủ
   * mặc định không trả số đầy đủ (quyết định 03/08). Đừng hiển thị chuỗi này
   * qua `formatIdNumber` mà không xem cờ — nó định dạng theo 12 số.
   */
  idNumber: z.string().nullable(),
  idNumberMasked: z.boolean(),
  address: z.string(),
  phones: z.array(CustomerPhone),
  /**
   * Nguồn khách (spec §2.3) — thuộc về KHÁCH, không thuộc về từng tài khoản
   * ngân hàng: một khách chỉ được một kênh, dù mở bao nhiêu tài khoản sau đó.
   * '' = không có kênh.
   *
   * `channelId` là thứ biểu mẫu gửi đi, `channel` chỉ để HIỆN: kênh đổi tên thì
   * hồ sơ cũ vẫn trỏ đúng chỗ.
   */
  channelId: z.string(),
  channel: z.string(),
  channelDetail: z.string(),
  /** Ngày tạo hồ sơ, YYYY-MM-DD — dùng để lọc ở P-40 (hôm nay/tháng này/khoảng ngày). */
  createdAt: z.string(),
  /** Xem chú thích cùng tên ở `CustomerRow` — hai trường này để ẩn nút Sửa. */
  createdById: z.string().nullable(),
  createdByDepartmentId: z.string().nullable(),
});
export type Customer = z.infer<typeof Customer>;

/**
 * Một dòng ở P-40 — tóm tắt, không phải hồ sơ đầy đủ.
 *
 */
export const CustomerRow = z.object({
  id: z.string(),
  fullName: z.string(),
  accountCount: z.number(),
  insuranceCount: z.number(),
  giftStatus: z.enum(['none', 'eligible', 'given']),
  /** Tên món đã tặng — chỉ có giá trị khi giftStatus = 'given'. */
  givenItem: z.string().nullable(),
  channel: z.string(),
  createdAt: z.string(),
  createdByName: z.string(),
  /**
   * Hai trường dưới KHÔNG hiện lên màn. Chúng để giao diện gọi `recordInScope`
   * mà ẩn nút Sửa đúng dòng — sửa hồ sơ khách áp phạm vi mức dòng, còn đọc thì
   * không (AGENTS.md §6).
   */
  createdById: z.string().nullable(),
  createdByDepartmentId: z.string().nullable(),
  primaryPhone: z.string(),
  /**
   * Số tài khoản ngân hàng khách còn mở thêm được, 0 là đã đủ trần. Giao diện
   * đọc để làm mờ nút "Mở ngân hàng" đúng dòng.
   *
   * KHÁC `accountCount`: cột đó đếm dòng `done` để hiện lên bảng và để sắp xếp,
   * còn trần tính cả bản nháp `creating` vì bản nháp đã giữ một chỗ mã.
   */
  bankSlotsLeft: z.number(),
});
export type CustomerRow = z.infer<typeof CustomerRow>;

/**
 * Khoá sắp xếp — DANH SÁCH TRẮNG, vì nó đi thẳng vào `ORDER BY` của máy chủ.
 * Thêm khoá ở đây thì phải thêm nhánh tương ứng trong `server/customers.ts`.
 */
export const CUSTOMER_SORT = ['name', 'accounts', 'insurance', 'created'] as const;
export type CustomerSort = (typeof CUSTOMER_SORT)[number];

export type CustomerQuery = PageQuery<CustomerSort> & {
  search: string;
  channelId: string;
  /** Khoảng NGÀY TẠO, YYYY-MM-DD. Rỗng = không giới hạn. */
  from: string;
  to: string;
  /** Lọc theo người lập hồ sơ. Rỗng = mọi người. */
  staffId: string;
};

const CustomerPage = pageOf(CustomerRow);

/**
 * Một TRANG khách hàng. Lọc, tìm, sắp và cắt trang đều do máy chủ làm
 * (AGENTS.md §5.1) — nơi gọi chỉ hiện đúng những gì nhận được.
 */
export async function fetchCustomers(query: CustomerQuery): Promise<Page<CustomerRow>> {
  const res = await fetch(
    `/api/customers?${pageParams(query, {
      search: query.search,
      channelId: query.channelId,
      from: query.from,
      to: query.to,
      staffId: query.staffId,
    })}`,
  );
  if (!res.ok) throw new Error('Không tải được danh sách khách hàng');
  return CustomerPage.parse(await res.json());
}

/** Một kết quả tra cứu — vừa đủ để nhận ra người cần chọn, không hơn. */
export const CustomerLookupRow = z.object({
  id: z.string(),
  fullName: z.string(),
  primaryPhone: z.string(),
});
export type CustomerLookupRow = z.infer<typeof CustomerLookupRow>;

/**
 * `hiddenBankFull` = số khách KHỚP TỪ KHOÁ nhưng bị bỏ khỏi danh sách vì đã đủ
 * trần tài khoản ngân hàng.
 *
 * Phải trả về, không được lặng lẽ bỏ: người tìm mà không thấy ai sẽ bấm "Tạo KH
 * mới" và lập một hồ sơ trùng. CCCD không bắt buộc nên khoá trùng CCCD không
 * chặn được ca đó.
 *
 * Luôn 0 khi ô tìm để trống — lúc đó đếm là quét cả bảng khách để trả lời một
 * câu không ai hỏi.
 */
const CustomerLookupResult = z.object({
  rows: z.array(CustomerLookupRow),
  hiddenBankFull: z.number(),
});
export type CustomerLookupResult = z.infer<typeof CustomerLookupResult>;

/**
 * TRA CỨU khách theo từ khoá, cho ô tìm khách của ba hộp thoại tạo bản ghi.
 *
 * Route riêng chứ không phải `fetchCustomers` bỏ bộ lọc phòng. Ba khác biệt cố
 * ý: KHÔNG phân trang, KHÔNG trả `total`, chỉ ba trường. Đó là thứ phân biệt
 * TRA CỨU với LIỆT KÊ — spec §2.1b mở đường tra cứu toàn công ty để nhân viên
 * không lập hồ sơ trùng, nó không mở đường đọc tuần tự cả kho.
 *
 * Bỏ phân trang là chốt chính. Bản trước dùng chung route với bảng P-40, nên ai
 * cũng đổi được `page` để lật hết danh bạ khách hàng của công ty.
 */
export async function fetchCustomerLookup(
  search: string,
  /**
   * Bật khi ô tìm này đứng trước luồng MỞ TÀI KHOẢN: máy chủ bỏ khách đã đủ
   * trần khỏi danh sách. Hai luồng còn lại (đơn bảo hiểm, dịch vụ) không có
   * trần nào nên không truyền.
   */
  opts: { forBankAccount?: boolean } = {},
): Promise<CustomerLookupResult> {
  const query = new URLSearchParams({ search });
  if (opts.forBankAccount) query.set('for', 'bank-account');
  const res = await fetch(`/api/customers/lookup?${query}`);
  if (!res.ok) throw new Error('Không tra được khách hàng');
  return CustomerLookupResult.parse(await res.json());
}

export type CustomerExportQuery = Pick<CustomerQuery, 'search' | 'channelId' | 'from' | 'to'>;

/**
 * `total` là tổng số dòng KHỚP BỘ LỌC. Lớn hơn `rows.length` nghĩa là máy chủ
 * đã cắt ở trần — nơi gọi phải nói ra, không được lặng lẽ đưa file thiếu.
 */
const CustomerExportPage = z.object({ rows: z.array(CustomerRow), total: z.number() });

/**
 * TRỌN danh sách khớp bộ lọc, cho màn Xuất dữ liệu — không phân trang.
 *
 * Route riêng, không phải `fetchCustomers` với trang thật to: bảng và file
 * Excel là hai việc khác nhau, gộp đường đi thì sớm muộn có màn dùng đường
 * "lấy hết" để đổ cả kho vào một ô chọn (AGENTS.md §5.1, điều 4).
 */
export async function fetchCustomersForExport(
  query: CustomerExportQuery,
): Promise<Page<CustomerRow>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const res = await fetch(`/api/customers/export?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách khách hàng để xuất');
  return CustomerExportPage.parse(await res.json());
}

/* ── P-41 · Tạo / sửa ─────────────────────────────────────────────────── */

export const CustomerPhoneForm = z.object({
  number: z
    .string()
    .trim()
    .regex(/^0\d{9}$/, 'Số điện thoại phải đủ 10 số và bắt đầu bằng 0'),
  primary: z.boolean(),
});
export type CustomerPhoneForm = z.infer<typeof CustomerPhoneForm>;

/**
 * Tên không ràng buộc định dạng (spec §4.4 P-41) — nhân viên gõ sao lưu vậy.
 */
/**
 * Khách phải từ 15 tuổi, đo bằng HIỆU HAI NĂM — không so ngày và tháng.
 *
 * `2026 - 2011 = 15` nên mọi khách sinh năm 2011 đều đạt, kể cả người sinh
 * tháng 12 và tới tháng 8 mới 14 tuổi rưỡi. Đội Kinh doanh chốt cách đo này
 * (2026-08-21): nhân viên nhìn năm sinh là biết ngay đạt hay không, không phải
 * nhẩm ngày sinh nhật.
 *
 * Cận dưới 1900 chặn lỗi gõ tay — `06/04/0996` là thiếu một phím, không phải
 * một khách 1030 tuổi.
 */
export const MIN_AGE = 15;
const MIN_BIRTH_YEAR = 1900;

/**
 * Ngày lịch của ô ngày sinh mở sẵn khi ô còn trống: 01/01 của năm sinh MUỘN
 * NHẤT còn nhận.
 *
 * Lịch mặc định mở ở năm hiện tại, mà khách nhỏ tuổi nhất cũng sinh trước đó 15
 * năm — người nhập phải cuộn ngược 15 lần mỗi lần lập hồ sơ.
 *
 * Đặt cạnh `bornEarlyEnough` để hai chỗ cùng đọc một con số. Tách ra là ngày
 * đổi tuổi tối thiểu thì lịch vẫn mở ở năm cũ.
 */
export const pickerStartForDob = () => `${new Date().getFullYear() - MIN_AGE}-01-01`;

const bornEarlyEnough = (isoDate: string) => {
  const year = Number(isoDate.slice(0, 4));
  if (!year) return false;
  const thisYear = new Date().getFullYear();
  return year >= MIN_BIRTH_YEAR && thisYear - year >= MIN_AGE;
};

export const CustomerForm = z.object({
  fullName: z.string().trim().min(1, 'Chưa nhập họ tên'),
  dob: z
    .string()
    .min(1, 'Chưa nhập ngày sinh')
    .refine(bornEarlyEnough, `Khách phải từ ${MIN_AGE} tuổi trở lên`),
  idNumber: z
    .string()
    .trim()
    .min(1, 'Chưa nhập CCCD')
    .refine((v) => /^\d{12}$/.test(v), 'CCCD phải đủ 12 số'),
  address: z.string().trim().min(1, 'Chưa nhập địa chỉ'),
  phones: z.array(CustomerPhoneForm).min(1, 'Cần ít nhất một số điện thoại'),
  channelId: z.string(),
  channelDetail: z.string(),
});
export type CustomerForm = z.infer<typeof CustomerForm>;

/**
 * Biểu mẫu SỬA hồ sơ — CCCD để trống được (chốt 2026-08-18).
 *
 * `CustomerForm` bắt buộc đủ 12 số, đúng cho lúc TẠO. Dùng lại cho lúc SỬA thì
 * người không có `customer:access-id-number` không lưu nổi hồ sơ nào: ô CCCD
 * của họ nạp rỗng và bị khoá, nên không có cách gõ cho đủ 12 số.
 *
 * Rỗng nghĩa là "không đụng tới CCCD", không phải "xoá CCCD" —
 * `updateCustomer` chỉ ghi cột đó khi giá trị gửi lên khác rỗng.
 */
export const CustomerEditForm = CustomerForm.extend({
  idNumber: z.union([
    z.literal(''),
    z.string().trim().refine((v) => /^\d{12}$/.test(v), 'CCCD phải đủ 12 số'),
  ]),
});
export type CustomerEditForm = z.infer<typeof CustomerEditForm>;

export const CUSTOMER_ERROR = {
  DUPLICATE_ID: 'duplicate-id-number',
} as const;

/**
 * ⚠️ ĐÃ BỎ (chốt 2026-08-18): `ExistingCustomer`, `DuplicateCustomerError`,
 * `isDuplicateCustomerError`.
 *
 * Ba kiểu đó mang hồ sơ đang giữ CCCD trùng — tên, số điện thoại, số tài khoản,
 * số đơn — để giao diện dựng nút "Dùng hồ sơ này" theo spec §2.1. Nay máy chủ
 * CHỈ trả mã lỗi với câu báo, không trả hồ sơ của ai. Trùng CCCD báo bằng toast
 * như mọi lỗi ghi khác.
 */

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { message?: string } | null;
    // Máy chủ đã nói rõ vì sao — bỏ qua rồi ném câu chung chung là bắt người
    // dùng tự đoán mình sai chỗ nào.
    throw new Error(payload?.message?.trim() || 'Không lưu được');
  }
  return res.json();
}

export const createCustomer = (form: CustomerForm) =>
  send('/api/customers', 'POST', form).then(Customer.parse);

export const updateCustomer = (id: string, form: CustomerForm) =>
  send(`/api/customers/${id}`, 'PATCH', form).then(Customer.parse);

/* ── P-42 · Hồ sơ 360° ────────────────────────────────────────────────── */

export const CustomerAccountRow = z.object({
  id: z.string(),
  date: z.string(),
  bankName: z.string(),
  referralCode: z.string(),
  appInstalled: z.boolean(),
});
export type CustomerAccountRow = z.infer<typeof CustomerAccountRow>;

/**
 * Tài khoản đang `creating` (spec §4.5) — đã giữ chỗ mã, KD đi mở tài khoản
 * thật bên ngoài, chưa quay lại điền nốt. Tách khỏi `CustomerAccountRow` vì
 * chưa có ngày mở/đã cài app thật — chỉ đủ dữ liệu để "Tiếp tục" hoặc "Xoá".
 */
export const CustomerDraftAccountRow = z.object({
  id: z.string(),
  bankName: z.string(),
  referralCode: z.string(),
});
export type CustomerDraftAccountRow = z.infer<typeof CustomerDraftAccountRow>;

export const CustomerInsuranceRow = z.object({
  id: z.string(),
  date: z.string(),
  product: InsuranceProduct,
  packageName: z.string(),
  status: InsuranceOrderStatus,
  /** Đơn tự khách mua, hay từ luồng tặng quà (P-43). */
  source: z.enum(['self', 'gift']),
});
export type CustomerInsuranceRow = z.infer<typeof CustomerInsuranceRow>;

/** Một lượt dịch vụ đã làm cho khách này (spec §2.1, khối thứ tư của hồ sơ 360°). */
export const CustomerServiceRow = z.object({
  id: z.string(),
  date: z.string(),
  serviceTypeName: z.string(),
  /** Người thực hiện — khối này là để trả lời "ai đã chăm khách này". */
  createdByName: z.string(),
  note: z.string(),
});
export type CustomerServiceRow = z.infer<typeof CustomerServiceRow>;

export const CustomerDetail = z.object({
  customer: Customer,
  /**
   * Số tài khoản ngân hàng khách còn mở thêm được, 0 là đã đủ trần.
   *
   * Đếm trên TOÀN BỘ tài khoản, kể cả dòng ngoài phạm vi người xem và kể cả bản
   * nháp — trần áp cho KHÁCH, không áp cho người đang xem. Không cộng từ
   * `accounts` với `draftAccounts` bên dưới: hai mảng đó đã lọc theo phạm vi.
   */
  bankSlotsLeft: z.number(),
  accounts: z.array(CustomerAccountRow),
  /** Tài khoản đang tạo dở, chưa hoàn thành — cùng áp phạm vi như `accounts`. */
  draftAccounts: z.array(CustomerDraftAccountRow),
  draftAccountsHiddenCount: z.number(),
  /** Số bản ghi ngoài phạm vi người xem — hiện gộp, không hiện chi tiết. */
  accountsHiddenCount: z.number(),
  insurance: z.array(CustomerInsuranceRow),
  insuranceHiddenCount: z.number(),
  services: z.array(CustomerServiceRow),
  servicesHiddenCount: z.number(),
  /**
   * Quà tính trên TOÀN BỘ tài khoản của khách, không chỉ phần người xem thấy
   * được (spec §4.4 P-42 lỗi thường gặp #2) — dùng chung máy tính với P-81.
   */
  gift: GiftSimulateResult.extend({
    given: z.boolean(),
    /** Tên món đã tặng — chỉ có giá trị khi given = true. */
    givenItem: z.string().nullable(),
  }),
});
export type CustomerDetail = z.infer<typeof CustomerDetail>;

/** Người xem lấy từ cookie phiên ở máy chủ — không gửi kèm định danh tự khai. */
export async function fetchCustomerDetail(id: string): Promise<CustomerDetail> {
  const res = await fetch(`/api/customers/${id}`);
  if (res.status === 404) throw new Error('Không tìm thấy khách hàng này');
  if (!res.ok) throw new Error('Không tải được hồ sơ khách hàng');
  return CustomerDetail.parse(await res.json());
}

/**
 * Giá trị ghi vào `gift_grants.chosen_item` khi khách không nhận món nào.
 *
 * Nằm ở đây chứ không ở component vì MÁY CHỦ cũng phải nhận ra nó: nó kiểm món
 * chọn có nằm trong rổ không, mà "từ chối" thì không nằm trong rổ nào cả.
 *
 * Là MÃ, không phải câu tiếng Việt — cùng lối với mọi giá trị khác của cột đó
 * (quyết định #74). Câu hiển thị nằm ở `GIFT_DECLINED_LABEL`.
 */
export const GIFT_DECLINED = 'DECLINED';

/** Câu hiện cho người dùng khi `chosen_item` là `GIFT_DECLINED`. */
export const GIFT_DECLINED_LABEL = 'Từ chối nhận quà';

export const GIFT_ERROR = {
  ALREADY_GIVEN: 'ALREADY_GIVEN',
  NOT_IN_BASKET: 'NOT_IN_BASKET',
  /**
   * Món CÓ trong rổ nhưng danh mục đã ngừng cấp (hoặc không còn dòng nào).
   * Tách khỏi `NOT_IN_BASKET` vì hai câu trả lời cho người dùng khác hẳn nhau:
   * "khách không được món này" so với "khách được, nhưng món hết".
   */
  ITEM_DISCONTINUED: 'ITEM_DISCONTINUED',
} as const;

/**
 * Đánh dấu khách đã được tặng quà — đúng một lần, không có đợt thứ hai
 * (spec §4.4 P-43). `item` là MÃ món đã chọn, hoặc `GIFT_DECLINED`.
 *
 * Mã chứ không phải tên: admin sửa tên món ở P-82 bất cứ lúc nào, và tên đã đổi
 * thì không tra ngược ra món nào nữa (quyết định #74).
 */
export async function markGiftGiven(customerId: string, item: string): Promise<void> {
  const res = await fetch(`/api/customers/${customerId}/gift-given`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item }),
  });
  if (!res.ok) {
    // Máy chủ nói rõ vì sao ("Khách này đã được tặng quà rồi") — nuốt đi rồi
    // ném câu chung chung là bắt người dùng tự đoán mình sai chỗ nào.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message?.trim() || 'Không đánh dấu được quà đã tặng');
  }
}
