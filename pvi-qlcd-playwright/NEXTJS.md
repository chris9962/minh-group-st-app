# Gọi từ Next.js tự host trên VPS

Next chạy trên chính VPS có Chromium, nên BE import thư viện dùng trực tiếp. Không cần chạy tiến trình con.

## Cấu trúc

| Tầng | File | Việc |
|---|---|---|
| Lõi | `lib/order.js`, `lib/session.js`, `lib/browser.js` | Trả về object, không gọi `process.exit` |
| Flow | `lib/flows/<sản phẩm>.js` | Địa chỉ form, tên ô, giá trị cố định, cách điền |
| CLI | `create-order.js`, `check-session.js` | Lớp bọc mỏng, đọc stdin, in JSON, đặt mã thoát |
| Next | Route Handler | Import thẳng từ `lib/` |

Cả hai đường gọi dùng chung một lõi. Sửa lõi thì cả CLI lẫn Next đổi theo.

`lib/order.js` không biết tên ô nào của PVI. Nó đọc `payload.product` rồi tra bảng
`lib/flows/index.js` để lấy flow. Thêm sản phẩm là thêm một file cạnh các flow
cũ cộng một dòng trong bảng — không sửa lõi.

## Cấu hình Next

`next.config.ts` — Next 15 trở lên:

```ts
export default { serverExternalPackages: ['playwright'] }
```

Next 14 trở xuống thì key là `experimental.serverComponentsExternalPackages`.

Thiếu bước này thì bundler cố đóng gói Playwright, build lỗi hoặc chạy lỗi lúc tìm Chromium.

## Route Handler

```ts
// app/api/pvi/don/route.ts
import { NextResponse } from 'next/server'
import { taoDon } from '@/../pvi-qlcd-playwright/lib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  const payload = await req.json()
  const kq = await taoDon(payload)
  return NextResponse.json(kq, { status: kq.ok ? 200 : 400 })
}
```

`runtime = 'nodejs'` bắt buộc. Edge runtime không chạy Playwright.

## Kiểm tra phiên

```ts
// app/api/pvi/phien/route.ts
import { NextResponse } from 'next/server'
import { kiemTraPhien } from '@/../pvi-qlcd-playwright/lib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const kq = await kiemTraPhien()
  return NextResponse.json(kq, { status: kq.ok ? 200 : 503 })
}
```

## Browser dùng chung

`lib/browser.js` giữ một `browser` ở `globalThis`, mở lần đầu rồi dùng lại. Mỗi đơn mở `context` riêng và đóng sau khi xong.

Chi phí khởi động Chromium đo được là 3,2 – 3,4 giây. Dùng chung browser thì chỉ trả một lần cho cả tiến trình Next.

Cảnh báo trước khi bật cluster: chạy `next start` nhiều tiến trình bằng PM2 thì mỗi tiến trình mở một Chromium riêng. Bốn instance là bốn Chromium.

## Trường `ma` trả về

| `ma` | Nghĩa | BE làm gì |
|---|---|---|
| 0 | Điền xong, chưa bấm Lưu | Báo người dùng KD vào kiểm rồi bấm "Chấp nhận" |
| 1 | Payload sai hoặc thiếu trường | Trả lỗi 400 cho người gọi |
| 2 | Phiên đăng nhập hết hạn | Báo người vận hành đăng nhập lại |
| 3 | Lỗi trang, hoặc có ô không điền được | Ghi log, xem `canXem` và ảnh chụp |
| 4 | Chưa có script cho sản phẩm này | Đặt đơn về `manual-queued` kèm lý do |

Mã 4 trả về TRƯỚC khi mở Chromium, nên không tốn 3 giây khởi động. Mọi kết quả
đều mang thêm trường `product` để BE ghi log biết đơn đi qua flow nào.

## Ảnh chụp

`taoDon` chụp toàn trang vào `anh/<orderId>.png`. Đổi chỗ lưu bằng `taoDon(payload, { thuMucAnh: '/duong/dan' })`, hoặc tắt bằng `{ chupAnh: false }`.
