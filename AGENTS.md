<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Quy ước dự án MGST

Đọc file này trước khi viết dòng code nào. Nghiệp vụ nằm ở `../mgst-platform-spec.md`,
danh sách màn hình ở `../mgst-feature-list.md`, bản thiết kế ở `../mgst-design/`.

**Luật điểm KPI và quà nằm ở `../mgst-the-le/<kỳ>.md`, KHÔNG ở spec.** Sửa
`src/rules/` thì mở đúng file đó — nó chứa trọn luật của kỳ: bảng khách gửi
(mục 1–4) cộng phần đội tự quy định như món thêm (mục 4b). Spec chỉ còn giữ
phần màn hình và kho dữ liệu.

## 0. Việc chưa làm — tra bằng `TODO(`

```bash
grep -rn "TODO(" src/
```

**Chạy lệnh này trước khi sửa một màn.** Có màn nhìn thì tưởng xong — cột nối
đầy đủ, sắp xếp có, bộ lọc có — mà API sau lưng còn là stub trả rỗng. Không tra
thì mất cả buổi đi tìm "sao số không lên".

Dạng: `TODO(<màn hoặc module>, <chờ gì>): <chưa chạy cái gì>`

Mốc phải đặt ở **CẢ HAI đầu** — chỗ giao diện dùng và chỗ máy chủ còn thiếu — và
mỗi mốc nói rõ **điều kiện gỡ**. Đặt một đầu thôi thì người đọc đầu kia vẫn tưởng
mọi thứ chạy. Xong việc thì xoá cả hai.

## 0.1 Chạy thử end-to-end

```bash
bun run e2e        # dựng tài khoản test → chạy Playwright → dọn sạch
bun run e2e:ui     # mở giao diện Playwright để soi từng bước
bun run test:rules # công thức điểm KPI (src/rules) — không cần database
```

Xem giao diện bằng mắt thì dùng bộ mẫu:

```bash
bun run db:demo             # 6 nhân viên + 14 khách phủ đủ ca TH1–TH6 + 24 khách độn
bun run db:demo -- --clean  # dọn sạch, không đụng dữ liệu tự nhập
```

Mọi bản ghi mang tiền tố `DEMO`. **Không chạy trên dữ liệu thật** — nó đổ khách
bịa. Khác `db:seed`: lệnh đó chỉ dựng cấu trúc + danh mục thật.

Cần **server dev đang chạy** (`bun dev`, cổng 3002) và database đã seed.

`test:rules` là ngoại lệ: hàm luật là hàm thuần nên chạy thẳng, vài giây. **Sửa
`src/rules/` thì chạy nó trước khi chạy e2e** — điểm KPI dính tới lương, và một
ca sai ở đó rẻ hơn hẳn khi bắt được trong ba giây thay vì bảy phút.

`scripts/e2e-seed.ts` dựng 5 tài khoản `zz_e2e_<chức vụ>` mang ĐÚNG bộ quyền
mặc định của từng chức vụ. **Đừng đổi sang tài khoản thật**: quyền của một người
nằm ở các dòng riêng trong `user_permissions`, không đọc lại từ chức vụ, mà tài
khoản đang chạy đã bị sửa quyền tay nhiều lần — bám vào chúng thì đo được thói
quen của một hệ thống cụ thể chứ không đo được bản thiết kế.

Mọi bản ghi test đặt tiền tố `ZZE2E`; `scripts/e2e-clean.ts` xoá theo tiền tố đó
và chạy cả khi test hỏng giữa chừng. **Ca test nào tạo dữ liệu thì phải mang
tiền tố này**, không thì rác nằm lại và ca "đếm số dòng" của lần sau sai.

## 1. Ngôn ngữ

| | |
|---|---|
| **Tên biến, hàm, kiểu, file, class CSS, route** | **TIẾNG ANH** — không có ngoại lệ |
| **Comment, JSDoc, chuỗi hiển thị cho người dùng** | Tiếng Việt |

```ts
// ĐÚNG
/** Sai 5 lần liên tiếp thì khoá 15 phút. */
const MAX_ATTEMPTS = 5;
function scopeFor(user: User, action: Action) {}

// SAI
const soLanToiDa = 5;
function phamViCuaQuyen(nguoiDung: NguoiDung) {}
```

## 2. Component

**Mọi thứ dùng lại được đều nằm ở `src/components`.** Không style component ngay
trong `page.module.css`.

```
src/components/
  ui/        Button · TextField · Checkbox · Alert · Logo · …  (nguyên thuỷ)
  brand/     BrandPanel                                        (khối thương hiệu)
  <domain>/  theo nghiệp vụ, ví dụ banking/BankAccountPhotos
```

Quy tắc:

- Một component một file, tên file = tên component, PascalCase
- CSS đi kèm là `<Component>.module.css` nằm cạnh nó
- `page.module.css` **chỉ chứa bố cục riêng của trang đó** — không có `.button`, `.checkbox`, `.card`
- Cần dáng mới thì **thêm variant vào component**, đừng ghi đè style tại nơi dùng
- Thấy mình sắp chép CSS từ trang này sang trang khác → dừng lại, tách component

## 3. Style

- Nguồn sự thật là `src/styles/organic.css` — đồng bộ từ `../mgst-design/_ds`. **Không sửa tay.**
- Dùng token **`--om-*`**: `--om-bg` `--om-card` `--om-surface` `--om-panel` `--om-soft`
  `--om-line` · `--om-text` `--om-text-2` `--om-text-3` · `--om-orange` `--om-orange-ink`
  `--om-orange-soft` `--om-orange-mid` `--om-orange-light`.
  Các tên `--color-*` cũ vẫn chạy vì trỏ về `--om-*`, nhưng code mới dùng `--om-*`.
  **Hai bộ màu**: sáng (Kem & trắng) ở `:root`, tối (Dark xanh đêm) ở
  `:root[data-theme="dark"]`. Component chỉ dùng tên `--om-*`, KHÔNG bao giờ
  viết `#fff` hay `rgb(255 255 255 / …)` — mã cứng là chỗ vỡ khi đổi bộ.
  Trạng thái theme ở `store/theme.ts`, lưu localStorage, gắn `data-theme` lên
  thẻ `html` bằng script trong `<head>` để không chớp màu lúc tải.
  Hai ngoại lệ, đều là màu **mang nghĩa**, không phải màu trang trí:
  **màu trạng thái** `--om-green*` nói "đạt / không đạt", và **màu ngân hàng**
  `SOURCE_COLORS` trong `lib/chart-colors.ts` là màu nhận diện của chính ngân
  hàng đó. Ngoài hai chỗ đó thì không có màu thứ tư.
  **Không viết mã màu và khoảng cách cứng.** Ngoại lệ duy nhất: khối thương hiệu
  `BrandPanel` dùng đúng màu bộ nhận diện, có ghi chú lý do.
- Component của design system dùng qua class có sẵn: `.btn`, `.input`, `.card`, `.tag`, `.table`
- **Thẻ = nền `--om-card` + viền `--om-line` + `--shadow-sm`.** Nền trang là màu
  kem nên thẻ trắng đọc ra khối nổi, không phải mảng màu — khác với bảng màu cũ
  (thẻ xám trên nền trắng) từng làm trang nặng màu. Mọi khối nội dung đi qua
  `SectionCard`; `variant="plain"` chỉ dùng khi cố ý đặt thẳng lên nền trang.
- Tiêu đề khối nên có icon (`lucide-react`, `size={17}`) để nhận ra khi cuộn nhanh.
- **Đừng để chữ quá dày. Trần weight là `600`.** Cần nhấn thì đổi cỡ chữ, màu
  hoặc khoảng trắng — đừng cộng thêm weight.
  - `--font-heading` là **`system-ui`** weight 600, `--font-body` là Figtree.
    Không có font display nào nữa: dự án từng dùng Alfa Slab One và đã bỏ vì
    tiêu đề, nút, tab đều nặng bằng nhau nên mất hết thứ bậc thị giác.
  - **Không thêm font display / slab / black.** Thứ bậc đi bằng cỡ chữ, không
    bằng độ dày.
  - Font chỉ có một nét thì **hạ `font-weight` vô tác dụng** — không có nét nhẹ
    hơn để chọn, trình duyệt cũng không tự làm mảnh chữ. Thấy chữ dày quá thì
    xem lại họ font trước, đừng loay hoay với số weight.
- **Chữ trên nền cam dùng `--om-text-on-accent`**, không dùng `--om-bg`/`--color-bg`.
  Token này là `#ffffff` ở cả hai bộ màu; lấy màu nền trang thì bộ tối cho ra
  chữ xanh đêm trên nền cam.
- Không thêm Tailwind, không thêm thư viện component có style riêng — sẽ thành hai hệ thống

## 4. Kiểu dữ liệu

- **Schema zod ở `src/lib/types.ts` là nguồn sự thật duy nhất.** Kiểu TS suy ra bằng `z.infer`
- Không khai báo `interface` song song với schema
- Tránh `.default()` trong schema dùng cho form — zod v4 làm kiểu vào/ra lệch nhau,
  react-hook-form báo lỗi. Đặt mặc định ở `defaultValues`

## 5. Dữ liệu

- Component gọi `fetch('/api/...')` qua hàm trong `src/lib/api/`, không gọi thẳng DB
- Server state dùng TanStack Query. Client state dùng Zustand (`src/store/`)
- Hợp đồng giữa hai tầng là schema zod ở `src/lib/api/` — máy chủ trả đúng hình
  dạng đó, đổi một đầu phải đổi đầu kia

### 5.1 Phân trang · sắp xếp · tìm kiếm · lọc — LÀM Ở MÁY CHỦ

**Không có ngoại lệ cần hỏi lại.** Danh sách nào lớn dần theo ngày làm việc thì
mọi thao tác thu hẹp dữ liệu đều chạy ở máy chủ. Trình duyệt gửi câu hỏi, máy
chủ trả về đúng một trang.

Cấm: tải cả bảng rồi `.filter()` / `.sort()` / `.slice()` ở component. Nó chạy
mượt trên máy người viết với 20 dòng seed và chết trên dữ liệu thật.

Bộ khung dùng chung — đừng tự chế kiểu vỏ riêng cho từng module:

| | |
|---|---|
| `src/lib/api/pagination.ts` | `PAGE_SIZE` · `pageOf()` · `Page<T>` · `PageQuery` · `pageParams()` |
| `src/server/pagination.ts` | `pageArgsFrom(url, sortable, fallback)` |
| `RankTable` prop `server` | bảng nhận sắp xếp/trang từ ngoài, không tự giữ |

Năm điều dễ làm sai, đã trả giá ở P-40 và P-61:

1. **`total` là tổng số dòng KHỚP BỘ LỌC**, không phải số dòng của trang và
   cũng không phải số dòng của bảng. Trả sai thì thanh phân trang hiện
   "1–15 trên 15" ở mọi trang và không ai bấm sang trang sau được.
2. **Khoá sắp xếp phải qua danh sách trắng.** Nó đi thẳng vào `ORDER BY`. Khoá
   lạ thì rơi về mặc định, không trả 400 — một tham số gõ sai không đáng làm
   hỏng cả màn.
3. **Giá trị suy ra được (trạng thái, xếp loại, điểm) mà có ô lọc thì máy chủ
   phải tự tính lấy**, và trả kèm trong mỗi dòng. Để công thức ở giao diện thì
   máy chủ cắt trang mù: lọc xong trang 1 còn 3 dòng mà tổng vẫn ghi 240.
   Tính hai nơi là hai nơi sớm muộn lệch nhau.
4. **Ô chọn (`Select`) không phải bảng.** Nó cần trọn danh sách dùng được, nên
   đi route riêng — `/referral-codes/open`, `/referral-codes/options`. Đừng mở
   đường "lấy hết" trên route đã phân trang: đường đó là chỗ mọi màn sau lách.
5. **Câu SQL không được đụng cả kho để lấy 15 dòng** — xem §5.2. Đây là điều
   tốn nhiều thời gian nhất trong bốn cái trên cộng lại.

`pageSize` của `RankTable` (cắt ở trình duyệt) chỉ còn dùng cho **danh mục
đóng** — ngân hàng, loại dịch vụ, kênh: vài chục dòng do người gõ tay, không
lớn thêm.

### 5.2 Đừng quét cả kho để lấy 15 dòng

Viết xong một câu truy vấn danh sách, hỏi đúng một câu:

> **Để trả 15 dòng, database phải đọc bao nhiêu dòng?**

Đáp án phải là "15 dòng cộng vài lượt tra chỉ mục". Nếu là "cả bảng" thì câu đó
sai, kể cả khi nó chạy mượt trên máy bạn — bảng nghiệp vụ chỉ lớn thêm mỗi ngày
làm việc, và cái chạy 20ms hôm nay là 800ms sau một năm. **Thêm chỉ mục không
cứu được**: vấn đề nằm ở hình dạng câu hỏi, không ở chỉ mục.

Dấu hiệu chắc chắn sai — `LIMIT` rơi xuống bước cuối cùng, sau khi đã gộp xong:

```
JOIN bảng lớn → GROUP BY → WHERE trên số vừa gộp → ORDER BY trên số vừa gộp → LIMIT 15
```

Nó buộc phải vậy: chưa gộp xong cả kho thì chưa biết dòng nào khớp bộ lọc, chưa
biết ai đứng đầu. Và câu đếm `total` chạy lại **y nguyên** phép gộp đó lần thứ
hai. Một lần mở màn = hai lượt quét bảng lớn.

Hai cách chữa đã dùng thật trong repo này. Chọn theo việc con số đó có bị **lọc
hoặc sắp** hay không:

| | Khi nào | Làm gì | Ví dụ |
|---|---|---|---|
| **A. Cắt trang trước, dán phần phụ sau** | Bộ lọc và khoá sắp đều nằm trong MỘT bảng | `WHERE`/`ORDER BY`/`LIMIT` chỉ trên bảng đó → rồi `leftJoinLateral` lấy phần phụ cho đúng 15 dòng | `listCustomers` — `pickPage()` + `decorate()` ở `server/customers.ts` |
| **B. Cột đếm do trigger giữ** | Người dùng LỌC hoặc SẮP theo chính con số đếm | Lưu số vào cột, trigger ở DB giữ, câu truy vấn đọc cột | `customers.account_count`, `referral_codes.used_count`/`holding_count` |

Cách B là ngoại lệ của luật "tính ra được thì không lưu"
(`../mgst-db-design.md` §9) nên **phải trả đủ giá của nó** — năm điều kiện liệt
kê ở §9: trigger ở DB (không phải app cộng trừ) · `UPDATE OF` liệt kê đủ mọi
cột công thức phụ thuộc · `check` chặn số âm · `db:recount` biết đếm lại và in
dòng lệch · migration backfill trước rồi mới gắn trigger. Thiếu một điều thì
quay lại đếm sống, đừng lưu nửa vời.

Không phải mọi bảng đều đáng làm. Danh mục đóng vài chục dòng do người gõ tay
(ngân hàng, loại dịch vụ, kênh, phòng ban) thì gộp cả bảng là chuyện nhỏ — chỗ
phải soi là bảng **lớn thêm theo ngày làm việc**: `bank_accounts`,
`insurance_orders`, `services`, `customers`, `audit_log`.

## 6. Phân quyền

- **Đúng một hàm kiểm quyền**: `src/lib/permissions.ts`. Mọi màn danh sách, chi tiết, xuất Excel đều qua đó
- Kiểm ở giao diện chỉ để ẩn/hiện. **Ẩn nút không phải là phân quyền** — máy chủ vẫn phải kiểm lại
- Hồ sơ **khách hàng** không áp trục phạm vi; chỉ **bản ghi nghiệp vụ** mới áp

## 7. React

- **Không dùng `useEffect` cho giá trị suy ra được** — tính thẳng khi render
- Không dùng `useEffect` để biến đổi dữ liệu cho việc render
- Xử lý tương tác trong event handler, không phải effect
- Reset state theo prop bằng `key`, không phải effect
- `useEffect` chỉ để đồng bộ với hệ thống bên ngoài, và phải có cleanup đúng

## 8. Khả năng tiếp cận

Đội KD dùng điện thoại **ngoài trời**. Đây không phải yêu cầu hình thức.

- Mọi input phải có `label` liên kết qua `id` — `TextField` đã lo
- Nút chỉ có icon phải có `aria-label`
- **Màu không được là kênh truyền đạt duy nhất** — luôn kèm chữ hoặc ký hiệu
- Vùng bấm tối thiểu 44px trên màn cảm ứng
- Dùng được bằng bàn phím, focus phải thấy được
- Không khoá zoom

## 9. Định dạng dữ liệu

Dùng `src/lib/format.ts`, không tự viết lại:

- Bỏ dấu tiếng Việt phải xử lý **`đ`/`Đ` → `d`/`D`** — `normalize('NFD')` không tách chữ Đ
- Tên khách khi **xuất Excel**: VIẾT HOA, BỎ DẤU. Lúc nhập không ràng buộc gì
- Cột SĐT và CCCD khi xuất phải ép **định dạng text**, nếu không Excel ăn mất số 0 đầu

## 10. Đặt tên tiếng Việt cho người dùng

Chuỗi hiển thị viết như người dùng nói, không như hệ thống nghĩ:
"Mở tài khoản" chứ không phải "Tạo bản ghi tài khoản ngân hàng".
