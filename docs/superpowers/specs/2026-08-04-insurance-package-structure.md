# Cấu trúc gói bảo hiểm — khai báo thay vì đọc từ tên

> Chốt 04/08/2026. Nguồn nghiệp vụ: `../../../../mgst-platform-spec.md` §5.4 (một gói
> sinh nhiều đơn), §4.1 P-10. Màn cấu hình: **P-82 · Danh mục quà & gói bảo hiểm**.
> Ảnh hưởng: P-10/P-11 (`InsuranceOrderFormDialog`), P-43 Tặng quà, `src/lib/pvi.ts`.

## Vấn đề

Bảng `insurance_packages` hiện chỉ có `code`, `name`, `yearly_fee`, `active`. Không có
chỗ nào mô tả gói đó **thật sự gồm những gì**. Nên toàn bộ cấu trúc nghiệp vụ đang được
suy ngược ra từ **tên hiển thị**, bằng bốn bộ luật parse chuỗi rải ở hai file:

| Suy ra cái gì | Cách suy | Ở đâu |
|---|---|---|
| Sản phẩm là xe máy hay tai nạn điện | `name.includes('xe máy')` | `insuranceOrders.ts` `productOf` |
| Gói dài mấy năm | regex `/(\d+)\s*năm/` | `insuranceOrders.ts` `yearsOf` |
| Gói ghép, tách làm mấy đơn | `split('+')` rồi `startsWith('2 năm')` | `insuranceOrders.ts` `insuranceOrderLegsFor` |
| Mức phí | `match(/(\d+k)/)` | cùng hàm trên |

Bốn chỗ đó đều lấy `name` làm dữ liệu, trong khi `name` là **thứ CEO sửa được ở P-82**.
Đổi tên gói là đổi hành vi hệ thống, không có cảnh báo nào:

- Đặt tên `"BH xe máy 3N"` hoặc `"Gói ba năm"` → `yearsOf` không khớp regex, âm thầm trả
  `1`. Hợp đồng 3 năm được ghi ngày kết thúc sau 1 năm. **Sai 2 năm trên một hợp đồng
  bảo hiểm thật.**
- Thêm gói `"3 năm tai nạn điện"` → nhánh tách đơn chỉ bắt `startsWith('2 năm')` nên
  không tách, thành một hợp đồng 3 năm liền — trong khi §5.4 nói rõ hãng **không phát
  hành** đơn tai nạn điện quá 1 năm.
- Gói ghép hiện bị nối ngày như ca 2 năm cùng sản phẩm: đơn thứ hai được prefill ngày bắt
  đầu **một năm sau**, dù §5.4 nói gói ghép tách theo SẢN PHẨM chứ không theo NĂM và hai
  đơn là song song. Ô ngày sửa được nên người nhập cứu được, nhưng mặc định đang sai.

Nghiêm trọng hơn cả bốn cái trên: **database đã có kiểu đúng, tầng trên không dùng.**
`schema.ts:54` đã khai enum `insurance_product` = `motorbike | electric-accident`, và
`insurance_orders.product` dùng đúng enum đó. Nhưng zod và FE lại so sánh bằng chuỗi
tiếng Việt `'BH xe máy'` ở **sáu chỗ** — hai `refine` trong `insuranceOrders.ts` và ba
nhánh JSX trong `InsuranceOrderFormDialog.tsx`, cộng `pviPayloadFor` dùng
`order.product.includes('xe máy')`. Khi module bảo hiểm nối vào API thật, server trả
`"motorbike"` và cả sáu chỗ lặng lẽ đi sai nhánh: zod bỏ qua kiểm biển số và loại xe,
khối thông tin xe không render, ô ngày sinh hiện lại trên đơn xe máy, và `pviPayloadFor`
xếp đơn xe máy thành đơn tai nạn điện nên gửi sai bộ field sang PVI. Không có lỗi nào nổ
ra — mọi thứ chạy "bình thường" và sai.

## Nguyên tắc

**Tên gói là chuỗi hiển thị. Không ai được đọc nó để ra quyết định.**

Cấu trúc gói phải khai báo lúc tạo gói ở P-82: chọn sản phẩm gì, mấy năm, phí bao nhiêu,
sinh ra mấy đơn. Luật nghiệp vụ chuyển từ **code** sang **dữ liệu** — "gói 2 năm tai nạn
điện tách thành hai đơn 1 năm nối tiếp" thôi là điều kiện `if` trong hàm, nó trở thành
hai dòng leg trong cấu hình của chính gói đó.

## Cấu trúc mới

Một gói = danh sách **leg**. Mỗi leg sinh đúng một đơn bảo hiểm (`insurance_orders`) và
có đúng một form đầy đủ trên màn tạo đơn.

```
Gói "2 năm tai nạn điện gói 100k"        Gói "1 năm xe máy + 1 năm tai nạn điện"
  legs:                                    legs:
    1. electric-accident · 1 năm · 100k      1. motorbike         · 1 năm · 100k
    2. electric-accident · 1 năm · 100k      2. electric-accident · 1 năm · 100k
```

Leg mang đúng ba thông tin: **sản phẩm gì, mấy năm, phí bao nhiêu.** Không có cờ nào mô
tả quan hệ giữa các leg. Màn tạo đơn cứ theo danh sách leg mà render ra đúng số form, mỗi
form một bộ ô đầy đủ — cặp ngày bắt đầu/kết thúc, bộ người thụ hưởng, và khối thông tin
xe nếu `product` là `motorbike`. Người nhập điền từng form.

Cố ý bỏ hai thứ từng cân nhắc:

- **Không có `sharedBeneficiary`.** Gói nhiều leg luôn hiện N form độc lập, kể cả khi hai
  đơn thực tế cùng một người. Nút "Lấy thông tin khách" đã có sẵn ở mỗi form nên điền lại
  chỉ là một cú bấm — không đáng để thêm một nhánh render và một cột.
- **Không tự nối ngày.** Mỗi form prefill hôm nay → hôm nay + `years` của chính leg đó.
  Đơn 2 của gói tai nạn điện 2 năm thì KD tự sửa ngày cho khớp đơn 1.

### Schema

```ts
export const insurancePackages = pgTable("insurance_packages", {
  id: id(),
  /** Mã cố định cho module luật (`BH-1N-XEMAY`) — file luật đóng băng trỏ theo mã. */
  code: text("code").notNull().unique(),
  /** CHỈ để hiển thị. Không code nào được parse chuỗi này. */
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const insurancePackageLegs = pgTable(
  "insurance_package_legs",
  {
    id: id(),
    packageId: uuid("package_id")
      .notNull()
      .references(() => insurancePackages.id, { onDelete: "cascade" }),
    /** Thứ tự các form trên màn tạo đơn, bắt đầu từ 1. */
    ord: smallint("ord").notNull(),
    product: insuranceProduct("product").notNull(),
    years: smallint("years").notNull(),
    /** Phí của ĐƠN mà leg này sinh ra, trọn thời hạn — khớp `insurance_orders.fee`. */
    fee: integer("fee").notNull().default(0),
  },
  (t) => [
    uniqueIndex("insurance_package_legs_ord").on(t.packageId, t.ord),
    index("insurance_package_legs_package").on(t.packageId),
    check("insurance_package_legs_years_positive", sql`years > 0`),
    check("insurance_package_legs_fee_non_negative", sql`fee >= 0`),
  ],
);
```

`yearly_fee` trên `insurance_packages` **bỏ đi**. Phí giờ thuộc về từng leg, và tổng của
gói là `sum(legs.fee)` — tính ra được thì không lưu (cùng lý do §9 không lưu điểm KPI).
Hệ quả với P-82: ô "mức phí" một dòng chuyển thành một ô phí cho mỗi leg.

### Hợp đồng zod

Ở `src/lib/api/settings.ts` (nguồn sự thật theo AGENTS.md §4):

```ts
export const InsuranceProduct = z.enum(["motorbike", "electric-accident"]);
export type InsuranceProduct = z.infer<typeof InsuranceProduct>;

/** Nhãn tiếng Việt — CHỈ dùng để hiển thị, không dùng để so sánh. */
export const INSURANCE_PRODUCT_LABEL: Record<InsuranceProduct, string> = {
  motorbike: "BH xe máy",
  "electric-accident": "BH tai nạn điện",
};

export const InsurancePackageLeg = z.object({
  ord: z.number().int().min(1),
  product: InsuranceProduct,
  years: z.number().int().min(1),
  fee: z.number().int().min(0),
});

export const InsurancePackage = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  legs: z.array(InsurancePackageLeg).min(1),
});
```

`InsuranceOrder.product` và `InsuranceOrderForm.legs[].product` đổi từ `z.string()` sang
`InsuranceProduct`. Đây là chỗ vá sáu điểm so sánh chuỗi tiếng Việt nói ở phần Vấn đề.

## Cái gì biến mất

Xoá hẳn khỏi `src/lib/api/insuranceOrders.ts`:

- `productOf` — sản phẩm đọc từ `leg.product`
- `yearsOf` — số năm đọc từ `leg.years`
- `oneYearLater` — không còn ai gọi
- Toàn bộ thân `insuranceOrderLegsFor`: hết `split('+')`, hết `startsWith('2 năm')`, hết
  `match(/(\d+k)/)`. Hàm trở thành phép tra: nhận gói, trả `legs` đã cấu hình sẵn.

Còn lại `yearsLater(date, years)` — vẫn cần, và vẫn đúng (đã kiểm ở cả `Asia/Ho_Chi_Minh`
lẫn múi giờ âm, không lệch ngày; chỉ ca bắt đầu 29/02 cho ra 01/03 thay vì 28/02).

Ở `defaultLegsFor` trong `InsuranceOrderFormDialog.tsx`, biến `start` và dòng `start = end`
biến mất luôn: mọi leg cùng bắt đầu hôm nay, kết thúc sau `leg.years` năm. Đây cũng là chỗ
sửa lỗi gói ghép hiện đang bị prefill ngày bắt đầu của đơn thứ hai lùi một năm.

Ở `src/lib/pvi.ts`, `pviPayloadFor` đổi `order.product.includes('xe máy')` thành
`order.product === 'motorbike'`. Kiểu `PviField.product` đã dùng đúng
`'motorbike' | 'electric-accident'` từ đầu nên không phải đổi.

## Chuyển dữ liệu

Bảy gói đang có trong DB, khai lại thành leg như sau:

| Gói | Legs |
|---|---|
| 1 năm BH xe máy | motorbike · 1 năm |
| 2 năm BH xe máy | motorbike · 2 năm |
| 3 năm BH xe máy | motorbike · 3 năm |
| 1 năm BH tai nạn điện | electric-accident · 1 năm |
| 1 năm tai nạn điện gói 200k | electric-accident · 1 năm · 200k |
| 2 năm tai nạn điện gói 100k | electric-accident · 1 năm · 100k<br>electric-accident · 1 năm · 100k |
| 1 năm xe máy + 1 năm tai nạn điện | motorbike · 1 năm<br>electric-accident · 1 năm |

Gói "2 năm tai nạn điện" và gói ghép giờ chỉ khác nhau ở `product` của từng leg — không
còn cấu hình nào phân biệt hai ca này, và màn tạo đơn cũng không cần phân biệt.

Chưa có đơn bảo hiểm thật nào trong DB, và `insurance_orders` đã snapshot `package_name`
lúc tạo nên đơn cũ không bị viết lại. Migration là thêm bảng, thêm cột, bỏ `yearly_fee`,
rồi seed lại bảy dòng gói kèm leg.

## Câu hỏi phải chốt trước khi code

1. **`legs.fee` là phí trọn thời hạn hay phí mỗi năm?** Spec §5.4 ghi bảng "Phí / năm",
   nhưng `insurance_orders.fee` là "Mức phí của ĐƠN". Với leg 3 năm, hai cách đọc cho ra
   hai con số khác nhau. Bản spec này đang giả định **trọn thời hạn** để khớp thẳng với
   cột `fee` của đơn — cần xác nhận với PVI và CEO.
2. **P-82 cho CEO tự thêm leg tuỳ ý, hay chỉ chọn từ vài dạng dựng sẵn?** Tự do thì diễn
   đạt được mọi gói nhưng CEO cấu hình sai là ra hợp đồng sai. Dựng sẵn thì an toàn hơn
   nhưng thêm dạng gói mới phải deploy.
3. **Đơn 2 của gói tai nạn điện 2 năm đẩy sang PVI lúc nào?** Spec §5.4 đánh dấu 🕐 hoãn,
   gắn với giai đoạn làm bot (mục 12.8). Cấu trúc này không quyết hộ: cả hai đơn vẫn được
   tạo trong một lượt bấm, còn đẩy đơn có ngày hiệu lực tương lai ngay hay chờ gần hết hạn
   đơn 1 là chuyện của luồng bot, phụ thuộc PVI có nhận đơn hiệu lực tương lai không.
