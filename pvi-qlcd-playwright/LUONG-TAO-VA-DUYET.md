# Hai luồng: tạo đơn và duyệt đơn

Chốt 2026-08-23. Đọc file này trước khi code bước duyệt.

Bot chạy **hai luồng rời nhau**, không phải một luồng liền mạch. Lý do: bấm
"Chấp nhận" xong, PVI **không** trả `pr_key` của đơn vừa tạo. Khoá đó chỉ xuất
hiện ở màn `https://qlcd.pvi.com.vn/Service/Manager`, trong đường dẫn của nút
"Duyệt" trên từng dòng.

Vì vậy luồng tạo đơn kết thúc ngay sau khi bấm "Chấp nhận". Luồng duyệt là một
tiến trình khác, chạy độc lập, tự đi tìm đơn cần duyệt.

## Luồng 1 — tạo đơn

| Bước | Việc | Trạng thái đơn trong database |
|---|---|---|
| 1 | Worker quét đơn chờ chạy tự động | `queued` |
| 2 | Pool Playwright còn chỗ thì lấy đơn **cũ nhất trước** | |
| 3 | Đánh dấu đang chạy, để worker khác không lấy trùng | `creating` |
| 4 | Mở form, điền 26 ô, bấm "Chấp nhận" | |
| 5 | Đóng Playwright | |
| 6 | Ghi lại trạng thái mới | `pending-approval` |

Luồng 1 dừng ở đây. Nó **không** biết đơn vừa tạo mang `pr_key` nào.

Lấy đơn phải khoá dòng bằng `for update skip locked`. Không khoá thì hai worker
lấy trùng một đơn và PVI nhận hai đơn giống hệt nhau.

## Luồng 2 — duyệt đơn

| Bước | Việc |
|---|---|
| 1 | Mở `https://qlcd.pvi.com.vn/Service/Manager` |
| 2 | Chọn bộ lọc trạng thái **"Chờ"** |
| 3 | Lấy dòng **cũ nhất** trong bảng |
| 4 | Bấm dấu ba chấm ở cột cuối, mở popover |
| 5 | Bấm "Duyệt" — trang chuyển sang màn duyệt |
| 6 | Đọc thông tin trên màn duyệt, tra ngược về đơn trong database |
| 7 | Điền captcha, bấm Chấp nhận |
| 8 | Ghi trạng thái đơn thành `done` |

Địa chỉ màn duyệt mang `pr_key` trong tham số:

```
https://qlcd.pvi.com.vn/Service/Assign/?pr_key=W6fXX4Fd7%2bI%3d&tthai=DUYET
```

### Dữ liệu một dòng trong bảng Manager

```
Nguyễn Văn A · 26/21/14/TNCN/0096592 · Hộ SD điện · Thấp · 100 000 ·
23/08/2026 · Chờ · PVI Tây Nam · Hà Khang Vĩ · CÔNG TY TNHH MINH GROUP ST
```

Mười cột: tên khách, số hợp đồng, loại bảo hiểm, loại rủi ro, phí, ngày tạo,
trạng thái, đơn vị, người tạo, công ty.

**Số hợp đồng `26/21/14/TNCN/0096592` là thứ định danh đơn bên PVI.** Luồng 2
phải đọc nó ở bước 3 và lưu vào database. Màn duyệt không hiện số này, nên bỏ
qua ở bảng là mất luôn.

### Dữ liệu trên màn duyệt

| Nhãn | Giá trị mẫu |
|---|---|
| Tên dịch vụ | Nguyễn Văn A |
| Loại rủi ro | Thấp |
| Ngày tạo dịch vụ | 23/08/2026 |
| Người tạo dịch vụ | Hà Khang Vĩ |
| Trạng thái | 00 ___ Duyệt DV |
| Ghi chú | (trống) |

"Tên dịch vụ" chính là tên khách hàng, không phải tên sản phẩm.

## Cách tra ngược về đơn trong database

Màn duyệt chỉ cho **tên khách** và **loại bảo hiểm**. Hai thứ đó đủ để thu hẹp
xuống một hoặc hai đơn.

### Chỗ sai được, đã chấp nhận

Một khách mua hai đơn bảo hiểm điện một năm — `2026-2027` và `2027-2028` — thì
hai đơn giống nhau mọi thông tin hiện trên màn duyệt, chỉ khác năm hiệu lực.
Năm hiệu lực không hiện ở đó, nên bot **không phân biệt được đang duyệt đơn nào**.

Cách xử lý: chọn một trong hai. Sai sót chấp nhận được, vì nhân viên vẫn giao cả
hai giấy chứng nhận cho cùng một khách. Cái sai chỉ nằm ở việc đơn nào trong
database mang `pr_key` nào, không ảnh hưởng tới khách.

Đọc thêm được số hợp đồng ở bảng Manager thì vẫn không gỡ được ca này: bảng cũng
không hiện năm hiệu lực.

## Việc phải làm trước khi code

1. **Thêm cột vào `insurance_orders`.** Bảng hiện không có chỗ lưu `pr_key` và
   số hợp đồng PVI. Xem `src/server/db/schema.ts`.
2. **Khảo sát DOM màn Manager.** Chưa đo: tên ô bộ lọc trạng thái, cách bảng
   sắp xếp, selector của dấu ba chấm và mục "Duyệt", cách trang phân trang.
3. **Đo lại đường dẫn màn duyệt.** File này ghi `/Service/Assign/`, còn
   `TRANG-THAI.md` ghi `/Service/AssignDuyet` từ lần khảo sát 2026-08-15. Hai
   đường dẫn khác nhau — phải xác định cái nào đúng trước khi viết code.
4. **Captcha màn duyệt.** Nó sinh ở trình duyệt bằng canvas, đáp án nằm ở biến
   toàn cục `code`. Chưa kiểm PVI có kiểm lại ở máy chủ hay không — xem mục
   "Những điều CHƯA chắc" ở `TRANG-THAI.md`.
