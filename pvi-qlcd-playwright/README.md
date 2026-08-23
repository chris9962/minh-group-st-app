# pvi-qlcd-auto-order

Điền đơn bảo hiểm trên `qlcd.pvi.com.vn`, mỗi lần 1 đơn.

Script **không** bấm Lưu. Người dùng KD kiểm tra rồi tự bấm. Bấm Lưu là tạo đơn
thật bên PVI, nên bước đó chờ chốt sau khi tin script điền đúng.

Thư mục này nằm trong repo `mgst-app` và dùng chung `node_modules` với nó. Mọi
lệnh dưới đây chạy từ **gốc mgst-app**, không phải từ thư mục này.

📌 **Đang làm tới đâu, việc tiếp theo là gì: đọc [TRANG-THAI.md](TRANG-THAI.md).**
File này chỉ nói cách chạy.

## Sản phẩm chạy được

| Sản phẩm | `product` | Trạng thái |
|---|---|---|
| BH Tai nạn hộ sử dụng điện | `electric-accident` | chạy được, chưa bấm Lưu |
| BH TNDS xe máy | `motorbike` | chạy được, chưa bấm Lưu |

Đơn của sản phẩm chưa có script thoát mã 4, BE đặt về `manual-queued` kèm lý do.

## Ghi vết mạng

Dùng cho lần bấm "Chấp nhận" ĐẦU TIÊN trên PVI thật, để biết PVI trả `pr_key` ở
đâu — hiện chưa ai bấm nút đó nên chưa ai biết.

```bash
cat pvi-qlcd-playwright/payload.example.json | \
  bun run pvi:order -- --ghi-vet --cho-nguoi-bam=120
```

Bot điền xong rồi giữ trình duyệt mở 120 giây cho bạn kiểm và tự bấm. Nó ghi mọi
request, response, header, và HTML trang cuối vào `vet/<orderId>-vet.json`, rồi
tự dò `pr_key` trong đó.

`--ghi-vet` dùng riêng cũng được, không cần chờ người bấm.

File vết lọc `cookie`, `set-cookie` và `authorization` trước khi ghi — chúng thay
cho mật khẩu phiên PVI, không được nằm trong file dễ gửi đi.

## Cách đăng nhập

Form đăng nhập của PVI có captcha ảnh 4 chữ số `/Capcha1.aspx`.
`capcha-resolver/solve.py` đọc captcha đó, đạt 11/11 trên bộ ảnh ở
`capcha-resolver/example/`. `ensure-login.js` gọi nó, nên bước đăng nhập chạy
không cần người gõ.

Cần `python3`, `tesseract-ocr`, `pillow`, `numpy` trên máy chạy. Thiếu một trong
số đó thì `ensure-login.js` thoát mã 3 kèm đường dẫn ảnh captcha.

Đăng nhập xong, script lưu cookie vào `storageState.json` và các lần sau dùng
lại file đó. `login.js` là cách cũ: mở trình duyệt cho người tự đăng nhập.

Trang còn đặt cookie chống bot `x-bni-ja`, `x-bni-fpc`, `x-bni-rncf`. Chạy headless dễ bị chặn, nên mặc định script chạy có giao diện.

## Cài

`playwright` nằm trong `dependencies` của mgst-app, nên `bun install` ở gốc là đủ.
Còn phải tải Chromium một lần:

```bash
bunx playwright install chromium
```

Trên VPS không có màn hình, bạn cài thêm Xvfb rồi chạy qua `xvfb-run`.

## Chạy một lệnh: đăng nhập rồi điền

`pvi:chay` gọi `ensure-login` trước, rồi điền form. Còn phiên thì bước đăng nhập
thoát ngay, không mở lại form đăng nhập.

```bash
cat pvi-qlcd-playwright/payload.example.json | bun run pvi:chay
```

Điền xong, script giữ trình duyệt mở 90 giây cho bạn nhìn form. Đổi bằng
`--cho-nguoi-bam=<giây>`, đặt `0` để đóng ngay.

Tài khoản lấy theo thứ tự: biến môi trường `PVI_USER`/`PVI_PASS` → `.env.local`
→ trường `taiKhoan`/`matKhau` trong payload.

Hai lệnh dưới đây là hai bước tách rời của cùng luồng đó. Dùng khi cần chạy
riêng từng bước.

## Bước 1 — lưu phiên đăng nhập

Bạn đăng nhập trên máy cá nhân, tạo ra `storageState.json`, rồi chép lên VPS. Không cần màn hình trên VPS.

Cảnh báo: `storageState.json` thay cho mật khẩu. Không commit, không gửi qua chat hay email.

### Cách 1 — chạy `login.js` trên máy bạn

```bash
bun run pvi:login
```

Script mở một cửa sổ Chromium trên máy bạn. Bạn nhập tài khoản, mật khẩu, captcha. Vào được form thì script tự lưu file rồi đóng trình duyệt.

```bash
scp pvi-qlcd-playwright/storageState.json user@vps:/opt/mgst-app/pvi-qlcd-playwright/ && ssh user@vps 'chmod 600 /opt/mgst-app/pvi-qlcd-playwright/storageState.json'
```

### Cách 2 — lấy cookie từ Chrome đang đăng nhập

Dùng khi bạn không muốn cài Playwright trên máy cá nhân. Bạn giữ nguyên tab PVI đang mở, chỉ copy chuỗi cookie ra.

1. Mở tab `qlcd.pvi.com.vn` đã đăng nhập.
2. Bấm F12, chọn tab **Network**.
3. Tải lại trang.
4. Click request đầu tiên trong danh sách.
5. Kéo xuống mục **Request Headers**, copy toàn bộ giá trị của dòng `cookie:`.
6. Dán vào file `cookie.txt`.

```bash
node pvi-qlcd-playwright/import-cookies.js cookie.txt && rm cookie.txt
```

```bash
scp pvi-qlcd-playwright/storageState.json user@vps:/opt/mgst-app/pvi-qlcd-playwright/ && ssh user@vps 'chmod 600 /opt/mgst-app/pvi-qlcd-playwright/storageState.json'
```

### Cách 3 — đăng nhập ngay trên VPS qua VNC

Chỉ dùng khi bước 3 báo phiên không dùng được từ IP của VPS. Xem `VPS-SETUP.md` mục 3.

## Bước 2 — điền 1 đơn

Trên VPS, chạy qua Xvfb:

```bash
cat pvi-qlcd-playwright/payload.example.json | xvfb-run -a bun run pvi:order
```

Trên máy có màn hình:

```bash
cat pvi-qlcd-playwright/payload.example.json | bun run pvi:order
```

Chạy thử không ghi vào form:

```bash
cat pvi-qlcd-playwright/payload.example.json | bun run pvi:order:dry
```

## Bước 3 — kiểm tra phiên dùng được trên VPS

Chạy trên VPS ngay sau khi có `storageState.json`:

```bash
cat pvi-qlcd-playwright/payload.example.json | xvfb-run -a bun run pvi:order:dry
```

| Mã thoát | Nghĩa |
|---|---|
| 0 | Phiên dùng được |
| 2 | Phiên không dùng được từ IP của VPS. Dùng cách B để đăng nhập ngay trên VPS |

## Payload

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `product` | string | Chọn flow. Bỏ trống thì dùng `electric-accident` |
| `orderId` | string | Đặt tên ảnh chụp. Bỏ trống thì ảnh tên `khong-co-id.png` |
| `hoTen` | string | Ô "Người mua bảo hiểm" |
| `soThanhVien` | number | Số thành viên cùng địa chỉ thường trú |
| `diaChi` | string | Địa chỉ hộ |
| `ngayBatDau` | string | Dạng `YYYY-MM-DD` |
| `soTienBaoHiem` | number | Mức chi trả, ví dụ `40000000`. Khác mức phí khách trả |

Thiếu bất kỳ trường nào thì script thoát mã 1. Năm trường cuối là của riêng flow
tai nạn điện; flow khác khai danh sách riêng ở `batBuoc`.

Các giá trị cố định nằm ở `fixed` trong `lib/flows/electric-accident.js`: email, ngành nghề, cán bộ khai thác, nhóm kênh, kênh bán hàng, phương thức khai thác, đại lý, mã tiền tệ, tỷ lệ phí.

Email và ngành nghề chốt ngày 2026-08-15 là cố định: `ngoctuyenmgst@gmail.com` và `TỰ DO`. BE không gửi hai trường này nữa.

## Kết quả trả về

Script in JSON ra stdout và lưu ảnh chụp form vào `anh/`.

`anh/` và `captcha/` là thư mục TẠM: script tự tạo lúc chạy, nội dung không lên
git. Xoá lúc nào cũng được.

| Mã thoát | Nghĩa |
|---|---|
| 0 | Điền xong, chưa bấm Lưu |
| 1 | Payload sai hoặc thiếu trường |
| 2 | Chưa có `storageState.json`, hoặc phiên hết hạn — chạy lại `bun run pvi:login` |
| 3 | Trang lỗi, hoặc có ô không điền được |
| 4 | Chưa có script cho sản phẩm trong `product` |

BE bắt mã 2 thì báo người vận hành đăng nhập lại. Bắt mã 4 thì đặt đơn về `manual-queued` kèm lý do — đơn của sản phẩm chưa có script phải sang làm tay, không được để bot dừng mà không báo gì.

## Hợp đồng 2 năm

Script mỗi lần chỉ điền 1 đơn. Khách cần 2 năm thì BE gọi 2 lần. Ngày bắt đầu của đơn 2 bằng ngày kết thúc của đơn 1.

## Chưa làm

1. Bấm Lưu. Chưa xác định nút Lưu và chưa biết trang kiểm tra hợp lệ những gì.
2. Khối hóa đơn điện tử: `ho_ten_kh_vat`, `so_cccd`, `ma_sovat`, `dchi_xhoadon`.

## File

| File | Việc |
|---|---|
| `config.js` | Phần CHUNG mọi sản phẩm: phiên đăng nhập, cách mở trình duyệt |
| `lib/flows/index.js` | Bảng đăng ký flow, tra theo `product` |
| `lib/flows/electric-accident.js` | Flow tai nạn điện: URL form, tên ô, giá trị cố định, hàm điền |
| `lib/flows/motorbike.js` | Flow TNDS xe máy — cùng hình dạng, khác cán bộ khai thác và cách tính phí |
| `lib/ngay.js` | Định dạng ngày và tiền theo cách PVI nhận |
| `lib/order.js` | Chọn flow, lo phiên và ảnh chụp. Không biết tên ô nào của PVI |
| `login.js` | Mở trình duyệt trên máy bạn để đăng nhập, lưu phiên |
| `ensure-login.js` | BE gọi trước mỗi đơn. Còn phiên thì thoát 0 ngay; hết phiên thì thoát 2 để báo người vận hành |
| `import-cookies.js` | Đổi chuỗi cookie copy từ Chrome thành `storageState.json` |
| `check-session.js` | Kiểm tra phiên còn dùng được không |
| `create-order.js` | Đọc payload, mở form, gọi hàm điền, in báo cáo |
| `duyet-don.js` | Luồng 2: lọc bảng Manager, mở màn duyệt đơn Chờ cũ nhất |
| `lib/duyet.js` | Lõi luồng duyệt: đọc bảng, lấy `pr_key`, điền captcha |
| `lib/phien.js` | Kiểm phiên bằng HTTP, gọi `ensure-login.js` khi hết phiên |
| `chay-don.js` | Gọi `ensure-login.js` rồi `lib/order.js` trong một lệnh |
| `LUONG-TAO-VA-DUYET.md` | Hai luồng gồm bước nào, và cách chạy bằng worker trong container |
| `VPS-SETUP.md` | Hướng dẫn triển khai VPS từng bước |
