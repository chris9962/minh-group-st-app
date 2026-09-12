import { z } from 'zod';
import { InsuranceProduct } from '@/lib/types';
import { AccountType, BankAccountStatus } from './bankAccounts';
import { InsuranceOrderStatus } from './insuranceOrders';
import { GiftSimulateResult } from './settings';
import { pageOf, pageParams, type Page, type PageQuery } from './pagination';

/**
 * P-40 · Danh sách khách hàng · P-41 · Tạo/sửa · P-42 · Hồ sơ 360°
 * (mgst-platform-spec.md §2.1, §2.1b · mgst-feature-list.md §4.4).
 *
 * Bảng P-40 và TRA CỨU theo từ khoá đều áp cùng một phạm vi đọc: nhân viên thấy
 * khách mình lập, quản lý thấy khách do phòng mình quản lập, và chỉ quyền
 * `company` mới xem được toàn công ty — xem `fetchCustomerLookup`.
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
  /**
   * Lần thứ mấy của người này — 1 là hồ sơ gốc.
   *
   * Một người mở nhiều combo thì mỗi combo một hồ sơ riêng, và số này để người
   * dùng nhận ra mình đang mở hồ sơ nào mà không phải đối chiếu ngân hàng.
   */
  seq: z.number(),
  /** Hồ sơ gốc của người này — mọi câu hỏi "các hồ sơ khác" lọc theo cột này. */
  rootId: z.string(),
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
  note: z.string(),
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
  /**
   * TÊN người lập hồ sơ và TÊN phòng lúc lập, để hiện thành chữ trên hồ sơ
   * (chốt 2026-09-03). Hai id ở trên chỉ dùng để so phạm vi, không đọc ra được.
   *
   * `''` khi người tạo đã bị xoá khỏi hệ thống, hoặc hồ sơ chưa gắn phòng nào.
   */
  createdByName: z.string(),
  createdByDepartmentName: z.string(),
});
export type Customer = z.infer<typeof Customer>;

/**
 * Một dòng ở P-40 — tóm tắt, không phải hồ sơ đầy đủ.
 *
 */
export const CustomerRow = z.object({
  id: z.string(),
  fullName: z.string(),
  /** Hồ sơ thứ mấy của người này. 1 = hồ sơ gốc. */
  seq: z.number(),
  /** Hồ sơ gốc — để nhận ra hai dòng là cùng một người, không phải trùng tên. */
  rootId: z.string(),
  accountCount: z.number(),
  insuranceCount: z.number(),
  giftStatus: z.enum(['none', 'eligible', 'given']),
  /** Tên món đã tặng — chỉ có giá trị khi giftStatus = 'given'. */
  givenItem: z.string().nullable(),
  channel: z.string(),
  createdAt: z.string(),
  createdByName: z.string(),
  /** Tên phòng LÚC LẬP hồ sơ. `''` khi hồ sơ chưa gắn phòng nào. */
  createdByDepartmentName: z.string(),
  /**
   * Hai trường dưới KHÔNG hiện lên màn. Chúng để giao diện gọi `recordInScope`
   * mà ẩn nút Sửa đúng dòng — sửa hồ sơ khách áp phạm vi mức dòng, còn đọc thì
   * không (AGENTS.md §6).
   */
  createdById: z.string().nullable(),
  createdByDepartmentId: z.string().nullable(),
  primaryPhone: z.string(),
  /** Địa chỉ khách, cho cột ĐỊA CHỈ của file xuất từ P-40. Bảng không hiện. */
  address: z.string(),
  /**
   * Số tài khoản ngân hàng khách còn mở thêm được, 0 là đã đủ trần. Giao diện
   * đọc để làm mờ nút "Mở ngân hàng" đúng dòng.
   *
   * KHÁC `accountCount`: cột đó đếm dòng `done` để hiện lên bảng và để sắp xếp,
   * còn trần tính cả bản nháp `creating` vì bản nháp đã giữ một chỗ mã.
   */
  bankSlotsLeft: z.number(),
  /**
   * Điểm combo ngân hàng của riêng khách này (`src/rules/`), hiện chung ô với
   * `accountCount` chứ không đứng thành cột riêng.
   *
   * `null` khi người xem CHƯA chọn khoảng ngày. Luật điểm là luật của một tháng
   * và mỗi tháng một file ở `src/rules/`, nên không có khoảng ngày thì không có
   * tháng để chọn file — màn để trống chứ không đoán.
   */
  points: z.number().nullable(),
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
  /**
   * Chi tiết kênh, so khớp ĐÚNG CHUỖI. Rỗng = không lọc.
   *
   * Kênh Bệnh viện dùng nó để lọc theo một bệnh viện. `channelDetail` lưu TÊN
   * chứ không lưu id, nên giá trị gửi lên là tên bệnh viện.
   */
  channelDetail: string;
  /**
   * Địa chỉ khách, so khớp ĐÚNG CHUỖI của danh mục. Rỗng = không lọc.
   *
   * Giá trị là một dòng của `useAddressSuggestions`: `Ấp, Xã, Tỉnh` hoặc
   * `Xã, Tỉnh`. Dạng hai phần lấy cả khách gắn ấp trong xã đó, xem
   * `customerFilters` ở `server/customers.ts`.
   */
  address: string;
  /** Khoảng NGÀY TẠO, YYYY-MM-DD. Rỗng = không giới hạn. */
  from: string;
  to: string;
  /** Lọc theo người lập hồ sơ. Rỗng = mọi người. */
  staffId: string;
  /**
   * Lọc theo PHÒNG chụp lúc lập hồ sơ, không phải phòng người đó đang thuộc về.
   * Rỗng = mọi phòng.
   *
   * Máy chủ giao nó với phạm vi đọc của người xem, không thay thế: chọn phòng
   * ngoài phạm vi thì ra bảng rỗng.
   */
  departmentId: string;
  /** Chỉ hồ sơ có ít nhất một tài khoản hoàn thành. `false` = không lọc. */
  hasAccounts: boolean;
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
      channelDetail: query.channelDetail,
      address: query.address,
      from: query.from,
      to: query.to,
      staffId: query.staffId,
      departmentId: query.departmentId,
      hasAccounts: query.hasAccounts ? '1' : '',
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
  /** Hồ sơ thứ mấy của người này. 1 = hồ sơ gốc. */
  seq: z.number(),
  /** Hồ sơ gốc — để nhận ra hai dòng là cùng một người, không phải trùng tên. */
  rootId: z.string(),
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
 * Route riêng chứ không phải `fetchCustomers`: TRA CỨU vẫn áp phạm vi quyền,
 * nhưng KHÔNG phân trang, KHÔNG trả `total`, chỉ ba trường. Vì thế người dùng
 * chọn được khách trong phạm vi của mình mà không tải tuần tự cả danh bạ.
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

/** Cùng bộ ô lọc với bảng P-40, trừ trang và sắp xếp. */
export type CustomerExportQuery = Pick<
  CustomerQuery,
  | 'search'
  | 'channelId'
  | 'channelDetail'
  | 'address'
  | 'staffId'
  | 'departmentId'
  | 'from'
  | 'to'
  | 'hasAccounts'
>;

/**
 * `total` là tổng số dòng KHỚP BỘ LỌC. Lớn hơn `rows.length` nghĩa là máy chủ
 * đã cắt ở trần — nơi gọi phải nói ra, không được lặng lẽ đưa file thiếu.
 */
export const CustomerExportRow = CustomerRow.extend({ note: z.string() });
export type CustomerExportRow = z.infer<typeof CustomerExportRow>;
const CustomerExportPage = z.object({ rows: z.array(CustomerExportRow), total: z.number() });

/**
 * TRỌN danh sách khớp bộ lọc, cho màn Xuất dữ liệu — không phân trang.
 *
 * Route riêng, không phải `fetchCustomers` với trang thật to: bảng và file
 * Excel là hai việc khác nhau, gộp đường đi thì sớm muộn có màn dùng đường
 * "lấy hết" để đổ cả kho vào một ô chọn (AGENTS.md §5.1, điều 4).
 */
export async function fetchCustomersForExport(
  query: CustomerExportQuery,
): Promise<Page<CustomerExportRow>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value === true ? '1' : value);
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
  /** Bắt buộc từ 2026-09-06: hồ sơ nào cũng phải nói khách tới từ đâu. */
  channelId: z.string().min(1, 'Chưa chọn kênh'),
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
  /** Còn tài khoản, đơn bảo hiểm, lượt dịch vụ hoặc đợt phát quà trỏ tới khách. */
  HAS_RECORDS: 'customer-has-records',
  /** Người này đang giữ một lần chưa chốt quà cho chính khách đó. */
  OPEN_DRAFT: 'open-draft-exists',
} as const;

/**
 * Máy chủ trả kèm khi CCCD đã có hồ sơ — vừa đủ để giao diện dựng nút "Tạo thêm
 * lần", không hơn.
 *
 * KHÔNG có tên, số điện thoại hay số tài khoản của hồ sơ đang giữ CCCD đó (chốt
 * 2026-08-18): một lượt ghi hỏng không được kéo theo một lượt đọc hồ sơ người
 * khác. `openDraftId` chỉ nói hồ sơ dở dang ấy là CỦA CHÍNH người đang gõ.
 */
export const DuplicateField = z.enum(['fullName', 'dob', 'address']);
export type DuplicateField = z.infer<typeof DuplicateField>;

export const DUPLICATE_FIELD_LABEL: Record<DuplicateField, string> = {
  fullName: 'tên',
  dob: 'ngày sinh',
  address: 'địa chỉ',
};

export const DuplicateIdInfo = z.object({
  code: z.literal(CUSTOMER_ERROR.DUPLICATE_ID),
  message: z.string(),
  rootId: z.string(),
  openDraftId: z.string().nullable(),
  /**
   * Ba trường của hồ sơ gốc để nhân viên đối chiếu với khách (chốt
   * 2026-09-06). Không có số điện thoại, không có số bản ghi.
   */
  existing: z.object({
    fullName: z.string(),
    dob: z.string().nullable(),
    address: z.string(),
  }),
  /** Trường nào của biểu mẫu KHÁC hồ sơ gốc; rỗng là trùng khớp hoàn toàn. */
  mismatch: z.array(DuplicateField),
});
export type DuplicateIdInfo = z.infer<typeof DuplicateIdInfo>;

/** Lỗi mang theo thông tin lần trùng — `createCustomer` ném ra thay `Error` thường. */
export class DuplicateIdError extends Error {
  constructor(readonly info: DuplicateIdInfo) {
    super(info.message);
    this.name = 'DuplicateIdError';
  }
}

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

/**
 * Tạo hồ sơ khách. `linkToRootId` = tạo THÊM MỘT LẦN cho người đã có hồ sơ.
 *
 * Trùng CCCD không còn là ngõ dừng: máy chủ trả kèm `rootId` để lượt gọi kế
 * tiếp truyền vào `linkToRootId`. Ném `DuplicateIdError` chứ không `Error`
 * thường, vì giao diện phải đọc được `rootId` từ đó.
 */
export async function createCustomer(
  form: CustomerForm,
  linkToRootId?: string,
  /** Chép tên, ngày sinh, địa chỉ, SĐT của hồ sơ gốc thay vì ghi đè nó. */
  keepExisting = false,
): Promise<Customer> {
  const res = await fetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(linkToRootId ? { ...form, linkToRootId, keepExisting } : form),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const duplicate = DuplicateIdInfo.safeParse(payload);
    if (duplicate.success) throw new DuplicateIdError(duplicate.data);
    throw new Error(
      (payload as { message?: string } | null)?.message?.trim() || 'Không lưu được',
    );
  }
  return Customer.parse(await res.json());
}

export const updateCustomer = (id: string, form: CustomerForm) =>
  send(`/api/customers/${id}`, 'PATCH', form).then(Customer.parse);

export const CustomerNoteForm = z.object({
  note: z.string().max(5000, 'Ghi chú tối đa 5.000 ký tự'),
});

export const updateCustomerNote = (id: string, note: string) =>
  send(`/api/customers/${id}/note`, 'PATCH', { note }).then(CustomerNoteForm.parse);

/**
 * Xoá hẳn hồ sơ khách. Chỉ chạy được khi khách chưa có bản ghi nghiệp vụ nào.
 *
 * Còn vướng thì máy chủ trả 422 kèm câu nói rõ vướng mấy tài khoản, mấy đơn —
 * ném nguyên câu đó ra để toast hiện đúng thứ người dùng phải xoá trước.
 */
export async function deleteCustomer(id: string): Promise<void> {
  const res = await fetch(`/api/customers/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message?.trim() || 'Không xoá được hồ sơ khách này');
  }
}

/* ── P-42 · Hồ sơ 360° ────────────────────────────────────────────────── */

export const CustomerAccountRow = z.object({
  id: z.string(),
  date: z.string(),
  bankName: z.string(),
  accountType: AccountType,
  referralCode: z.string(),
  appInstalled: z.boolean(),
  /**
   * `done` · `error` · `fixed`. Bảng liệt kê CẢ tài khoản lỗi (chốt 2026-09-04):
   * lọc chúng đi thì người dùng không có màn nào tìm ra tài khoản bị đánh lỗi
   * của khách mình.
   */
  status: BankAccountStatus,
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

/**
 * Loại sự kiện trong nhật ký — khớp enum `customer_change_field` ở database.
 *
 * `profile_deleted` không phải một trường: nó là lượt XOÁ hồ sơ, nằm cùng dòng
 * thời gian vì hồ sơ biến mất mà không ghi lại thì nhóm mất dấu vết.
 */
export const CustomerChangeField = z.enum([
  'full_name',
  'dob',
  'id_number',
  'address',
  'phones',
  'channel',
  'profile_deleted',
  'note',
]);
export type CustomerChangeField = z.infer<typeof CustomerChangeField>;

export const CUSTOMER_FIELD_LABEL: Record<CustomerChangeField, string> = {
  full_name: 'Họ tên',
  dob: 'Ngày sinh',
  id_number: 'CCCD',
  address: 'Địa chỉ',
  phones: 'Số điện thoại',
  channel: 'Kênh',
  profile_deleted: 'Xoá hồ sơ',
  note: 'Ghi chú',
};

/**
 * Một lượt sửa MỘT trường của hồ sơ khách.
 *
 * `fromValue` và `toValue` của CCCD luôn rỗng (chốt 2026-09-05): nhật ký chỉ nói
 * "đã đổi CCCD", không mang số. Giao diện phải xử lý ca rỗng đó, đừng in
 * `"" → ""`.
 */
export const CustomerChange = z.object({
  id: z.string(),
  field: CustomerChangeField,
  fromValue: z.string(),
  toValue: z.string(),
  changedByName: z.string(),
  changedAt: z.coerce.date(),
  /** Lần mà người sửa đang đứng lúc bấm Lưu. */
  seq: z.number(),
});
export type CustomerChange = z.infer<typeof CustomerChange>;

export const CustomerDetail = z.object({
  customer: Customer,
  /**
   * Nhật ký sửa thông tin, mới nhất trước — chung cho MỌI LẦN của người này.
   *
   * Thông tin cá nhân đồng bộ giữa các lần, nên một lượt sửa thuộc về cả nhóm.
   * Hồ sơ nào cũng đọc chung một dòng thời gian.
   */
  changes: z.array(CustomerChange),
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
    /**
     * Rổ tính theo tài khoản HIỆN TẠI của khách, khác `basket` của đợt đã chốt.
     *
     * Hộp thoại đổi quà chọn món trong rổ này (chốt 2026-09-06): khách mở thêm
     * tài khoản trong ngày thì combo lên bậc, và rổ đóng băng lúc phát không
     * chứa món của bậc mới. Khách chưa chốt quà thì hai rổ bằng nhau.
     */
    liveBasket: GiftSimulateResult.shape.basket,
    given: z.boolean(),
    /** Tên món đã tặng — chỉ có giá trị khi given = true. */
    givenItem: z.string().nullable(),
    /** Mã món đang áp dụng, dùng để không chọn lại chính món đó khi đổi quà. */
    givenCode: z.string().nullable(),
    /** Thời điểm khách nhận quà lần đầu — mốc đầu của lịch sử đổi quà. */
    givenAt: z.coerce.date().nullable(),
    /** Các lần đổi sau khi đã chốt quà, mới nhất trước. */
    changes: z.array(
      z.object({
        id: z.string(),
        fromItem: z.string(),
        toItem: z.string(),
        reason: z.string(),
        changedByName: z.string(),
        changedAt: z.coerce.date(),
      }),
    ),
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

/** Một lần đổi món quà đã chốt; rổ quà gốc không bị tính lại. */
export const GiftChangeForm = z.object({
  item: z.string().trim().min(1, 'Chưa chọn món quà mới'),
  reason: z.string().trim().min(2, 'Chưa nhập lý do đổi quà').max(500, 'Lý do nhiều nhất 500 ký tự'),
  /** Đơn bảo hiểm mới vừa tạo khi đổi sang quà bảo hiểm. */
  newOrderIds: z.array(z.string()).default([]),
});
export type GiftChangeForm = z.infer<typeof GiftChangeForm>;

/**
 * Đánh dấu khách đã được tặng quà — đúng một lần, không có đợt thứ hai
 * (spec §4.4 P-43). `item` là MÃ món đã chọn, hoặc `GIFT_DECLINED`.
 *
 * Mã chứ không phải tên: admin sửa tên món ở P-82 bất cứ lúc nào, và tên đã đổi
 * thì không tra ngược ra món nào nữa (quyết định #74).
 */
export async function markGiftGiven(customerId: string, item: string, orderIds: string[] = []): Promise<void> {
  const res = await fetch(`/api/customers/${customerId}/gift-given`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item, orderIds }),
  });
  if (!res.ok) {
    // Máy chủ nói rõ vì sao ("Khách này đã được tặng quà rồi") — nuốt đi rồi
    // ném câu chung chung là bắt người dùng tự đoán mình sai chỗ nào.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message?.trim() || 'Không đánh dấu được quà đã tặng');
  }
}

export async function changeGift(customerId: string, form: GiftChangeForm): Promise<void> {
  const res = await fetch(`/api/customers/${customerId}/gift-change`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message?.trim() || 'Không đổi được quà');
  }
}
